/**
 * Phase F-2 のモック実装。
 *
 * 本番では Supabase に `manufacturer_integrations` テーブルを置き、
 * (organization_id, manufacturer) ペアごとに 1 行（webhook_secret, enabled,
 * sensor_kinds[]）を保持する。Admin Console の「Milesight 連携設定」タブからは
 *  - Webhook URL（テナントごとに固有）
 *  - X-Webhook-Secret の表示 / 再発行
 *  - 直近の `webhook_inbox` イベント
 * を見せて、Milesight Development Platform (MDP) の Application 設定に
 * 貼り付けてもらう運用。
 *
 * モック側では localStorage `miterude:admin:manufacturer_integrations` に
 * `${orgId}::Milesight` をキーにして保存する。
 */
import type { ManufacturerIntegration, ManufacturerIntegrationStore } from '../../types'

const KEY = 'miterude:admin:manufacturer_integrations'

/* ---------- 永続化（Date を ISO で保存・復元） ---------- */

function toDate(v: unknown): Date {
  if (v instanceof Date) return v
  if (typeof v === 'string' || typeof v === 'number') {
    const d = new Date(v)
    if (!Number.isNaN(d.getTime())) return d
  }
  return new Date(0)
}

function rehydrate(item: ManufacturerIntegration): ManufacturerIntegration {
  return { ...item, updatedAt: toDate(item.updatedAt) }
}

export function loadIntegrations(): ManufacturerIntegrationStore {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as ManufacturerIntegrationStore
    const out: ManufacturerIntegrationStore = {}
    for (const [k, v] of Object.entries(parsed)) out[k] = rehydrate(v)
    return out
  } catch {
    return {}
  }
}

export function saveIntegrations(store: ManufacturerIntegrationStore): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(store))
  } catch (e) {
    console.warn('[miterude-admin] manufacturer_integrations write failed:', e)
  }
}

/* ---------- Milesight 専用ヘルパ ---------- */

/** ストア内のキー: テナント × メーカー */
function integrationKey(orgId: string): string {
  return `${orgId}::Milesight`
}

export function getMilesightIntegration(
  orgId: string,
): ManufacturerIntegration | undefined {
  return loadIntegrations()[integrationKey(orgId)]
}

/** 未作成なら空の Integration レコードを作成して返す。
 *  UUID / Secret は MDP 側で発行されるため、**ミテルデ側では生成しない**。
 *  admin が手入力した値で `updateMilesightCredentials` を呼ぶ運用。
 *  「連携中 / 停止中」は `webhookSecret` の有無で判定する（独立フラグなし）。 */
export function ensureMilesightIntegration(
  orgId: string,
): ManufacturerIntegration {
  const store = loadIntegrations()
  const existing = store[integrationKey(orgId)]
  if (existing) return existing
  const created: ManufacturerIntegration = {
    id: integrationKey(orgId),
    manufacturer: 'Milesight',
    webhookSecret: undefined,
    webhookUuid: undefined,
    sensorKinds: ['temperature-humidity'],
    updatedAt: new Date(),
  }
  store[integrationKey(orgId)] = created
  saveIntegrations(store)
  return created
}

/** UUID / Secret を更新する（admin が MDP からコピペした値を保存）。
 *  入力された patch だけを反映し、未指定のフィールドは保持する。 */
export function updateMilesightCredentials(
  orgId: string,
  patch: { webhookUuid?: string; webhookSecret?: string },
): ManufacturerIntegration {
  const store = loadIntegrations()
  const existing = store[integrationKey(orgId)] ?? ensureMilesightIntegration(orgId)
  const updated: ManufacturerIntegration = {
    ...existing,
    ...(patch.webhookUuid !== undefined ? { webhookUuid: patch.webhookUuid } : {}),
    ...(patch.webhookSecret !== undefined ? { webhookSecret: patch.webhookSecret } : {}),
    updatedAt: new Date(),
  }
  store[integrationKey(orgId)] = updated
  saveIntegrations(store)
  return updated
}

/** モック表示用の Webhook URL を組み立てる。
 *  本番では `process.env.NEXT_PUBLIC_APP_URL` 等から取る前提。
 *  ここでは window.location.origin を使い、開発時は
 *  `http://localhost:3100/api/webhooks/milesight/<org_id>` のように見える。 */
export function buildWebhookUrl(orgId: string): string {
  const base =
    typeof window !== 'undefined' && window.location.origin
      ? window.location.origin
      : 'https://miterude.app'
  return `${base}/api/webhooks/milesight/${orgId}`
}
