/**
 * Phase F-3 (mock 段階): admin の CSV 移行インポートに使うパース・紐付けロジック。
 *
 * - CSV パースは既存の `src/lib/csv.ts` を再利用（Milesight 純正フォーマット対応）
 * - ファイル名 → センサー の自動マッチングは段階的（deviceNumber → serial → name）
 * - インポート実行時は `tenantState.devices[sensorId]` に readings を append
 *   - `(sensor_id, measured_at)` ユニーク扱いで重複行は skip
 */
import { parseSensorCsv } from '../../lib/csv'
import type { Sensor, SensorReading, SensorStore } from '../../types'

/* ---------- 型 ---------- */

export type MatchReason =
  | 'devicenumber' // ファイル名先頭が sensors.deviceNumber と一致
  | 'deveui' // ファイル名に sensors.devEUI が含まれる
  | 'serial' // ファイル名に sensors.serialNumber が含まれる
  | 'name' // ファイル名（拡張子除く）が sensors.name を含む
  | 'manual' // admin が手動で選んだ
  | 'none' // 自動マッチしなかった（要選択）

export type ParsedFile = {
  /** ユニークキー（同名ファイルが 2 度ドロップされた場合の識別） */
  key: string
  filename: string
  size: number
  /** パース結果。pasreError があるときは空配列 */
  readings: SensorReading[]
  /** 観測期間の最古〜最新（readings が空なら null） */
  period: { from: Date | null; to: Date | null }
  /** 自動マッチで提案されたセンサーID。ない場合は null（要選択） */
  suggestedSensorId: string | null
  /** 現在選択中の対象センサー。
   *  null = 未選択（要選択）, 'skip' = スキップ */
  selectedSensorId: string | 'skip' | null
  matchReason: MatchReason
  /** パースエラーがあれば説明文 */
  parseError?: string
}

/** プレビュー時の件数集計（実際の取り込み前にユーザに見せる） */
export type ImportPreview = {
  /** マッチ済 + 取り込み予定のファイル数 */
  fileCount: number
  /** 新規 INSERT 予定行数（重複 skip を除外済み） */
  rowsToAdd: number
  /** 既存と重複していたため skip 予定の行数 */
  rowsToSkip: number
  /** スキップ指定（'skip'）のファイル数 */
  skippedFiles: number
  /** 未選択のファイル数（コミット不可の理由） */
  pendingFiles: number
}

export type ImportResult = {
  /** 取り込んだファイル数（skip / pending を除く） */
  fileCount: number
  /** 実際に INSERT した行数 */
  rowsAdded: number
  /** 重複 skip の行数 */
  rowsSkipped: number
  /** 未選択でコミット時に弾かれたファイル名 */
  unresolvedFiles: string[]
}

/* ---------- ファイル名 → センサー マッチング ---------- */

/** ファイル名（拡張子除く）から先頭のデバイス番号らしき部分を抽出。
 *  例: `CK01：3F製品冷凍庫1.csv` → `'CK01'`
 *      `DV-001_office.csv`      → `'DV-001'`
 *      `2025-temp.csv`          → null（数字だけは除外） */
export function extractDeviceNumberPrefix(filename: string): string | null {
  const base = filename.replace(/\.[^/.]+$/, '')
  // アルファベット 1〜5 文字 + （ハイフン / アンダースコアは任意）+ 数字 1〜5 文字
  const m = base.match(/^([A-Za-z]{1,5}[-_]?\d{1,5})/)
  if (!m) return null
  return m[1]
}

/** 比較用: ハイフン / アンダースコアを除去して大文字化。
 *  `DV-001` も `DV001` も同一視する */
function normalizeDeviceNumber(s: string): string {
  return s.replace(/[-_]/g, '').toUpperCase()
}

/** ファイル名に対する最良マッチを 1 件返す（マッチしなければ null）。 */
export function matchFileToSensor(
  filename: string,
  sensors: SensorStore,
): { sensor: Sensor; reason: MatchReason } | null {
  const all = Object.values(sensors)
  const baseName = filename.replace(/\.[^/.]+$/, '')
  const upperBase = baseName.toUpperCase()

  // 1) deviceNumber 先頭一致（ハイフン無視で照合）
  const deviceNumberPrefix = extractDeviceNumberPrefix(filename)
  if (deviceNumberPrefix) {
    const normalizedPrefix = normalizeDeviceNumber(deviceNumberPrefix)
    const hit = all.find(
      (s) => normalizeDeviceNumber(s.deviceNumber) === normalizedPrefix,
    )
    if (hit) return { sensor: hit, reason: 'devicenumber' }
  }

  // 2) DevEUI がファイル名に含まれる
  for (const s of all) {
    if (!s.devEUI) continue
    if (upperBase.includes(s.devEUI.toUpperCase())) {
      return { sensor: s, reason: 'deveui' }
    }
  }

  // 3) シリアル番号がファイル名に含まれる
  for (const s of all) {
    if (!s.serialNumber) continue
    if (upperBase.includes(s.serialNumber.toUpperCase())) {
      return { sensor: s, reason: 'serial' }
    }
  }

  // 4) name のあいまいマッチ（ファイル名が name の一部を含む or 逆）
  for (const s of all) {
    if (!s.name) continue
    if (baseName.includes(s.name) || s.name.includes(baseName)) {
      return { sensor: s, reason: 'name' }
    }
  }

  return null
}

/* ---------- CSV ファイル → ParsedFile ---------- */

/** 1 ファイルを読み込んでパース + 自動マッチを実行する。 */
export async function parseAndMatch(
  file: File,
  sensors: SensorStore,
  keySuffix = 0,
): Promise<ParsedFile> {
  const key = `${file.name}::${file.size}::${file.lastModified}::${keySuffix}`
  let text: string
  try {
    text = await file.text()
  } catch (e) {
    return {
      key,
      filename: file.name,
      size: file.size,
      readings: [],
      period: { from: null, to: null },
      suggestedSensorId: null,
      selectedSensorId: null,
      matchReason: 'none',
      parseError: `ファイル読み込みエラー: ${(e as Error).message}`,
    }
  }

  let readings: SensorReading[] = []
  let parseError: string | undefined
  try {
    // パース時の deviceId はダミー（後段でユーザが対象センサーを確定する）
    readings = parseSensorCsv(text, '__pending__')
  } catch (e) {
    parseError = (e as Error).message
  }

  const match = matchFileToSensor(file.name, sensors)
  const period = readings.length
    ? {
        from: readings[0].measuredAt,
        to: readings[readings.length - 1].measuredAt,
      }
    : { from: null, to: null }

  return {
    key,
    filename: file.name,
    size: file.size,
    readings,
    period,
    suggestedSensorId: match?.sensor.id ?? null,
    selectedSensorId: match?.sensor.id ?? null,
    matchReason: match?.reason ?? 'none',
    parseError,
  }
}

/* ---------- プレビュー件数の計算 ---------- */

/** プレビュー画面で「N 件追加 / K 件 skip / 未選択 X 件」を出すための集計。 */
export function computePreview(
  files: ParsedFile[],
  existingByDeviceId: Record<string, SensorReading[]>,
): ImportPreview {
  let fileCount = 0
  let rowsToAdd = 0
  let rowsToSkip = 0
  let skippedFiles = 0
  let pendingFiles = 0

  for (const f of files) {
    if (f.parseError) {
      // パースエラーは除外
      continue
    }
    if (f.selectedSensorId === null) {
      pendingFiles++
      continue
    }
    if (f.selectedSensorId === 'skip') {
      skippedFiles++
      continue
    }
    fileCount++
    const existing = existingByDeviceId[f.selectedSensorId] ?? []
    const existingTimes = new Set(
      existing.map((r) => new Date(r.measuredAt).getTime()),
    )
    for (const r of f.readings) {
      if (existingTimes.has(r.measuredAt.getTime())) {
        rowsToSkip++
      } else {
        rowsToAdd++
      }
    }
  }
  return { fileCount, rowsToAdd, rowsToSkip, skippedFiles, pendingFiles }
}

/* ---------- インポート実行 ---------- */

/** 既存 readings に新規 readings をマージ（measuredAt の重複は skip）。
 *  返り値は (新しい配列, 追加件数, skip件数)。 */
export function mergeReadings(
  existing: SensorReading[],
  incoming: SensorReading[],
  targetDeviceId: string,
): { merged: SensorReading[]; added: number; skipped: number } {
  const existingTimes = new Set(
    existing.map((r) => new Date(r.measuredAt).getTime()),
  )
  let added = 0
  let skipped = 0
  const newRows: SensorReading[] = []
  for (const r of incoming) {
    if (existingTimes.has(r.measuredAt.getTime())) {
      skipped++
      continue
    }
    newRows.push({
      ...r,
      deviceId: targetDeviceId,
    })
    existingTimes.add(r.measuredAt.getTime())
    added++
  }
  // 既存 + 新規 をマージして時刻順にソート
  const merged = [...existing, ...newRows].sort(
    (a, b) =>
      new Date(a.measuredAt).getTime() - new Date(b.measuredAt).getTime(),
  )
  return { merged, added, skipped }
}
