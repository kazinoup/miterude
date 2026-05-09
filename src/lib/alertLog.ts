/**
 * アラートログヘルパ — Phase B / Phase 10
 *
 * 役割:
 *  - センサー受信ごとの逸脱（危険・注意）判定 → AlertLogEntry を生成
 *  - オンライン → オフライン遷移時のオフラインアラートを生成
 *  - バッテリー残量低下のアラートを生成（Phase C で利用）
 *  - 重複（同じ targetId × kind × occurredAt）を排除して store に追加
 *
 * 連続した逸脱を 1 件にまとめるか・分けるかは UI 要件によるが、
 * 当面は「30 分 1 サンプル単位で逸脱したらその時刻のエントリを 1 件作る」
 * シンプルな方針にしておく（連続を圧縮するなら後で seedAlertLogs / judge 側を変える）。
 */
import type {
  AlertLogEntry,
  AlertLogKind,
  AlertLogStore,
  Gateway,
  Sensor,
  SensorReading,
} from '../types'
import {
  cellIsDeviation,
  evaluateMetricLevel,
  getThresholdForMetric,
  isMetricDeviationEnabled,
} from './report'
import { isAlertSuppressed } from './alertExclusion'

/** 同一日時 (秒精度) × ターゲット × 種別 × metric は重複と見做す。 */
function entryDedupKey(e: AlertLogEntry): string {
  const t = e.occurredAt instanceof Date
    ? e.occurredAt.getTime()
    : new Date(e.occurredAt as unknown as string).getTime()
  return `${e.targetId}|${e.kind}|${e.metric ?? '-'}|${Math.floor(t / 1000)}`
}

function nextEntryId(): string {
  // 短いランダム ID（UUID は不要）
  return `al-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/** ログストアにエントリを追加（重複は無視）。
 *  純関数として新ストアを返す（既存ストアは破壊しない）。 */
export function appendAlertEntries(
  store: AlertLogStore,
  entries: AlertLogEntry[],
): AlertLogStore {
  if (entries.length === 0) return store
  const existingKeys = new Set<string>()
  for (const e of Object.values(store)) {
    existingKeys.add(entryDedupKey(e))
  }
  const next = { ...store }
  for (const e of entries) {
    const key = entryDedupKey(e)
    if (existingKeys.has(key)) continue
    existingKeys.add(key)
    next[e.id] = e
  }
  return next
}

/** センサーから AlertLogEntry の共通部分（target 情報）を組み立てる。 */
function snapshotSensorTarget(sensor: Sensor): Pick<
  AlertLogEntry,
  'targetKind' | 'targetId' | 'manufacturer' | 'model' | 'serialNumber' | 'sensorNumber'
> {
  return {
    targetKind: 'sensor',
    targetId: sensor.id,
    manufacturer: sensor.manufacturer,
    model: sensor.model,
    serialNumber: sensor.serialNumber,
    sensorNumber: sensor.deviceNumber,
  }
}

function snapshotGatewayTarget(gateway: Gateway): Pick<
  AlertLogEntry,
  'targetKind' | 'targetId' | 'manufacturer' | 'model' | 'serialNumber'
> {
  return {
    targetKind: 'gateway',
    targetId: gateway.id,
    manufacturer: gateway.manufacturer,
    model: gateway.model,
    serialNumber: gateway.serialNumber,
  }
}

/** 値・閾値から「下限を下回った／上限を上回った」のどちらか（または両方）を文字列化 */
function describeDeviation(
  metric: 'temperature' | 'humidity',
  value: number,
  thresholds: Sensor['thresholds'],
  level: 'alert' | 'warn',
): string {
  const m = getThresholdForMetric(thresholds, metric)
  if (!m) return ''
  const t = level === 'alert' ? m.alert : m.warn
  const unit = metric === 'temperature' ? '℃' : '%'
  const metricLabel = metric === 'temperature' ? '温度' : '湿度'
  if (t.min != null && value < t.min) {
    return `${metricLabel} ${value.toFixed(1)}${unit} が下限 ${t.min.toFixed(1)}${unit} を下回りました`
  }
  if (t.max != null && value > t.max) {
    return `${metricLabel} ${value.toFixed(1)}${unit} が上限 ${t.max.toFixed(1)}${unit} を上回りました`
  }
  return `${metricLabel} ${value.toFixed(1)}${unit} が基準を逸脱しました`
}

/** センサーの 1 サンプルから、逸脱（危険／注意）のアラートを 0〜2 件生成。
 *  温度・湿度それぞれを判定する。
 *  測定時刻が `alertSettings.exclusionWindows` のいずれかに該当する場合は
 *  抑制（飲食店の閉店中、工場の夜間扉閉めなどに使う）。 */
export function judgeReadingForAlerts(
  sensor: Sensor,
  reading: SensorReading,
): AlertLogEntry[] {
  const entries: AlertLogEntry[] = []
  const t = sensor.thresholds
  if (!t) return entries

  // 除外時間帯チェック（逸脱アラートのみ）
  if (isAlertSuppressed(reading.measuredAt, sensor.alertSettings, 'deviation'))
    return entries

  const target = snapshotSensorTarget(sensor)

  for (const metric of ['temperature', 'humidity'] as const) {
    if (!isMetricDeviationEnabled(t, metric)) continue
    const value = reading[metric]
    if (typeof value !== 'number') continue
    const level = evaluateMetricLevel(value, metric, t)
    if (level !== 'alert' && level !== 'warn') continue
    const kind: AlertLogKind =
      level === 'alert' ? 'deviation-alert' : 'deviation-warn'
    entries.push({
      id: nextEntryId(),
      occurredAt: reading.measuredAt,
      ...target,
      kind,
      metric,
      value,
      message: describeDeviation(metric, value, t, level),
    })
  }
  return entries
}

/** バッテリー残量低下を判定（Phase C 用）。
 *  reading.battery が threshold% を下回ったら battery アラートを 1 件返す。
 *  測定時刻が除外時間帯に該当する場合は抑制。 */
export function judgeBatteryForAlerts(
  sensor: Sensor,
  reading: SensorReading,
  thresholdPercent: number,
): AlertLogEntry[] {
  if (typeof reading.battery !== 'number') return []
  if (reading.battery >= thresholdPercent) return []
  if (isAlertSuppressed(reading.measuredAt, sensor.alertSettings, 'battery'))
    return []
  return [
    {
      id: nextEntryId(),
      occurredAt: reading.measuredAt,
      ...snapshotSensorTarget(sensor),
      kind: 'battery',
      metric: 'battery',
      value: reading.battery,
      message: `バッテリー残量 ${reading.battery}% が閾値 ${thresholdPercent}% を下回りました`,
    },
  ]
}

/** オンライン→オフラインへの遷移を 1 件のオフラインアラートとして記録。
 *  発生時刻が除外時間帯に該当する場合は抑制（夜間扉閉めなど）。 */
export function judgeOfflineTransitionAlert(
  sensor: Sensor,
  prevOnline: boolean,
  now: Date,
): AlertLogEntry[] {
  if (prevOnline === sensor.online) return []
  if (sensor.online) return [] // online → offline のみ記録
  if (isAlertSuppressed(now, sensor.alertSettings, 'offline')) return []
  return [
    {
      id: nextEntryId(),
      occurredAt: now,
      ...snapshotSensorTarget(sensor),
      kind: 'offline',
      message: `オフラインになりました（最終受信: ${formatDateTimeJp(sensor.lastSeenAt)}）`,
    },
  ]
}

/** ゲートウェイ単体のオフラインアラート（任意・Phase B では未使用）。 */
export function judgeGatewayOfflineAlert(
  gateway: Gateway,
  now: Date,
): AlertLogEntry[] {
  return [
    {
      id: nextEntryId(),
      occurredAt: now,
      ...snapshotGatewayTarget(gateway),
      kind: 'offline',
      message: 'ゲートウェイがオフラインです',
    },
  ]
}

function formatDateTimeJp(d: Date | string | null | undefined): string {
  if (!d) return '—'
  const dd = d instanceof Date ? d : new Date(d as string)
  if (Number.isNaN(dd.getTime())) return '—'
  const y = dd.getFullYear()
  const m = String(dd.getMonth() + 1).padStart(2, '0')
  const day = String(dd.getDate()).padStart(2, '0')
  const hh = String(dd.getHours()).padStart(2, '0')
  const mm = String(dd.getMinutes()).padStart(2, '0')
  return `${y}/${m}/${day} ${hh}:${mm}`
}

/* ---------- 連続逸脱の "今" を可視化するヘルパ ---------- */

/** 「いまこのセンサーは連続で何回逸脱しているか」を表す状態。
 *  センサー詳細のアラート設定パネルで「あと何回でアラート発動か」を
 *  即時表示するために使う。 */
export type DeviationStreak = {
  /** 直近サンプルから何回連続で逸脱しているか。0 = 直近サンプルは正常 */
  count: number
  /** 連続逸脱の起点 measuredAt（count > 0 のとき）*/
  since?: Date
  /** 直近サンプルの逸脱レベル */
  latestLevel: 'alert' | 'warn' | 'normal' | null
  /** 直近サンプルの時刻が除外時間帯に当たっている */
  suppressedByExclusion: boolean
  /** 直近サンプル時刻 */
  latestAt?: Date
}

/** 直近のサンプルから遡って連続逸脱回数を数える。
 *
 *  `readings` は時系列順（古い順 or 新しい順どちらでも構わない、内部でソート）。
 *  thresholds 未設定や readings が空の場合は count=0 を返す。 */
export function computeCurrentDeviationStreak(
  sensor: Sensor,
  readings: SensorReading[],
): DeviationStreak {
  const empty: DeviationStreak = {
    count: 0,
    latestLevel: null,
    suppressedByExclusion: false,
  }
  const t = sensor.thresholds
  if (!t || readings.length === 0) return empty
  // 新しい順に並べる
  const sorted = [...readings].sort((a, b) => {
    const ta =
      a.measuredAt instanceof Date
        ? a.measuredAt.getTime()
        : new Date(a.measuredAt as unknown as string).getTime()
    const tb =
      b.measuredAt instanceof Date
        ? b.measuredAt.getTime()
        : new Date(b.measuredAt as unknown as string).getTime()
    return tb - ta
  })

  let count = 0
  let since: Date | undefined
  let latestLevel: DeviationStreak['latestLevel'] = null
  let suppressedByExclusion = false
  const latestAt =
    sorted[0].measuredAt instanceof Date
      ? sorted[0].measuredAt
      : new Date(sorted[0].measuredAt as unknown as string)

  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i]
    const tempDev = cellIsDeviation(r.temperature, 'temperature', t)
    const humDev = cellIsDeviation(r.humidity, 'humidity', t)
    const isDev = tempDev || humDev

    if (i === 0) {
      if (!isDev) {
        return { ...empty, latestLevel: 'normal', latestAt }
      }
      // alert（赤）優先で判定。どちらか alert なら alert。
      const tempLevel = evaluateMetricLevel(r.temperature, 'temperature', t)
      const humLevel = evaluateMetricLevel(r.humidity, 'humidity', t)
      latestLevel =
        tempLevel === 'alert' || humLevel === 'alert' ? 'alert' : 'warn'
      const measuredAt =
        r.measuredAt instanceof Date
          ? r.measuredAt
          : new Date(r.measuredAt as unknown as string)
      suppressedByExclusion = isAlertSuppressed(
        measuredAt,
        sensor.alertSettings,
        'deviation',
      )
    }

    if (!isDev) break
    count++
    since =
      r.measuredAt instanceof Date
        ? r.measuredAt
        : new Date(r.measuredAt as unknown as string)
  }

  return { count, since, latestLevel, suppressedByExclusion, latestAt }
}

/** Sensor の readings 配列を一括判定して、逸脱アラートをまとめて返す。 */
export function judgeAllReadingsForSensor(
  sensor: Sensor,
  readings: SensorReading[],
): AlertLogEntry[] {
  if (!sensor.thresholds) return []
  const t = sensor.thresholds
  const result: AlertLogEntry[] = []
  for (const r of readings) {
    // 早期スキップ: 温湿度どちらも逸脱なしなら飛ばす（cellIsDeviation で軽量判定）
    const tempDev = cellIsDeviation(r.temperature, 'temperature', t)
    const humDev = cellIsDeviation(r.humidity, 'humidity', t)
    if (!tempDev && !humDev) continue
    result.push(...judgeReadingForAlerts(sensor, r))
  }
  return result
}
