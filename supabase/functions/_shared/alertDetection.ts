// Phase 1.3a: 連続逸脱アラート判定（Edge Function 共通モジュール）
//
// webhook-milesight / parse-inbox / backfill から呼ばれる。
//
// 仕様:
//  - 「危険」レベル限定で発火（注意は色変更のみ、ここでは何もしない）
//  - 温度・湿度それぞれ独立にセッション管理
//  - 連続 deviationConsecutiveCount 回到達で初回発火
//  - 同セッション中: reAlertEnabled=true なら reAlertHours 経過で再アラート
//  - 除外時間 / 除外日のサンプルは「無かったこと」にして連続性は維持
//
// フロント側 (src/lib/alertLog.ts) のロジックと一致させること。
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

type Metric = 'temperature' | 'humidity'
type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6

type ThresholdLevel = { enabled: boolean; min?: number | null; max?: number | null }
type ThresholdMetric = { alert: ThresholdLevel; warn: ThresholdLevel }
type Thresholds = {
  kind?: string
  temperature?: ThresholdMetric
  humidity?: ThresholdMetric
}

type ExclusionTarget = 'deviation' | 'offline' | 'battery'
type ExclusionWindow = {
  enabled: boolean
  startTime: string
  endTime: string
  daysOfWeek: DayOfWeek[]
  targets: ExclusionTarget[]
}
type ExclusionDate = {
  enabled: boolean
  startDate: string
  endDate: string
  targets: ExclusionTarget[]
}

type AlertSettings = {
  deviationEnabled: boolean
  deviationConsecutiveCount: number
  reAlertEnabled?: boolean
  reAlertHours?: number
}

type SensorProps = {
  device_id: string
  thresholds: Thresholds | null
  alert_settings: AlertSettings | null
  exclusion_windows: ExclusionWindow[] | null
  exclusion_dates: ExclusionDate[] | null
}

type Device = {
  id: string
  organization_id: string
  manufacturer: string
  model: string
  serial_number: string
  device_number: string | null
}

type Reading = {
  measured_at: string // ISO
  temperature: number | null
  humidity: number | null
}

// ---- 除外時間 / 除外日 ----------------------------------------

function toMinuteOfDay(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim())
  if (!m) return null
  const h = Number(m[1]); const min = Number(m[2])
  if (h < 0 || h > 23 || min < 0 || min > 59) return null
  return h * 60 + min
}

function isInExclusionWindow(at: Date, w: ExclusionWindow): boolean {
  if (!w.enabled) return false
  const start = toMinuteOfDay(w.startTime)
  const end = toMinuteOfDay(w.endTime)
  if (start == null || end == null || start === end) return false
  const dow = at.getDay() as DayOfWeek
  const minute = at.getHours() * 60 + at.getMinutes()
  const matchDow = (target: DayOfWeek) =>
    w.daysOfWeek.length === 0 || w.daysOfWeek.includes(target)
  if (start < end) {
    if (minute < start || minute >= end) return false
    return matchDow(dow)
  }
  if (minute >= start) return matchDow(dow)
  if (minute < end) {
    const prevDow = (((dow - 1) % 7) + 7) % 7
    return matchDow(prevDow as DayOfWeek)
  }
  return false
}

function isInExclusionDate(at: Date, d: ExclusionDate): boolean {
  if (!d.enabled || !d.startDate || !d.endDate) return false
  const y = at.getFullYear()
  const m = String(at.getMonth() + 1).padStart(2, '0')
  const day = String(at.getDate()).padStart(2, '0')
  const today = `${y}-${m}-${day}`
  return today >= d.startDate && today <= d.endDate
}

function isAlertSuppressed(
  at: Date,
  windows: ExclusionWindow[] | null,
  dates: ExclusionDate[] | null,
  target: ExclusionTarget,
): boolean {
  if (windows) {
    for (const w of windows) {
      if (!w.enabled) continue
      if (w.targets.length > 0 && !w.targets.includes(target)) continue
      if (isInExclusionWindow(at, w)) return true
    }
  }
  if (dates) {
    for (const d of dates) {
      if (!d.enabled) continue
      if (d.targets.length > 0 && !d.targets.includes(target)) continue
      if (isInExclusionDate(at, d)) return true
    }
  }
  return false
}

// ---- 閾値判定 ------------------------------------------------

function isMetricDeviationEnabled(t: Thresholds | null, metric: Metric): boolean {
  const m = t?.[metric]
  return Boolean(m?.alert.enabled || m?.warn.enabled)
}

function evaluateLevel(
  value: number | null,
  metric: Metric,
  t: Thresholds | null,
): 'alert' | 'warn' | 'normal' {
  if (value == null || !t?.[metric]) return 'normal'
  const m = t[metric]!
  if (m.alert.enabled) {
    if (m.alert.min != null && value < m.alert.min) return 'alert'
    if (m.alert.max != null && value > m.alert.max) return 'alert'
  }
  if (m.warn.enabled) {
    if (m.warn.min != null && value < m.warn.min) return 'warn'
    if (m.warn.max != null && value > m.warn.max) return 'warn'
  }
  return 'normal'
}

function describeDeviation(metric: Metric, value: number, t: Thresholds): string {
  const m = t[metric]!
  const unit = metric === 'temperature' ? '℃' : '%'
  const label = metric === 'temperature' ? '温度' : '湿度'
  if (m.alert.min != null && value < m.alert.min) {
    return `${label} ${value.toFixed(1)}${unit} が下限 ${m.alert.min.toFixed(1)}${unit} を下回りました`
  }
  if (m.alert.max != null && value > m.alert.max) {
    return `${label} ${value.toFixed(1)}${unit} が上限 ${m.alert.max.toFixed(1)}${unit} を上回りました`
  }
  return `${label} ${value.toFixed(1)}${unit} が基準を逸脱しました`
}

// ---- メイン判定 ----------------------------------------------

/**
 * 新しく入った sensor_reading を 1 件評価して、必要なら alert_logs に INSERT する。
 *
 * - 履歴データ (historical = true) はスキップ（バックフィル経路で別途処理）
 * - 連続逸脱・除外・再アラートの判定をすべてここでやる
 */
export async function judgeAndInsertAlert(
  supabase: SupabaseClient,
  params: {
    device: Device
    sensorProps: SensorProps
    newReading: Reading
    isHistorical: boolean
  },
): Promise<{ fired: number }> {
  if (params.isHistorical) return { fired: 0 }
  const { device, sensorProps, newReading } = params
  const settings = sensorProps.alert_settings
  if (!settings?.deviationEnabled) return { fired: 0 }
  const thresholds = sensorProps.thresholds
  if (!thresholds) return { fired: 0 }

  const N = Math.max(1, settings.deviationConsecutiveCount ?? 3)
  const reAlertOn = Boolean(settings.reAlertEnabled)
  const reAlertMs = Math.max(1, Math.min(24, settings.reAlertHours ?? 6)) * 60 * 60 * 1000

  const measuredAt = new Date(newReading.measured_at)
  if (isAlertSuppressed(measuredAt, sensorProps.exclusion_windows, sensorProps.exclusion_dates, 'deviation')) {
    return { fired: 0 }
  }

  let fired = 0
  for (const metric of ['temperature', 'humidity'] as const) {
    if (!isMetricDeviationEnabled(thresholds, metric)) continue
    const value = newReading[metric]
    if (value == null) continue
    const level = evaluateLevel(value, metric, thresholds)
    if (level !== 'alert') continue // 注意 / 正常: 何もしない

    // 直近 N+10 件を遡って連続カウント（自分含む）
    const { data: prev, error: prevErr } = await supabase
      .from('sensor_readings')
      .select('measured_at, temperature, humidity')
      .eq('sensor_id', device.id)
      .lt('measured_at', newReading.measured_at)
      .order('measured_at', { ascending: false })
      .limit(N + 10)
    if (prevErr) {
      console.error('[alert] prev readings fetch error', prevErr)
      continue
    }

    let consecutive = 1
    for (const p of (prev ?? []) as Reading[]) {
      const pAt = new Date(p.measured_at)
      if (isAlertSuppressed(pAt, sensorProps.exclusion_windows, sensorProps.exclusion_dates, 'deviation')) continue
      const pLevel = evaluateLevel(p[metric], metric, thresholds)
      if (pLevel === 'alert') {
        consecutive++
        if (consecutive >= N) break
      } else {
        break
      }
    }

    if (consecutive < N) continue

    // 直近の同種 deviation-alert を確認
    const { data: last, error: lastErr } = await supabase
      .from('alert_logs')
      .select('id, occurred_at, session_id, re_alert_index')
      .eq('target_id', device.id)
      .eq('kind', 'deviation-alert')
      .eq('metric', metric)
      .order('occurred_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (lastErr) {
      console.error('[alert] last alert fetch error', lastErr)
      continue
    }

    let mode: 'new-session' | 'continue-session' = 'new-session'
    let sessionId: string = crypto.randomUUID()
    let reAlertIndex = 0

    if (last) {
      // last の occurred_at 〜 今 の間に「正常 or 注意」サンプルがあれば新セッション
      const { data: inter, error: interErr } = await supabase
        .from('sensor_readings')
        .select('measured_at, temperature, humidity')
        .eq('sensor_id', device.id)
        .gt('measured_at', last.occurred_at)
        .lt('measured_at', newReading.measured_at)
        .order('measured_at', { ascending: true })
      if (interErr) {
        console.error('[alert] intervening readings fetch error', interErr)
        continue
      }
      let hasNonAlert = false
      for (const r of (inter ?? []) as Reading[]) {
        const rAt = new Date(r.measured_at)
        if (isAlertSuppressed(rAt, sensorProps.exclusion_windows, sensorProps.exclusion_dates, 'deviation')) continue
        const rLevel = evaluateLevel(r[metric], metric, thresholds)
        if (rLevel !== 'alert') { hasNonAlert = true; break }
      }
      if (hasNonAlert) {
        mode = 'new-session'
      } else {
        mode = 'continue-session'
        sessionId = last.session_id ?? crypto.randomUUID()
        reAlertIndex = (last.re_alert_index ?? 0) + 1
      }
    }

    if (mode === 'continue-session') {
      if (!reAlertOn) continue
      const elapsed = measuredAt.getTime() - new Date(last!.occurred_at).getTime()
      if (elapsed < reAlertMs) continue
    }

    const message =
      mode === 'continue-session'
        ? `${describeDeviation(metric, value, thresholds)}（再アラート ${reAlertIndex}）`
        : describeDeviation(metric, value, thresholds)

    const { error: insErr } = await supabase
      .from('alert_logs')
      .insert({
        organization_id: device.organization_id,
        occurred_at: newReading.measured_at,
        target_kind: 'sensor',
        target_id: device.id,
        manufacturer: device.manufacturer,
        model: device.model,
        serial_number: device.serial_number,
        sensor_number: device.device_number,
        kind: 'deviation-alert',
        metric,
        value,
        message,
        session_id: sessionId,
        re_alert_index: reAlertIndex,
      })
    if (insErr) {
      console.error('[alert] alert_logs insert error', insErr)
      continue
    }
    fired++
  }

  return { fired }
}

/**
 * バッチ用: ある sensor の全 readings を時系列順に走査して alert_logs を再構築。
 *  - 既存の alert_logs（その sensor 分）は呼び出し側で DELETE してから呼ぶ前提
 *  - フロント側 judgeAllReadingsForSensor と同じアルゴリズム
 */
export async function buildAlertsForSensorBackfill(
  supabase: SupabaseClient,
  params: {
    device: Device
    sensorProps: SensorProps
    readings: Reading[]
  },
): Promise<number> {
  const { device, sensorProps, readings } = params
  const settings = sensorProps.alert_settings
  if (!settings?.deviationEnabled) return 0
  const thresholds = sensorProps.thresholds
  if (!thresholds) return 0

  const N = Math.max(1, settings.deviationConsecutiveCount ?? 3)
  const reAlertOn = Boolean(settings.reAlertEnabled)
  const reAlertMs = Math.max(1, Math.min(24, settings.reAlertHours ?? 6)) * 60 * 60 * 1000

  const sorted = [...readings].sort((a, b) =>
    new Date(a.measured_at).getTime() - new Date(b.measured_at).getTime(),
  )

  type State = { consecutive: number; sessionId: string | null; lastFiredAt: number | null; reAlertIndex: number }
  const state: Record<Metric, State> = {
    temperature: { consecutive: 0, sessionId: null, lastFiredAt: null, reAlertIndex: 0 },
    humidity:    { consecutive: 0, sessionId: null, lastFiredAt: null, reAlertIndex: 0 },
  }
  const inserts: Record<string, unknown>[] = []

  for (const r of sorted) {
    const measuredAt = new Date(r.measured_at)
    const suppressed = isAlertSuppressed(measuredAt, sensorProps.exclusion_windows, sensorProps.exclusion_dates, 'deviation')
    for (const metric of ['temperature', 'humidity'] as const) {
      const s = state[metric]
      if (!isMetricDeviationEnabled(thresholds, metric)) continue
      const value = r[metric]
      if (value == null) continue
      if (suppressed) continue
      const level = evaluateLevel(value, metric, thresholds)
      if (level !== 'alert') {
        s.consecutive = 0
        s.sessionId = null
        s.lastFiredAt = null
        s.reAlertIndex = 0
        continue
      }
      s.consecutive += 1
      if (s.sessionId == null) {
        if (s.consecutive >= N) {
          const sid = crypto.randomUUID()
          s.sessionId = sid
          s.lastFiredAt = measuredAt.getTime()
          s.reAlertIndex = 0
          inserts.push({
            organization_id: device.organization_id,
            occurred_at: r.measured_at,
            target_kind: 'sensor',
            target_id: device.id,
            manufacturer: device.manufacturer,
            model: device.model,
            serial_number: device.serial_number,
            sensor_number: device.device_number,
            kind: 'deviation-alert',
            metric,
            value,
            message: describeDeviation(metric, value, thresholds),
            session_id: sid,
            re_alert_index: 0,
          })
        }
      } else if (reAlertOn) {
        if (s.lastFiredAt != null && measuredAt.getTime() - s.lastFiredAt >= reAlertMs) {
          s.reAlertIndex += 1
          s.lastFiredAt = measuredAt.getTime()
          inserts.push({
            organization_id: device.organization_id,
            occurred_at: r.measured_at,
            target_kind: 'sensor',
            target_id: device.id,
            manufacturer: device.manufacturer,
            model: device.model,
            serial_number: device.serial_number,
            sensor_number: device.device_number,
            kind: 'deviation-alert',
            metric,
            value,
            message: `${describeDeviation(metric, value, thresholds)}（再アラート ${s.reAlertIndex}）`,
            session_id: s.sessionId,
            re_alert_index: s.reAlertIndex,
          })
        }
      }
    }
  }

  if (inserts.length === 0) return 0
  // バッチ挿入（500 件単位）
  let total = 0
  for (let i = 0; i < inserts.length; i += 500) {
    const chunk = inserts.slice(i, i + 500)
    const { error } = await supabase.from('alert_logs').insert(chunk)
    if (error) {
      console.error('[alert] backfill insert error', error)
      throw error
    }
    total += chunk.length
  }
  return total
}
