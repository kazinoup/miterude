import type { MissingDisplay, ReportThresholds, SensorReading, StorageKind, YearMonth } from '../types'
import { yearMonthKey } from '../types'

export const SLOTS_PER_DAY = 48

/** rowIndex 0..47 → hour 0..23, half 0=前半 1=後半 */
export function rowToHourHalf(rowIndex: number): { hour: number; half: 0 | 1 } {
  const hour = Math.floor(rowIndex / 2)
  const half = (rowIndex % 2) as 0 | 1
  return { hour, half }
}

export function readingSlot(reading: SensorReading): { day: number; hour: number; half: 0 | 1 } {
  const d = reading.measuredAt
  const day = d.getDate()
  const hour = d.getHours()
  const minute = d.getMinutes()
  const half: 0 | 1 = minute < 30 ? 0 : 1
  return { day, hour, half }
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

export function isReadingInMonth(r: SensorReading, ym: YearMonth): boolean {
  const d = toDate(r.measuredAt)
  if (!d) return false
  return d.getFullYear() === ym.year && d.getMonth() + 1 === ym.month
}

export function filterReadingsForMonth(
  readings: SensorReading[],
  ym: YearMonth,
): SensorReading[] {
  return readings.filter((r) => isReadingInMonth(r, ym))
}

export function deviceHasDataForMonth(
  readings: SensorReading[] | undefined,
  ym: YearMonth,
): boolean {
  if (!readings?.length) return false
  return readings.some((r) => isReadingInMonth(r, ym))
}

/** 連続する逸脱スロットを 1 つのセグメントとして集約 */
export type DeviationSegment = {
  sensorId: string
  metric: 'temperature' | 'humidity'
  /** スロット開始（30分単位） */
  start: Date
  /** スロット終了（30分単位、exclusive ではなく最後のスロットの終端） */
  end: Date
  /** 含まれるスロット数 */
  slotCount: number
  /** 上限超え or 下限割れ */
  direction: 'above' | 'below' | 'mixed'
  /** その期間中の最大値（above 時の最大、below 時の最小） */
  extremeValue: number
  /** 基準上限・下限（参考表示用） */
  thresholdMin: number
  thresholdMax: number
}

/** 指定センサーの直近期間における逸脱セグメントを抽出
 *  - 30分スロット粒度で平均値を判定
 *  - 連続する逸脱を 1 セグメントに集約
 *  - 1 スロットでも正常に戻ったら別セグメント
 *  - 温度と湿度は別系統で扱う
 */
export function extractDeviationSegments(
  readings: SensorReading[],
  range: { start: Date; end: Date },
  metric: 'temperature' | 'humidity',
  thresholds: ReportThresholds,
  storageKind: StorageKind,
): Omit<DeviationSegment, 'sensorId'>[] {
  if (!isMetricDeviationEnabled(metric, thresholds, storageKind)) return []

  const slotMs = 30 * 60 * 1000
  const startMs = range.start.getTime()
  const endMs = range.end.getTime()

  // 30分スロットごとに値を集約
  const buckets = new Map<number, number[]>()
  for (const r of readings) {
    const t = (r.measuredAt instanceof Date
      ? r.measuredAt
      : new Date(r.measuredAt as unknown as string)
    ).getTime()
    if (t < startMs || t >= endMs) continue
    const slotKey = Math.floor(t / slotMs)
    const v = metric === 'temperature' ? r.temperature : r.humidity
    const arr = buckets.get(slotKey)
    if (arr) arr.push(v)
    else buckets.set(slotKey, [v])
  }

  if (buckets.size === 0) return []

  const tr = activeTempRange(storageKind, thresholds)
  const tMin = metric === 'temperature' ? tr.min : thresholds.humMin
  const tMax = metric === 'temperature' ? tr.max : thresholds.humMax

  // ソートして時系列に並べる
  const sortedKeys = Array.from(buckets.keys()).sort((a, b) => a - b)

  const segments: Omit<DeviationSegment, 'sensorId'>[] = []
  let cur: {
    startKey: number
    endKey: number
    slotCount: number
    direction: 'above' | 'below' | 'mixed'
    extremeValue: number
  } | null = null

  let prevKey: number | null = null

  for (const key of sortedKeys) {
    const vs = buckets.get(key)!
    const slotAvg = vs.reduce((a, b) => a + b, 0) / vs.length
    const isOver = slotAvg > tMax
    const isUnder = slotAvg < tMin
    const isDeviation = isOver || isUnder

    // 正常スロット → 進行中セグメントを締める
    if (!isDeviation) {
      if (cur) {
        segments.push(finalizeSegment(cur, slotMs, metric, tMin, tMax))
        cur = null
      }
      prevKey = key
      continue
    }

    const dir: 'above' | 'below' = isOver ? 'above' : 'below'

    // セグメント継続条件: スロットが隣接 (key === prevKey + 1) かつ 進行中
    if (cur && prevKey !== null && key === prevKey + 1) {
      cur.endKey = key
      cur.slotCount += 1
      // direction が混在したら mixed に
      if (cur.direction !== dir && cur.direction !== 'mixed') {
        cur.direction = 'mixed'
      }
      // 極値更新
      if (cur.direction === 'above' || (cur.direction === 'mixed' && isOver)) {
        if (slotAvg > cur.extremeValue) cur.extremeValue = slotAvg
      } else if (cur.direction === 'below') {
        if (slotAvg < cur.extremeValue) cur.extremeValue = slotAvg
      }
    } else {
      // 進行中セグメントを締めて新規スタート
      if (cur) segments.push(finalizeSegment(cur, slotMs, metric, tMin, tMax))
      cur = {
        startKey: key,
        endKey: key,
        slotCount: 1,
        direction: dir,
        extremeValue: slotAvg,
      }
    }

    prevKey = key
  }

  if (cur) segments.push(finalizeSegment(cur, slotMs, metric, tMin, tMax))

  return segments
}

function finalizeSegment(
  cur: {
    startKey: number
    endKey: number
    slotCount: number
    direction: 'above' | 'below' | 'mixed'
    extremeValue: number
  },
  slotMs: number,
  metric: 'temperature' | 'humidity',
  tMin: number,
  tMax: number,
): Omit<DeviationSegment, 'sensorId'> {
  return {
    metric,
    start: new Date(cur.startKey * slotMs),
    end: new Date((cur.endKey + 1) * slotMs),
    slotCount: cur.slotCount,
    direction: cur.direction,
    extremeValue: cur.extremeValue,
    thresholdMin: tMin,
    thresholdMax: tMax,
  }
}

export function deviceHasDataForRange(
  readings: SensorReading[] | undefined,
  range: { start: Date; end: Date },
): boolean {
  if (!readings?.length) return false
  const startMs = range.start.getTime()
  const endMs = range.end.getTime()
  return readings.some((r) => {
    const d = r.measuredAt instanceof Date ? r.measuredAt : new Date(r.measuredAt as unknown as string)
    if (Number.isNaN(d.getTime())) return false
    const t = d.getTime()
    return t >= startMs && t < endMs
  })
}

/** 値を Date に正規化する（localStorage 復元時に文字列が混じっても受け付ける） */
function toDate(v: unknown): Date | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v
  if (typeof v === 'string' || typeof v === 'number') {
    const d = new Date(v)
    if (!Number.isNaN(d.getTime())) return d
  }
  return null
}

/** 取込データから出現する年月一覧（昇順） */
export function collectYearMonths(readings: SensorReading[]): YearMonth[] {
  const set = new Set<string>()
  for (const r of readings) {
    const d = toDate(r.measuredAt)
    if (!d) continue
    const y = d.getFullYear()
    const m = d.getMonth() + 1
    set.add(yearMonthKey({ year: y, month: m }))
  }
  return Array.from(set)
    .sort()
    .map((k) => {
      const [ys, ms] = k.split('-')
      return { year: Number(ys), month: Number(ms) }
    })
}

/** 30分枠ごとの平均値グリッド。行48 × 列=日数（1日=列0） */
export type MonthlyMetricGrid = (number | null)[][]

/** 30分枠ごとの平均値グリッド（週報用）。行48 × 列7（月曜起点の7日間） */
export function buildWeeklyGrid(
  readings: SensorReading[],
  weekStart: Date,
  metric: 'temperature' | 'humidity',
): MonthlyMetricGrid {
  const startMs = new Date(weekStart).setHours(0, 0, 0, 0)
  const endMs = startMs + 7 * 24 * 60 * 60 * 1000
  const buckets: number[][][] = Array.from({ length: SLOTS_PER_DAY }, () =>
    Array.from({ length: 7 }, () => [] as number[]),
  )

  for (const r of readings) {
    const d = toDate(r.measuredAt)
    if (!d) continue
    const t = d.getTime()
    if (t < startMs || t >= endMs) continue
    const dayOffset = Math.floor((t - startMs) / (24 * 60 * 60 * 1000))
    if (dayOffset < 0 || dayOffset >= 7) continue
    const hour = d.getHours()
    const minute = d.getMinutes()
    const half = minute < 30 ? 0 : 1
    const row = hour * 2 + half
    if (row < 0 || row >= SLOTS_PER_DAY) continue
    const v = metric === 'temperature' ? r.temperature : r.humidity
    buckets[row][dayOffset].push(v)
  }

  return buckets.map((row) =>
    row.map((arr) => {
      if (arr.length === 0) return null
      const sum = arr.reduce((a, b) => a + b, 0)
      return sum / arr.length
    }),
  )
}

export function buildMonthlyGrid(
  readings: SensorReading[],
  ym: YearMonth,
  metric: 'temperature' | 'humidity',
): MonthlyMetricGrid {
  const dim = daysInMonth(ym.year, ym.month)
  const buckets: number[][][] = Array.from({ length: SLOTS_PER_DAY }, () =>
    Array.from({ length: dim }, () => [] as number[]),
  )

  for (const r of readings) {
    if (!isReadingInMonth(r, ym)) continue
    const { day, hour, half } = readingSlot(r)
    if (day < 1 || day > dim) continue
    const row = hour * 2 + half
    if (row < 0 || row >= SLOTS_PER_DAY) continue
    const col = day - 1
    const v = metric === 'temperature' ? r.temperature : r.humidity
    buckets[row][col].push(v)
  }

  return buckets.map((row) =>
    row.map((arr) => {
      if (arr.length === 0) return null
      const sum = arr.reduce((a, b) => a + b, 0)
      return sum / arr.length
    }),
  )
}

export type MetricSummary = {
  count: number
  deviationCount: number
  avg: number | null
  min: number | null
  max: number | null
}

function isDeviation(v: number, min: number, max: number): boolean {
  return v < min || v > max
}

/** 当月の平均温度（℃）から冷蔵／冷凍を推定（0〜10℃＝冷蔵、0℃未満＝冷凍、それ以外＝その他） */
export function inferStorageKind(readings: SensorReading[], ym: YearMonth): StorageKind {
  const monthReadings = filterReadingsForMonth(readings, ym)
  const temps = monthReadings.map((r) => r.temperature)
  if (temps.length === 0) return 'other'
  const avg = temps.reduce((a, b) => a + b, 0) / temps.length
  if (avg >= 0 && avg <= 10) return 'refrigerator'
  if (avg < 0) return 'freezer'
  return 'other'
}

export function storageKindLabelJp(kind: StorageKind): string {
  switch (kind) {
    case 'refrigerator':
      return '冷蔵庫（平均温度 0〜10℃）'
    case 'freezer':
      return '冷凍庫（平均温度 0℃未満）'
    default:
      return '室温（平均温度 10℃超・温度の逸脱判定対象外）'
  }
}

/** 短縮ラベル（バッジなど狭いスペース用） */
export function storageKindShortJp(kind: StorageKind): string {
  switch (kind) {
    case 'refrigerator':
      return '冷蔵'
    case 'freezer':
      return '冷凍'
    default:
      return '室温'
  }
}

/** 区分に応じた温度の逸脱閾値（冷凍は冷凍用、冷蔵・その他は冷蔵用） */
export function activeTempRange(
  storageKind: StorageKind,
  t: ReportThresholds,
): { min: number; max: number } {
  if (storageKind === 'freezer') {
    return { min: t.freezerTempMin, max: t.freezerTempMax }
  }
  return { min: t.fridgeTempMin, max: t.fridgeTempMax }
}

/** その指標について逸脱（色・回数）を判定するか
 *  storageKind が 'other'（室温・平均10℃超）の月では温度の逸脱判定はオフ。
 */
export function isMetricDeviationEnabled(
  metric: 'temperature' | 'humidity',
  thresholds: ReportThresholds,
  storageKind?: StorageKind,
): boolean {
  if (metric === 'temperature') {
    if (!thresholds.useTempDeviation) return false
    if (storageKind === 'other') return false
    return true
  }
  if (!thresholds.useHumDeviation) return false
  return true
}

/** 生データに基づく計測回数・平均最大最小、スロット基準の逸脱回数 */
export function summarizeMetric(
  readings: SensorReading[],
  ym: YearMonth,
  metric: 'temperature' | 'humidity',
  thresholds: ReportThresholds,
  storageKind: StorageKind,
): MetricSummary {
  const monthReadings = filterReadingsForMonth(readings, ym)
  const values = monthReadings.map((r) => (metric === 'temperature' ? r.temperature : r.humidity))
  const count = values.length
  if (count === 0) {
    return { count: 0, deviationCount: 0, avg: null, min: null, max: null }
  }
  const min = Math.min(...values)
  const max = Math.max(...values)
  const avg = values.reduce((a, b) => a + b, 0) / count

  const grid = buildMonthlyGrid(readings, ym, metric)
  const tempR = activeTempRange(storageKind, thresholds)
  const tMin = metric === 'temperature' ? tempR.min : thresholds.humMin
  const tMax = metric === 'temperature' ? tempR.max : thresholds.humMax

  let deviationCount = 0
  if (isMetricDeviationEnabled(metric, thresholds, storageKind)) {
    for (const row of grid) {
      for (const cell of row) {
        if (cell == null) continue
        if (isDeviation(cell, tMin, tMax)) deviationCount++
      }
    }
  }

  return { count, deviationCount, avg, min, max }
}

export function formatCellValue(
  v: number | null,
  missing: MissingDisplay,
  decimals: number,
): string {
  if (v == null) return missing === 'hyphen' ? '-' : ''
  return v.toFixed(decimals)
}

/** 任意期間（日／週／月など）に対する集計 */
export function summarizeRange(
  readings: SensorReading[],
  range: { start: Date; end: Date },
  metric: 'temperature' | 'humidity',
  thresholds: ReportThresholds,
  storageKind: StorageKind,
): MetricSummary {
  const filtered = readings.filter(
    (r) => r.measuredAt >= range.start && r.measuredAt < range.end,
  )
  const values = filtered.map((r) =>
    metric === 'temperature' ? r.temperature : r.humidity,
  )
  const count = values.length
  if (count === 0) {
    return { count: 0, deviationCount: 0, avg: null, min: null, max: null }
  }
  const min = Math.min(...values)
  const max = Math.max(...values)
  const avg = values.reduce((a, b) => a + b, 0) / count

  let deviationCount = 0
  if (isMetricDeviationEnabled(metric, thresholds, storageKind)) {
    const slotMs = 30 * 60 * 1000
    const buckets = new Map<number, number[]>()
    for (const r of filtered) {
      const key = Math.floor(r.measuredAt.getTime() / slotMs)
      const v = metric === 'temperature' ? r.temperature : r.humidity
      const list = buckets.get(key)
      if (list) list.push(v)
      else buckets.set(key, [v])
    }
    const tr = activeTempRange(storageKind, thresholds)
    const tMin = metric === 'temperature' ? tr.min : thresholds.humMin
    const tMax = metric === 'temperature' ? tr.max : thresholds.humMax
    for (const vs of buckets.values()) {
      const slotAvg = vs.reduce((a, b) => a + b, 0) / vs.length
      if (slotAvg < tMin || slotAvg > tMax) deviationCount++
    }
  }

  return { count, deviationCount, avg, min, max }
}

/** 任意期間の平均温度から区分（冷蔵／冷凍／室温）を判定 */
export function inferStorageKindForRange(
  readings: SensorReading[],
  range: { start: Date; end: Date },
): StorageKind {
  const filtered = readings.filter(
    (r) => r.measuredAt >= range.start && r.measuredAt < range.end,
  )
  if (filtered.length === 0) return 'other'
  const avg =
    filtered.reduce((a, r) => a + r.temperature, 0) / filtered.length
  if (avg >= 0 && avg <= 10) return 'refrigerator'
  if (avg < 0) return 'freezer'
  return 'other'
}

export function cellIsDeviation(
  v: number | null,
  metric: 'temperature' | 'humidity',
  thresholds: ReportThresholds,
  storageKind: StorageKind,
): boolean {
  if (v == null) return false
  if (!isMetricDeviationEnabled(metric, thresholds, storageKind)) return false
  const tr = activeTempRange(storageKind, thresholds)
  const min = metric === 'temperature' ? tr.min : thresholds.humMin
  const max = metric === 'temperature' ? tr.max : thresholds.humMax
  return isDeviation(v, min, max)
}
