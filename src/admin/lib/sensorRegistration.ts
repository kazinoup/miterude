/**
 * センサー / ゲートウェイの **admin による手動登録** に使うヘルパ。
 *
 * - テナントの `tenantState.sensors` / `gateways` に新規 INSERT
 * - 衝突検知（deviceNumber / serialNumber / devEUI の重複は弾く）
 * - 単発登録 / 一括（TSV）登録の両方から再利用される
 */
import {
  gatewaysFromState,
  loadState,
  saveState,
  sensorsFromState,
  withGateways,
  withSensors,
} from '../../lib/storage'
import { defaultAlertSettings, defaultGatewayAlertSettings } from '../../lib/mock'
import {
  externalKeyFieldFor,
  inferDeviceRoleFromModel,
} from '../../lib/supportedDevices'
import type { GatewayRole, SensorKind, SensorRole } from '../../types'

/** センサー追加の入力パラメタ。任意項目は省略可。 */
export type SensorDraft = {
  /** ユニーク識別子（id）。重複不可。例: CK01 / CBO-039 */
  id: string
  deviceNumber: string
  name: string
  serialNumber: string
  devEUI: string
  model: string
  manufacturer: string
  gatewayId: string
  kind: SensorKind
  groupId?: string | null
  categoryId?: string | null
}

export type GatewayDraft = {
  /** ID（GW01 / UG-65-1 等。Gateway 型には deviceNumber 列が無いので id を識別子兼用） */
  id: string
  name: string
  serialNumber: string
  devEUI: string
  model: string
  manufacturer: string
  location: string
}

export type ValidationIssue = {
  /** 入力上の何番目のレコードか（0-based。単発のときは 0） */
  index: number
  /** 何のフィールド由来か */
  field: keyof SensorDraft | keyof GatewayDraft | 'row'
  message: string
}

/* ---------- 衝突検知 ---------- */

/** センサー一括投入のバリデーション。
 *  既存テナント state との重複 + ドラフト同士の重複を検知。 */
export function validateSensorDrafts(
  drafts: SensorDraft[],
  organizationId: string,
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const state = loadState(organizationId)
  const sensors = state ? sensorsFromState(state) : {}
  const gateways = state ? gatewaysFromState(state) : {}

  const existingIds = new Set(Object.keys(sensors))
  const existingDeviceNumbers = new Set(
    Object.values(sensors).map((s) => s.deviceNumber.toUpperCase()),
  )
  const existingSerials = new Set(
    Object.values(sensors).map((s) => s.serialNumber.toUpperCase()),
  )
  const existingDevEUIs = new Set(
    Object.values(sensors)
      .filter((s) => !!s.devEUI)
      .map((s) => (s.devEUI as string).toUpperCase()),
  )
  const validGatewayIds = new Set(Object.keys(gateways))

  // ドラフト内の重複検知用
  const draftIds = new Map<string, number[]>()
  const draftDeviceNumbers = new Map<string, number[]>()
  const draftSerials = new Map<string, number[]>()
  const draftDevEUIs = new Map<string, number[]>()

  drafts.forEach((d, i) => {
    if (!d.id.trim()) issues.push({ index: i, field: 'id', message: 'ID が空です' })
    if (!d.deviceNumber.trim())
      issues.push({ index: i, field: 'deviceNumber', message: 'デバイス番号が空です' })
    if (!d.name.trim())
      issues.push({ index: i, field: 'name', message: '表示名が空です' })
    if (!d.serialNumber.trim())
      issues.push({ index: i, field: 'serialNumber', message: 'シリアル番号が空です' })
    if (!d.devEUI.trim())
      issues.push({ index: i, field: 'devEUI', message: 'DevEUI が空です' })
    if (!d.model.trim())
      issues.push({ index: i, field: 'model', message: 'モデルが空です' })
    // ゲートウェイは任意。Milesight は近隣の GW が自動で受信するため、
    // センサー登録時に紐付けを必須にしない。指定されたときだけ存在チェック。
    if (d.gatewayId.trim() && !validGatewayIds.has(d.gatewayId))
      issues.push({
        index: i,
        field: 'gatewayId',
        message: `ゲートウェイ "${d.gatewayId}" が登録されていません`,
      })

    // 既存との衝突
    if (existingIds.has(d.id)) {
      issues.push({ index: i, field: 'id', message: `ID "${d.id}" は既に登録済` })
    }
    if (existingDeviceNumbers.has(d.deviceNumber.toUpperCase())) {
      issues.push({
        index: i,
        field: 'deviceNumber',
        message: `デバイス番号 "${d.deviceNumber}" は既に登録済`,
      })
    }
    if (existingSerials.has(d.serialNumber.toUpperCase())) {
      issues.push({
        index: i,
        field: 'serialNumber',
        message: `シリアル "${d.serialNumber}" は既に登録済`,
      })
    }
    if (existingDevEUIs.has(d.devEUI.toUpperCase())) {
      issues.push({
        index: i,
        field: 'devEUI',
        message: `DevEUI "${d.devEUI}" は既に登録済`,
      })
    }

    // ドラフト同士の衝突を蓄積
    pushTo(draftIds, d.id, i)
    pushTo(draftDeviceNumbers, d.deviceNumber.toUpperCase(), i)
    pushTo(draftSerials, d.serialNumber.toUpperCase(), i)
    if (d.devEUI) pushTo(draftDevEUIs, d.devEUI.toUpperCase(), i)
  })

  // ドラフト内重複
  reportDup(issues, draftIds, 'id', 'ID')
  reportDup(issues, draftDeviceNumbers, 'deviceNumber', 'デバイス番号')
  reportDup(issues, draftSerials, 'serialNumber', 'シリアル')
  reportDup(issues, draftDevEUIs, 'devEUI', 'DevEUI')

  return issues
}

function pushTo(map: Map<string, number[]>, key: string, idx: number) {
  if (!key) return
  const list = map.get(key)
  if (list) list.push(idx)
  else map.set(key, [idx])
}

function reportDup(
  issues: ValidationIssue[],
  map: Map<string, number[]>,
  field: ValidationIssue['field'],
  label: string,
) {
  for (const [key, list] of map.entries()) {
    if (list.length < 2) continue
    list.forEach((i) =>
      issues.push({
        index: i,
        field,
        message: `${label} "${key}" が他の行と重複しています（行 ${list.map((x) => x + 1).join(', ')}）`,
      }),
    )
  }
}

/* ---------- 投入 ---------- */

/** ドラフトを実際に sensors にコミット（衝突なしを前提）。 */
export function commitSensorDrafts(
  drafts: SensorDraft[],
  organizationId: string,
): { added: number } {
  const state = loadState(organizationId)
  if (!state) return { added: 0 }
  const now = new Date()
  const newSensors = { ...sensorsFromState(state) }
  for (const d of drafts) {
    // 役割は model から推定。未知モデルなら sensorKind をそのまま流用。
    const inferredRole = inferDeviceRoleFromModel(d.model) as
      | SensorRole
      | undefined
    const role: SensorRole = inferredRole ?? (d.kind as SensorRole)
    // externalKey: メーカーごとの規約に従う
    const keyField = externalKeyFieldFor(d.manufacturer)
    const externalKey =
      keyField === 'devEUI' ? d.devEUI || d.serialNumber : d.serialNumber
    newSensors[d.id] = {
      id: d.id,
      deviceType: 'sensor',
      role,
      name: d.name,
      deviceNumber: d.deviceNumber,
      serialNumber: d.serialNumber,
      devEUI: d.devEUI || undefined,
      externalKey,
      model: d.model,
      manufacturer: d.manufacturer,
      gatewayId: d.gatewayId,
      battery: 100,
      online: false,
      lastSeenAt: now,
      registeredAt: now,
      alertSettings: defaultAlertSettings(),
      kind: d.kind,
      groupId: d.groupId ?? null,
      categoryId: d.categoryId ?? null,
      tags: [],
      notificationGroupId: null,
    }
  }
  saveState(withSensors(state, newSensors), organizationId)
  return { added: drafts.length }
}

/* ---------- ゲートウェイ追加 ---------- */

export function validateGatewayDrafts(
  drafts: GatewayDraft[],
  organizationId: string,
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const state = loadState(organizationId)
  const gateways = state ? gatewaysFromState(state) : {}

  const existingIds = new Set(Object.keys(gateways))
  const existingSerials = new Set(
    Object.values(gateways).map((g) => g.serialNumber.toUpperCase()),
  )
  const existingDevEUIs = new Set(
    Object.values(gateways)
      .filter((g) => !!g.devEUI)
      .map((g) => (g.devEUI as string).toUpperCase()),
  )

  const draftIds = new Map<string, number[]>()
  const draftSerials = new Map<string, number[]>()
  const draftDevEUIs = new Map<string, number[]>()

  drafts.forEach((d, i) => {
    if (!d.id.trim()) issues.push({ index: i, field: 'id', message: 'ID が空です' })
    if (!d.name.trim())
      issues.push({ index: i, field: 'name', message: '名前が空です' })
    if (!d.serialNumber.trim())
      issues.push({ index: i, field: 'serialNumber', message: 'シリアル番号が空です' })
    if (!d.devEUI.trim())
      issues.push({ index: i, field: 'devEUI', message: 'DevEUI が空です' })
    if (!d.model.trim())
      issues.push({ index: i, field: 'model', message: 'モデルが空です' })

    if (existingIds.has(d.id))
      issues.push({ index: i, field: 'id', message: `ID "${d.id}" は既に登録済` })
    if (existingSerials.has(d.serialNumber.toUpperCase()))
      issues.push({
        index: i,
        field: 'serialNumber',
        message: `シリアル "${d.serialNumber}" は既に登録済`,
      })
    if (existingDevEUIs.has(d.devEUI.toUpperCase()))
      issues.push({
        index: i,
        field: 'devEUI',
        message: `DevEUI "${d.devEUI}" は既に登録済`,
      })

    pushTo(draftIds, d.id, i)
    pushTo(draftSerials, d.serialNumber.toUpperCase(), i)
    if (d.devEUI) pushTo(draftDevEUIs, d.devEUI.toUpperCase(), i)
  })

  reportDup(issues, draftIds, 'id', 'ID')
  reportDup(issues, draftSerials, 'serialNumber', 'シリアル')
  reportDup(issues, draftDevEUIs, 'devEUI', 'DevEUI')

  return issues
}

export function commitGatewayDrafts(
  drafts: GatewayDraft[],
  organizationId: string,
): { added: number } {
  const state = loadState(organizationId)
  if (!state) return { added: 0 }
  const now = new Date()
  const newGateways = { ...gatewaysFromState(state) }
  for (const d of drafts) {
    const inferredRole = inferDeviceRoleFromModel(d.model) as
      | GatewayRole
      | undefined
    const role: GatewayRole = inferredRole ?? 'master'
    const keyField = externalKeyFieldFor(d.manufacturer)
    const externalKey =
      keyField === 'devEUI' ? d.devEUI || d.serialNumber : d.serialNumber
    newGateways[d.id] = {
      id: d.id,
      deviceType: 'gateway',
      role,
      name: d.name,
      deviceNumber: d.id,
      serialNumber: d.serialNumber,
      devEUI: d.devEUI || undefined,
      externalKey,
      model: d.model,
      manufacturer: d.manufacturer,
      location: d.location,
      online: false,
      lastSeenAt: now,
      registeredAt: now,
      categoryId: null,
      groupId: null,
      tags: [],
      notificationGroupId: null,
      alertSettings: defaultGatewayAlertSettings(),
    }
  }
  saveState(withGateways(state, newGateways), organizationId)
  return { added: drafts.length }
}

/* ---------- TSV パース（一括投入用） ---------- */

/** TSV / CSV テキストを行配列に分割（タブ区切り優先、なければカンマ）。
 *  ダブルクォート対応は最小限。 */
export function parsePastedRows(text: string): string[][] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0)
  if (lines.length === 0) return []
  // 最初の行に \t が含まれていれば TSV、なければ CSV と判定
  const useTsv = lines[0].includes('\t')
  return lines.map((line) =>
    useTsv ? line.split('\t').map((c) => c.trim()) : splitCsvLine(line).map((c) => c.trim()),
  )
}

/** kind 列の文字列を SensorKind に正規化（既知の種別のみ）。 */
function parseSensorKind(raw: string | undefined): SensorKind | null {
  if (!raw) return null
  const v = raw.trim().toLowerCase()
  if (!v) return null
  if (v === 'temperature-humidity' || v.includes('温湿度')) return 'temperature-humidity'
  if (v === 'analog-meter' || v.includes('アナログ')) return 'analog-meter'
  if (v === 'door' || v.includes('扉') || v.includes('ドア')) return 'door'
  if (v === 'water-level' || v.includes('水位')) return 'water-level'
  if (v === 'current' || v.includes('電流')) return 'current'
  return null
}

function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQ = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') {
      inQ = !inQ
      continue
    }
    if (!inQ && c === ',') {
      out.push(cur)
      cur = ''
      continue
    }
    cur += c
  }
  out.push(cur)
  return out
}

/* ---------- TSV 行 → SensorDraft ---------- */

/** 想定列順:
 *  0: id (= deviceNumber と兼用) / 1: シリアル / 2: DevEUI / 3: 名前 /
 *  4: モデル / 5: メーカー / 6: ゲートウェイID / 7: 種別（任意, 既定 temperature-humidity）
 */
export const SENSOR_TSV_HEADERS = [
  'ID（デバイス番号）',
  'シリアル番号',
  'DevEUI',
  '表示名',
  'モデル',
  'メーカー',
  'ゲートウェイID（任意）',
  '種別（任意）',
] as const

export function rowToSensorDraft(cells: string[]): SensorDraft {
  const [id, sn, devEUI, name, model, manufacturer, gw, kindRaw] = cells
  // 種別は今のところ温湿度のみサポート。Phase F 以降で他種別を追加するときに拡張。
  const kind: SensorKind = parseSensorKind(kindRaw) ?? 'temperature-humidity'
  return {
    id: (id ?? '').trim(),
    deviceNumber: (id ?? '').trim(),
    serialNumber: (sn ?? '').trim(),
    devEUI: (devEUI ?? '').trim(),
    name: (name ?? '').trim(),
    model: (model ?? 'EM320-TH').trim(),
    manufacturer: (manufacturer ?? 'Milesight').trim(),
    gatewayId: (gw ?? '').trim(),
    kind,
  }
}

export const GATEWAY_TSV_HEADERS = [
  'ID（GW番号）',
  'シリアル番号',
  'DevEUI',
  '名前',
  'モデル',
  'メーカー',
  '設置場所',
] as const

export function rowToGatewayDraft(cells: string[]): GatewayDraft {
  const [id, sn, devEUI, name, model, manufacturer, location] = cells
  return {
    id: (id ?? '').trim(),
    serialNumber: (sn ?? '').trim(),
    devEUI: (devEUI ?? '').trim(),
    name: (name ?? '').trim(),
    model: (model ?? 'UG65').trim(),
    manufacturer: (manufacturer ?? 'Milesight').trim(),
    location: (location ?? '').trim(),
  }
}
