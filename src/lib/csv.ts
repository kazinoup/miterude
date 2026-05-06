import type { SensorReading } from '../types'

/** 先頭の数値を抽出（" -21.6 ℃" → -21.6） */
export function parseNumberWithUnit(s: string | undefined): number | null {
  if (s == null || s === '') return null
  const trimmed = s.trim().replace(/^["']|["']$/g, '')
  const m = trimmed.match(/-?\d+(?:\.\d+)?/)
  if (!m) return null
  return Number(m[0])
}

/** 簡易CSV行パース（ダブルクォート対応） */
function parseCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') {
      inQuotes = !inQuotes
      continue
    }
    if (!inQuotes && c === ',') {
      out.push(cur)
      cur = ''
      continue
    }
    cur += c
  }
  out.push(cur)
  return out
}

function normalizeHeader(h: string): string {
  return h.trim().replace(/^\ufeff/, '').replace(/^["']|["']$/g, '')
}

/**
 * CSVテキストを解析して SensorReading[] にする。
 * 想定列: 時間, 温度, 湿度, バッテリー（他列があっても無視）
 */
export function parseSensorCsv(text: string, deviceId: string): SensorReading[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0)
  if (lines.length === 0) return []

  const headerCells = parseCsvLine(lines[0]).map(normalizeHeader)
  const timeIdx = headerCells.findIndex((h) => h === '時間' || h.toLowerCase() === 'time')
  const tempIdx = headerCells.findIndex((h) => h === '温度' || h.toLowerCase() === 'temperature')
  const humIdx = headerCells.findIndex((h) => h === '湿度' || h.toLowerCase() === 'humidity')
  const batIdx = headerCells.findIndex((h) => h === 'バッテリー' || h.toLowerCase() === 'battery')

  if (timeIdx < 0 || tempIdx < 0 || humIdx < 0) {
    throw new Error(
      `CSVに必要な列がありません（時間・温度・湿度）。ヘッダ: ${headerCells.join(', ')}`,
    )
  }

  const readings: SensorReading[] = []
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]).map((c) => c.trim())
    const timeStr = cells[timeIdx]?.replace(/^["']|["']$/g, '') ?? ''
    if (!timeStr) continue

    const t = new Date(timeStr.replace(/\//g, '-'))
    if (Number.isNaN(t.getTime())) continue

    const temp = parseNumberWithUnit(cells[tempIdx])
    const hum = parseNumberWithUnit(cells[humIdx])
    const bat = batIdx >= 0 ? parseNumberWithUnit(cells[batIdx]) : null

    if (temp == null || hum == null) continue

    readings.push({
      deviceId,
      measuredAt: t,
      temperature: temp,
      humidity: hum,
      battery: bat ?? undefined,
    })
  }

  readings.sort((a, b) => a.measuredAt.getTime() - b.measuredAt.getTime())
  return readings
}

export function deviceIdFromFileName(fileName: string): string {
  const base = fileName.replace(/\.[^/.]+$/, '')
  return base || fileName
}
