/**
 * 記録（チェックイン・メモ）の操作ヘルパ — Phase 8
 *
 * 設計上の重要ポイント:
 * - レコードはダッシュボード／センサーから独立した永続データ。元エンティティが
 *   削除されても残るよう、名称はスナップショットで保持。
 * - 承認情報は共通フォーマット（RecordApproval）。
 */
import type {
  CheckinSensorComment,
  Dashboard,
  DashboardCheckin,
  DashboardCheckinStore,
  DeviceStore,
  ReportThresholds,
  Sensor,
  SensorNote,
  SensorNoteCategory,
  SensorNoteStore,
  SensorStore,
  UserSession,
  Widget,
} from '../types'
import {
  cellIsDeviation,
  collectYearMonths,
  extractDeviationSegments,
  inferStorageKind,
  type DeviationSegment,
} from './report'
import { ensureDate, hash16 } from './mock'

let counter = 0
function genId(prefix: string): string {
  counter += 1
  return `${prefix}-${hash16(`${Date.now()}-${counter}-${Math.random()}`).slice(0, 8)}`
}

/* ---------- ダッシュボードのセンサー集約 ---------- */

/** ダッシュボードに含まれる全ウィジェットからセンサーIDの集合を取り出す */
export function collectDashboardSensorIds(dashboard: Dashboard): string[] {
  const set = new Set<string>()
  for (const w of dashboard.widgets as Widget[]) {
    for (const sid of w.sensorIds) set.add(sid)
  }
  return Array.from(set).sort()
}

/* ---------- 直近期間の逸脱検出 ---------- */

export type RecentDeviationItem = {
  sensorId: string
  sensorName: string
  deviationKinds: ('temperature' | 'humidity')[]
  detectedTemp?: number
  detectedHum?: number
  online: boolean
}

/** 指定期間内のセンサーごとの逸脱セグメント集合 */
export type SensorDeviationGroup = {
  sensorId: string
  sensorName: string
  /** 開始時刻の昇順 */
  segments: DeviationSegment[]
  countByMetric: { temperature: number; humidity: number }
  /** 互換用フィールド（既存サマリ表示で使う） */
  deviationKinds: ('temperature' | 'humidity')[]
  detectedTemp?: number
  detectedHum?: number
}

/** 指定センサー群について、指定期間内の逸脱セグメントを抽出
 *  （DeviationWidget と同じ集約。ただし時系列ではなくセンサー単位） */
export function detectDeviationsForRange(
  sensorIds: string[],
  devices: DeviceStore,
  sensors: SensorStore,
  thresholds: ReportThresholds,
  range: { start: Date; end: Date },
): SensorDeviationGroup[] {
  const out: SensorDeviationGroup[] = []
  for (const id of sensorIds) {
    const sensor = sensors[id]
    if (!sensor) continue
    const readings = devices[id] ?? []
    if (readings.length === 0) continue

    const months = collectYearMonths(readings)
    const lastYm = months[months.length - 1]
    const storageKind = lastYm ? inferStorageKind(readings, lastYm) : 'other'

    const segs: DeviationSegment[] = []
    for (const m of ['temperature', 'humidity'] as const) {
      const found = extractDeviationSegments(readings, range, m, thresholds, storageKind)
      for (const s of found) {
        segs.push({ ...s, sensorId: id })
      }
    }
    if (segs.length === 0) continue

    segs.sort((a, b) => a.start.getTime() - b.start.getTime())

    const countByMetric = {
      temperature: segs.filter((s) => s.metric === 'temperature').length,
      humidity: segs.filter((s) => s.metric === 'humidity').length,
    }
    const kinds: ('temperature' | 'humidity')[] = []
    if (countByMetric.temperature > 0) kinds.push('temperature')
    if (countByMetric.humidity > 0) kinds.push('humidity')

    // 代表値（最も極端だったもの）
    const maxTempSeg = segs.find(
      (s) => s.metric === 'temperature' && s.extremeValue === Math.max(
        ...segs.filter((x) => x.metric === 'temperature').map((x) => x.extremeValue),
      ),
    )
    const minHumSeg = segs.find(
      (s) => s.metric === 'humidity' && s.extremeValue === Math.min(
        ...segs.filter((x) => x.metric === 'humidity').map((x) => x.extremeValue),
      ),
    )

    out.push({
      sensorId: id,
      sensorName: sensor.id,
      segments: segs,
      countByMetric,
      deviationKinds: kinds,
      detectedTemp: maxTempSeg?.extremeValue,
      detectedHum: minHumSeg?.extremeValue,
    })
  }
  // 件数の多い順でソート
  out.sort((a, b) => {
    if (b.segments.length !== a.segments.length) {
      return b.segments.length - a.segments.length
    }
    return a.sensorName.localeCompare(b.sensorName)
  })
  return out
}

/** 指定センサー群について、直近 lookbackHours 以内の逸脱（温度／湿度）を抽出 */
export function detectRecentDeviations(
  sensorIds: string[],
  devices: DeviceStore,
  sensors: SensorStore,
  thresholds: ReportThresholds,
  lookbackHours: number,
  now: Date = new Date(),
): RecentDeviationItem[] {
  const cutoff = now.getTime() - lookbackHours * 60 * 60 * 1000
  const items: RecentDeviationItem[] = []

  for (const id of sensorIds) {
    const sensor = sensors[id]
    if (!sensor) continue
    const readings = devices[id] ?? []
    if (readings.length === 0) continue

    const months = collectYearMonths(readings)
    const lastYm = months[months.length - 1]
    const storageKind = lastYm ? inferStorageKind(readings, lastYm) : 'other'

    let tDev = false
    let hDev = false
    let lastTempVal: number | undefined
    let lastHumVal: number | undefined

    for (const r of readings) {
      const t = ensureDate(r.measuredAt).getTime()
      if (t < cutoff) continue
      if (cellIsDeviation(r.temperature, 'temperature', thresholds, storageKind)) {
        tDev = true
        lastTempVal = r.temperature
      }
      if (cellIsDeviation(r.humidity, 'humidity', thresholds, storageKind)) {
        hDev = true
        lastHumVal = r.humidity
      }
    }

    if (!tDev && !hDev) continue

    const kinds: ('temperature' | 'humidity')[] = []
    if (tDev) kinds.push('temperature')
    if (hDev) kinds.push('humidity')

    items.push({
      sensorId: id,
      sensorName: sensor.id,
      deviationKinds: kinds,
      detectedTemp: lastTempVal,
      detectedHum: lastHumVal,
      online: sensor.online,
    })
  }

  return items
}

/* ---------- チェックインの作成 ---------- */

export function createCheckin(opts: {
  dashboard: Dashboard
  user: UserSession
  comment?: string
  sensorComments: CheckinSensorComment[]
  snapshot: DashboardCheckin['snapshot']
}): DashboardCheckin {
  return {
    id: genId('chk'),
    dashboardId: opts.dashboard.id,
    dashboardName: opts.dashboard.name,
    userId: opts.user.email,
    userName: opts.user.userName,
    timestamp: new Date(),
    comment: opts.comment?.trim() || undefined,
    sensorComments: opts.sensorComments,
    snapshot: opts.snapshot,
  }
}

/** 単純なオンライン台数の集計 */
export function countOnline(sensorIds: string[], sensors: SensorStore): number {
  let n = 0
  for (const id of sensorIds) if (sensors[id]?.online) n++
  return n
}

export function upsertCheckin(
  store: DashboardCheckinStore,
  checkin: DashboardCheckin,
): DashboardCheckinStore {
  return { ...store, [checkin.id]: checkin }
}

/** 指定ダッシュボードの最新チェックイン */
export function findLatestCheckin(
  store: DashboardCheckinStore,
  dashboardId: string,
): DashboardCheckin | undefined {
  let latest: DashboardCheckin | undefined
  for (const c of Object.values(store)) {
    if (c.dashboardId !== dashboardId) continue
    if (!latest || c.timestamp.getTime() > latest.timestamp.getTime()) {
      latest = c
    }
  }
  return latest
}

/* ---------- センサーメモ ---------- */

export function createSensorNote(opts: {
  sensor: Sensor
  user: UserSession
  body: string
  category: SensorNoteCategory
}): SensorNote {
  return {
    id: genId('note'),
    sensorId: opts.sensor.id,
    sensorName: opts.sensor.id,
    authorId: opts.user.email,
    authorName: opts.user.userName,
    timestamp: new Date(),
    body: opts.body.trim(),
    category: opts.category,
  }
}

export function upsertNote(store: SensorNoteStore, note: SensorNote): SensorNoteStore {
  return { ...store, [note.id]: note }
}

export function removeNote(store: SensorNoteStore, id: string): SensorNoteStore {
  if (!(id in store)) return store
  const next = { ...store }
  delete next[id]
  return next
}

export function notesForSensor(store: SensorNoteStore, sensorId: string): SensorNote[] {
  return Object.values(store)
    .filter((n) => n.sensorId === sensorId)
    .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
}

/* ---------- 承認 ---------- */

export function approveCheckin(
  store: DashboardCheckinStore,
  id: string,
  user: UserSession,
  comment?: string,
): DashboardCheckinStore {
  const cur = store[id]
  if (!cur) return store
  return {
    ...store,
    [id]: {
      ...cur,
      approval: {
        approvedById: user.email,
        approvedByName: user.userName,
        approvedAt: new Date(),
        comment: comment?.trim() || undefined,
      },
    },
  }
}

export function approveNote(
  store: SensorNoteStore,
  id: string,
  user: UserSession,
  comment?: string,
): SensorNoteStore {
  const cur = store[id]
  if (!cur) return store
  return {
    ...store,
    [id]: {
      ...cur,
      approval: {
        approvedById: user.email,
        approvedByName: user.userName,
        approvedAt: new Date(),
        comment: comment?.trim() || undefined,
      },
    },
  }
}
