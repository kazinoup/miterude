/**
 * 通知グループ／メーカー連携の操作ヘルパ — Phase 7
 */
import type {
  ManufacturerIntegration,
  ManufacturerIntegrationStore,
  NotificationChannel,
  NotificationChannelKind,
  NotificationGroup,
  NotificationGroupStore,
} from '../types'
import { hash16 } from './mock'

let counter = 0
function genId(prefix: string): string {
  counter += 1
  return `${prefix}-${hash16(`${Date.now()}-${counter}-${Math.random()}`).slice(0, 8)}`
}

/* ---------- 通知グループ ---------- */

export function createNotificationGroup(opts: {
  name: string
  description?: string
  timing?: NotificationGroup['timing']
  channels?: NotificationChannel[]
}): NotificationGroup {
  return {
    id: genId('ng'),
    name: opts.name.trim() || '無題のグループ',
    description: opts.description?.trim() || undefined,
    timing: opts.timing ?? 'immediate',
    channels: opts.channels ?? [],
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

export function createChannel(kind: NotificationChannelKind, target = ''): NotificationChannel {
  return {
    id: genId('ch'),
    kind,
    target,
  }
}

export function upsertNotificationGroup(
  store: NotificationGroupStore,
  group: NotificationGroup,
): NotificationGroupStore {
  return { ...store, [group.id]: { ...group, updatedAt: new Date() } }
}

export function removeNotificationGroup(
  store: NotificationGroupStore,
  id: string,
): NotificationGroupStore {
  if (!(id in store)) return store
  const next = { ...store }
  delete next[id]
  return next
}

/* ---------- メーカー連携 ---------- */

export const DEFAULT_MANUFACTURERS = ['Milesight', 'IoT Mobile'] as const

/** メーカー名から ID 用 slug に変換（"IoT Mobile" → "iot-mobile"） */
export function manufacturerSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function manufacturerIntegrationId(name: string): string {
  return `mfr-${manufacturerSlug(name)}`
}

/** 旧バージョンで作成された既定の ID（互換用に残しておく） */
export const LEGACY_DROPPED_INTEGRATION_IDS = [
  'mfr-dragino',
  'mfr-sensecap',
  'mfr-elsys',
] as const

/** 既知メーカーで初期エントリを生成。
 *  「連携中 / 停止中」は `webhookSecret` の有無で判定する設計のため、
 *  デモ表示として Milesight にだけシード Secret を入れる。
 *  実運用では admin が MDP 上で発行された値を貼り付けて保存する。 */
export function buildDefaultIntegrations(): ManufacturerIntegrationStore {
  const out: ManufacturerIntegrationStore = {}
  for (const m of DEFAULT_MANUFACTURERS) {
    const id = manufacturerIntegrationId(m)
    out[id] = {
      id,
      manufacturer: m,
      webhookSecret:
        m === 'Milesight' ? hash16(`mfr-secret:${m}`).toLowerCase() : undefined,
      sensorKinds: ['temperature-humidity'],
      updatedAt: new Date(),
    }
  }
  return out
}

export function upsertIntegration(
  store: ManufacturerIntegrationStore,
  integration: ManufacturerIntegration,
): ManufacturerIntegrationStore {
  return {
    ...store,
    [integration.id]: { ...integration, updatedAt: new Date() },
  }
}

export function generateWebhookUrl(integration: ManufacturerIntegration): string {
  return `https://api.miterude.example.com/webhooks/${integration.manufacturer.toLowerCase()}/${integration.id}`
}

export function generateNewSecret(integration: ManufacturerIntegration): string {
  return hash16(`mfr-secret:${integration.id}:${Date.now()}:${Math.random()}`).toLowerCase()
}
