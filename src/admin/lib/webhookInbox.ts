/**
 * Phase F-3 のモック実装。
 *
 * 本番では Vercel API Route が受信した Webhook を Supabase の `webhook_inbox`
 * テーブルへ INSERT し、5 分おきの cron で `process_webhook_inbox` Edge
 * Function が pending → processed/unmatched に仕分ける構成（docs/milesight-integration-plan.md
 * Section F-3）。
 *
 * モック側ではこれを localStorage キー `miterude:admin:webhook_inbox` に
 * 集約して再現する。Admin が Webhook を疑似投入したり、仕分けバッチを
 * 手動 invoke できるようにすることで、Webhook 受信前提の運用フロー
 * （事前登録 / 後追い登録）を UI 上で確認できるようにするのが目的。
 *
 * 主なエンティティ: WebhookInboxItem
 * 主なフロー:
 *   1. seedMockWebhooks(orgId, n) で疑似 webhook を投入（pending）
 *   2. processInbox() で sensor マスタと照合（pending → processed/unmatched）
 *   3. unmatched が出たら admin が
 *      a. CreateSensorDialog で sensor 登録 → reprocessForDevEUI で pending に戻す
 *      b. ignoreUnmatchedDevEUI で誤送信扱いにして黙らせる
 *   4. 再 processInbox() で processed に解消
 */
import { loadOrganizations, newId } from './adminStorage'
import { loadState, sensorsFromState } from '../../lib/storage'

const KEY = 'miterude:admin:webhook_inbox'

/* ---------- 型 ---------- */

export type WebhookEventType = 'DEVICE_DATA' | 'WEBHOOK_TEST'

export type WebhookDataType =
  | 'ONLINE'
  | 'OFFLINE'
  | 'EVENT'
  | 'PROPERTY'
  | 'SERVICE'

export type WebhookParseStatus =
  | 'pending'
  | 'processed'
  | 'unmatched'
  | 'ignored'

/** Milesight が送ってくる Webhook 1 イベントの生 JSON 形（実機観測ベース）。
 *  実バックエンドでは `webhook_inbox.payload_raw JSONB` にそのまま入る想定。 */
export type MilesightRawEvent = {
  data: {
    ts?: number
    type: WebhookDataType
    tslId?: string
    payload?: Record<string, unknown>
    deviceProfile: {
      sn: string
      name: string
      model: string
      devEUI: string
      deviceId?: number
    }
  }
  eventId: string
  eventType: WebhookEventType
  eventVersion: string
  eventCreatedTime: number
}

/** モック上の webhook_inbox 行。
 *  実 Supabase スキーマでは:
 *   - `payload_raw JSONB` = `payloadRaw`
 *   - `event_id` (UNIQUE) = `payloadRaw.eventId`
 *   - `received_at` = `receivedAt`
 *   - `parse_status` = `parseStatus`
 *  に対応する。UI 表示の便利さのため、payload から抽出した値も別フィールドで持つ。 */
export type WebhookInboxItem = {
  id: string
  organizationId: string
  /** 16 字 HEX 大文字。Milesight の `devEUI`。 */
  devEUI: string
  /** PROPERTY イベントから推定したモデル（あれば）。 */
  model?: string
  eventType: WebhookEventType
  dataType?: WebhookDataType
  /** 表示用に payload から抜き出した値（モックの簡易表示で使う）。
   *  実 Milesight の PROPERTY は payload キー集合で 5 系統に分類される
   *  （環境計測 / バッテリー / デバイスメタ / 機能宣言 / その他メタ）。 */
  payload?: {
    temperature?: number
    humidity?: number
    battery?: number
    /** デバイスメタ系（firmware_version 等）を持つ PROPERTY だと示すマーカ */
    metaKind?: 'ipso' | 'sensor_enable' | 'versions'
  }
  /** Milesight から実際に届いた生 JSON（1 イベント分）。
   *  実バックエンドの `webhook_inbox.payload_raw` 相当。
   *  モックでは UI 検証のため seeder で生成する。 */
  payloadRaw?: MilesightRawEvent
  receivedAt: Date
  parseStatus: WebhookParseStatus
  /** processed のときに紐付いた sensor id。 */
  matchedSensorId?: string
  processedAt?: Date
  /** ignored したときの日時とユーザ。 */
  ignoredAt?: Date
  ignoredByUserId?: string
}

export type WebhookInboxStore = Record<string, WebhookInboxItem>

/* ---------- 永続化 ---------- *
 * JSON.stringify が Date を ISO 文字列で書き出すので、読み戻し時は
 * 代表的な Date フィールドを明示的に new Date() で復元する。
 * （WebhookInboxItem は Date を含む構造が単純なので個別に拾うので十分） */

function toDate(v: unknown): Date | undefined {
  if (!v) return undefined
  if (v instanceof Date) return v
  if (typeof v === 'string' || typeof v === 'number') {
    const d = new Date(v)
    return Number.isNaN(d.getTime()) ? undefined : d
  }
  return undefined
}

function rehydrate(item: WebhookInboxItem): WebhookInboxItem {
  return {
    ...item,
    receivedAt: toDate(item.receivedAt) ?? new Date(0),
    processedAt: toDate(item.processedAt),
    ignoredAt: toDate(item.ignoredAt),
  }
}

export function loadWebhookInbox(): WebhookInboxStore {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as WebhookInboxStore
    const out: WebhookInboxStore = {}
    for (const [k, v] of Object.entries(parsed)) {
      out[k] = rehydrate(v)
    }
    return out
  } catch {
    return {}
  }
}

export function saveWebhookInbox(store: WebhookInboxStore): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(store))
  } catch (e) {
    console.warn('[miterude-admin] webhook_inbox write failed:', e)
  }
}

/* ---------- 仕分けバッチ ---------- */

export type ProcessResult = {
  processed: number
  unmatched: number
}

/** pending を全部仕分ける（org 横断）。
 *  - 該当 org の sensors に同 devEUI があれば processed
 *  - なければ unmatched */
export function processInbox(): ProcessResult {
  const store = loadWebhookInbox()
  const orgs = loadOrganizations()
  const now = new Date()
  const next: WebhookInboxStore = { ...store }
  let processed = 0
  let unmatched = 0

  // org ごとに sensors の devEUI セットをキャッシュ（loadState が重いため）
  const sensorsByOrg = new Map<string, Map<string, string>>()
  function devEUIMapFor(orgId: string): Map<string, string> {
    const cached = sensorsByOrg.get(orgId)
    if (cached) return cached
    const state = loadState(orgId)
    const m = new Map<string, string>()
    if (state) {
      for (const s of Object.values(sensorsFromState(state))) {
        if (s.devEUI) m.set(s.devEUI.toUpperCase(), s.id)
      }
    }
    sensorsByOrg.set(orgId, m)
    return m
  }

  for (const item of Object.values(store)) {
    if (item.parseStatus !== 'pending') continue
    if (!orgs[item.organizationId]) {
      // org 自体が消えていたら unmatched 扱いで残す
      next[item.id] = {
        ...item,
        parseStatus: 'unmatched',
        processedAt: now,
      }
      unmatched++
      continue
    }
    const map = devEUIMapFor(item.organizationId)
    const matched = map.get(item.devEUI.toUpperCase())
    if (matched) {
      next[item.id] = {
        ...item,
        parseStatus: 'processed',
        matchedSensorId: matched,
        processedAt: now,
      }
      processed++
    } else {
      next[item.id] = {
        ...item,
        parseStatus: 'unmatched',
        processedAt: now,
      }
      unmatched++
    }
  }

  saveWebhookInbox(next)
  return { processed, unmatched }
}

/* ---------- モック用 seeder ---------- */

const HEX = '0123456789ABCDEF'

function randomHex(len: number): string {
  let s = ''
  for (let i = 0; i < len; i++) s += HEX[Math.floor(Math.random() * 16)]
  return s
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

/** UUID v4 風の文字列を生成（モック用、暗号学的な強度は不要）。 */
function randomUuid(): string {
  const seg = (n: number) => randomHex(n).toLowerCase()
  return `${seg(8)}-${seg(4)}-${seg(4)}-${seg(4)}-${seg(12)}`
}

/** Milesight が送ってくる 1 イベントの生 JSON を組み立てる（実機観測ベース）。
 *  デバイス名（deviceProfile.name）は MDP 登録者の手入力。デフォルトはモデル名。 */
function buildRawEvent(args: {
  devEUI: string
  sn: string
  model: string
  deviceName?: string
  deviceId?: number
  type: WebhookDataType
  ts?: number
  tslId?: string
  payload?: Record<string, unknown>
  eventCreatedTime: number
}): MilesightRawEvent {
  return {
    data: {
      ...(args.ts != null ? { ts: args.ts } : {}),
      type: args.type,
      ...(args.tslId ? { tslId: args.tslId } : {}),
      ...(args.payload ? { payload: args.payload } : {}),
      deviceProfile: {
        sn: args.sn,
        name: args.deviceName ?? args.model,
        model: args.model,
        devEUI: args.devEUI,
        ...(args.deviceId != null ? { deviceId: args.deviceId } : {}),
      },
    },
    eventId: randomUuid(),
    eventType: 'DEVICE_DATA',
    eventVersion: '1.0',
    eventCreatedTime: args.eventCreatedTime,
  }
}

/** 擬似的に Webhook を N 件投入する（モック用）。
 *
 *  実 Milesight の仕様に合わせて:
 *  - 既存 sensor の devEUI と未登録 devEUI を約半々で混ぜる
 *  - PROPERTY は **環境データイベント + バッテリーイベントの 2 件** に分割（同 `ts` で eventId 別）
 *  - たまに EVENT/historical_data を 1 件混ぜる（過去測定値の追送パターン）
 *
 *  count は「センサー回数」基準。1 回ごとに 2〜3 件の inbox 行が作られる。 */
export function seedMockWebhooks(orgId: string, count: number = 5): number {
  const store = loadWebhookInbox()
  const next: WebhookInboxStore = { ...store }
  const state = loadState(orgId)
  const existingDevEUIs = state
    ? Object.values(sensorsFromState(state))
        .map((s) => (s.devEUI ?? '').toUpperCase())
        .filter(Boolean)
    : []

  let added = 0
  const now = Date.now()
  const model = 'EM320-TH'
  for (let i = 0; i < count; i++) {
    // 既存 sensor を半分ヒットさせるが、登録センサーが居ないときは
    // 100% 未登録 DevEUI を生成する。
    const useExisting =
      existingDevEUIs.length > 0 && Math.random() < 0.5
    const devEUI = useExisting
      ? pickRandom(existingDevEUIs)
      : `24E124${randomHex(10)}`
    const sn = `6785E5${randomHex(10).slice(0, 10)}`
    const deviceId = Math.floor(Math.random() * 1e15) + 2_052_900_000_000_000
    // 同 ts で送られる 1 セット
    const sharedTsMs = now - Math.floor(Math.random() * 10 * 60 * 1000)
    const sharedTsSec = Math.floor(sharedTsMs / 1000)
    const sharedDate = new Date(sharedTsMs)
    const temperature = Math.round((Math.random() * 35 - 5) * 10) / 10
    const humidity = Math.round(Math.random() * 1000) / 10
    const battery = Math.floor(Math.random() * 100)

    // 環境データ（PROPERTY: { humidity, temperature }）
    const envRaw = buildRawEvent({
      devEUI,
      sn,
      model,
      deviceId,
      type: 'PROPERTY',
      ts: sharedTsMs,
      payload: { humidity, temperature },
      eventCreatedTime: sharedTsSec,
    })
    const envItem: WebhookInboxItem = {
      id: newId('wbi'),
      organizationId: orgId,
      devEUI,
      eventType: 'DEVICE_DATA',
      dataType: 'PROPERTY',
      model,
      payload: { temperature, humidity },
      receivedAt: sharedDate,
      parseStatus: 'pending',
      payloadRaw: envRaw,
    }
    next[envItem.id] = envItem
    added++

    // バッテリー（PROPERTY: { battery } — 別 eventId、同 ts）
    const batRaw = buildRawEvent({
      devEUI,
      sn,
      model,
      deviceId,
      type: 'PROPERTY',
      ts: sharedTsMs,
      payload: { battery },
      eventCreatedTime: sharedTsSec,
    })
    const batItem: WebhookInboxItem = {
      id: newId('wbi'),
      organizationId: orgId,
      devEUI,
      eventType: 'DEVICE_DATA',
      dataType: 'PROPERTY',
      model,
      payload: { battery },
      receivedAt: sharedDate,
      parseStatus: 'pending',
      payloadRaw: batRaw,
    }
    next[batItem.id] = batItem
    added++

    // 30% の確率で historical_data を 1 件追加（過去測定値の追送パターン）
    if (Math.random() < 0.3) {
      // historical_data は data.ts が現在時刻、payload.timestamp が過去（秒）
      const pastSec = Math.floor((now - 60 * 60 * 1000) / 1000)
      const histRaw = buildRawEvent({
        devEUI,
        sn,
        model,
        deviceId,
        type: 'EVENT',
        ts: now,
        tslId: 'historical_data',
        payload: { humidity, temperature, timestamp: pastSec },
        eventCreatedTime: Math.floor(now / 1000),
      })
      const histItem: WebhookInboxItem = {
        id: newId('wbi'),
        organizationId: orgId,
        devEUI,
        eventType: 'DEVICE_DATA',
        dataType: 'EVENT',
        model,
        payload: { temperature, humidity },
        receivedAt: new Date(now),
        parseStatus: 'pending',
        payloadRaw: histRaw,
      }
      next[histItem.id] = histItem
      added++
    }
  }
  saveWebhookInbox(next)
  return added
}

/* ---------- 集計 ---------- */

/** unmatched サマリ（DevEUI 単位で集約） */
export type UnmatchedSummary = {
  devEUI: string
  /** 同 DevEUI で受信した件数 */
  count: number
  /** 直近受信 */
  lastSeenAt: Date
  /** 推定モデル（最後に届いた値） */
  model?: string
  /** Milesight の sn（最後に届いた値）。`payloadRaw.data.deviceProfile.sn` から抽出。
   *  「このテナントに登録」ダイアログで固定値として使う。 */
  sn?: string
  /** 推定メーカー名（'Milesight' 等）。受信元から決まる。 */
  manufacturer?: string
  /** 元になった inbox item id 群（remediate 時に pending に戻すため） */
  itemIds: string[]
}

export function unmatchedSummaryForOrg(orgId: string): UnmatchedSummary[] {
  const store = loadWebhookInbox()
  const map = new Map<string, UnmatchedSummary>()
  for (const item of Object.values(store)) {
    if (item.parseStatus !== 'unmatched') continue
    if (item.organizationId !== orgId) continue
    const key = item.devEUI.toUpperCase()
    // sn / manufacturer は payloadRaw から抽出（モックの seed では入っている）。
    // 旧データで payloadRaw を持たない item でも壊れないよう undefined を許容。
    const sn = item.payloadRaw?.data.deviceProfile.sn
    const prev = map.get(key)
    if (prev) {
      prev.count++
      if (item.receivedAt > prev.lastSeenAt) prev.lastSeenAt = item.receivedAt
      if (item.model) prev.model = item.model
      if (sn) prev.sn = sn
      prev.itemIds.push(item.id)
    } else {
      map.set(key, {
        devEUI: item.devEUI,
        count: 1,
        lastSeenAt: item.receivedAt,
        model: item.model,
        sn,
        // 当面の Webhook 受信元は Milesight 一択。将来的に payload から
        // メーカー判定する場合は inbox item に manufacturer を載せる。
        manufacturer: 'Milesight',
        itemIds: [item.id],
      })
    }
  }
  return Array.from(map.values()).sort(
    (a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime(),
  )
}

/** サイドバーバッジ用: 全 org 横断の unmatched DevEUI ユニーク数。 */
export function globalUnmatchedDeviceCount(): number {
  const store = loadWebhookInbox()
  const set = new Set<string>()
  for (const item of Object.values(store)) {
    if (item.parseStatus !== 'unmatched') continue
    set.add(`${item.organizationId}::${item.devEUI.toUpperCase()}`)
  }
  return set.size
}

/* ---------- 遡及反映 / 無視 ---------- */

/** 同 DevEUI の unmatched を pending に戻す。
 *  Sensor を登録した直後に呼ぶと、processInbox() 再実行で processed に流れる。 */
export function reprocessForDevEUI(
  orgId: string,
  devEUI: string,
): { reverted: number } {
  const store = loadWebhookInbox()
  const next: WebhookInboxStore = { ...store }
  let reverted = 0
  for (const item of Object.values(store)) {
    if (item.parseStatus !== 'unmatched') continue
    if (item.organizationId !== orgId) continue
    if (item.devEUI.toUpperCase() !== devEUI.toUpperCase()) continue
    next[item.id] = { ...item, parseStatus: 'pending' }
    reverted++
  }
  saveWebhookInbox(next)
  return { reverted }
}

/** 該当 DevEUI の unmatched をすべて ignored にする（誤送信扱い） */
export function ignoreUnmatchedDevEUI(
  orgId: string,
  devEUI: string,
  byUserId: string,
): number {
  const store = loadWebhookInbox()
  const next: WebhookInboxStore = { ...store }
  const now = new Date()
  let count = 0
  for (const item of Object.values(store)) {
    if (item.parseStatus !== 'unmatched') continue
    if (item.organizationId !== orgId) continue
    if (item.devEUI.toUpperCase() !== devEUI.toUpperCase()) continue
    next[item.id] = {
      ...item,
      parseStatus: 'ignored',
      ignoredAt: now,
      ignoredByUserId: byUserId,
    }
    count++
  }
  saveWebhookInbox(next)
  return count
}
