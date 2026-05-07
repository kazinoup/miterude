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
 *  温度・湿度それぞれを判定する。 */
export function judgeReadingForAlerts(
  sensor: Sensor,
  reading: SensorReading,
): AlertLogEntry[] {
  const entries: AlertLogEntry[] = []
  const t = sensor.thresholds
  if (!t) return entries

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
 *  reading.battery が threshold% を下回ったら battery アラートを 1 件返す。 */
export function judgeBatteryForAlerts(
  sensor: Sensor,
  reading: SensorReading,
  thresholdPercent: number,
): AlertLogEntry[] {
  if (typeof reading.battery !== 'number') return []
  if (reading.battery >= thresholdPercent) return []
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

/** オンライン→オフラインへの遷移を 1 件のオフラインアラートとして記録。 */
export function judgeOfflineTransitionAlert(
  sensor: Sensor,
  prevOnline: boolean,
  now: Date,
): AlertLogEntry[] {
  if (prevOnline === sensor.online) return []
  if (sensor.online) return [] // online → offline のみ記録
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
