/**
 * Supabase 書き込み同期 hook — Phase G (Block D)
 *
 * sensors state の前後差分を検知し、変化したフィールドを Supabase の
 * devices / sensor_props テーブルに UPDATE する。
 *
 * 設計方針:
 * - 各ハンドラに手を入れない（侵襲を避ける）。
 * - ハイドレーション完了前は no-op（localStorage → Supabase の上書きを防ぐ）。
 * - 書き込み失敗時は toast で警告。state は roll back しない（手動リロードで真値に戻れる）。
 * - battery は無視（webhook 経由で自動更新される）。
 * - online / lastSeenAt / registeredAt も無視（システム管理項目）。
 */
import { useEffect, useRef } from 'react'
import {
  deleteAlertLogFromSupabase,
  deleteCategoryFromSupabase,
  deleteCheckinFromSupabase,
  deleteDashboardFromSupabase,
  deleteGatewayFromSupabase,
  deleteGroupFromSupabase,
  deleteNotificationGroupFromSupabase,
  deleteSensorFromSupabase,
  deleteSensorNoteFromSupabase,
  updateGatewayInSupabase,
  updateSensorInSupabase,
  upsertAlertLogInSupabase,
  upsertCategoryInSupabase,
  upsertCheckinInSupabase,
  upsertDashboardInSupabase,
  upsertGroupInSupabase,
  upsertNotificationGroupInSupabase,
  upsertSensorNoteInSupabase,
  type GatewayUpdatePatch,
  type SensorUpdatePatch,
} from './supabaseQueries'
import { isSupabaseConfigured } from './supabase'
import type {
  AlertLogEntry,
  AlertLogStore,
  Dashboard,
  DashboardCheckin,
  DashboardCheckinStore,
  DashboardStore,
  Gateway,
  GatewayStore,
  NotificationGroup,
  NotificationGroupStore,
  Sensor,
  SensorCategory,
  SensorCategoryStore,
  SensorGroup,
  SensorGroupStore,
  SensorNote,
  SensorNoteStore,
  SensorStore,
} from '../types'
import { toast } from './toast'

type SyncReady = 'pending' | 'ready' | 'skipped'

/** sensor 間で「ユーザが編集しうるフィールド」を比較し、差分があれば patch を返す。 */
function computeSensorDiff(prev: Sensor, next: Sensor): SensorUpdatePatch | null {
  const patch: SensorUpdatePatch = {}
  if (prev.name !== next.name) patch.name = next.name ?? null
  if (prev.deviceNumber !== next.deviceNumber) patch.deviceNumber = next.deviceNumber
  if (prev.serialNumber !== next.serialNumber) patch.serialNumber = next.serialNumber
  if (prev.model !== next.model) patch.model = next.model
  if (prev.manufacturer !== next.manufacturer) patch.manufacturer = next.manufacturer
  if (prev.categoryId !== next.categoryId) patch.categoryId = next.categoryId ?? null
  if (prev.groupId !== next.groupId) patch.groupId = next.groupId ?? null
  if (!sameArray(prev.tags, next.tags)) patch.tags = next.tags ?? []
  if (prev.notificationGroupId !== next.notificationGroupId) {
    patch.notificationGroupId = next.notificationGroupId ?? null
  }
  if (prev.gatewayId !== next.gatewayId) patch.gatewayId = next.gatewayId
  if (!sameJson(prev.thresholds, next.thresholds)) patch.thresholds = next.thresholds
  if (!sameJson(prev.alertSettings, next.alertSettings)) {
    patch.alertSettings = next.alertSettings
  }
  return Object.keys(patch).length > 0 ? patch : null
}

function sameArray<T>(a: T[] | undefined, b: T[] | undefined): boolean {
  if (a === b) return true
  if (!a || !b) return false
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true
  try {
    return JSON.stringify(a) === JSON.stringify(b)
  } catch {
    return false
  }
}

/** 汎用差分同期: 「id をキーに持つ Record<id, T>」の前後 snapshot を比較し、
 *  追加・変更・削除を upsert / delete 関数に振り分ける。
 *  isEqual で「差分なし」を判定する。 */
function syncStore<T>(
  prev: Record<string, T> | null,
  next: Record<string, T>,
  upsertFn: (item: T) => Promise<unknown>,
  deleteFn: (id: string) => Promise<unknown>,
  isEqual: (a: T, b: T) => boolean,
  label: string,
): Promise<void>[] {
  if (!prev) return []
  const tasks: Promise<void>[] = []
  for (const [id, item] of Object.entries(next)) {
    const before = prev[id]
    if (!before) {
      tasks.push(
        upsertFn(item).then(() => undefined).catch((e: unknown) => {
          const msg = e instanceof Error ? e.message : String(e)
          console.warn(`[supabase-write-sync] ${label} insert failed`, id, e)
          toast(`${label} の作成に失敗: ${msg.slice(0, 80)}`, 'error')
        }),
      )
    } else if (!isEqual(before, item)) {
      tasks.push(
        upsertFn(item).then(() => undefined).catch((e: unknown) => {
          const msg = e instanceof Error ? e.message : String(e)
          console.warn(`[supabase-write-sync] ${label} update failed`, id, e)
          toast(`${label} の更新に失敗: ${msg.slice(0, 80)}`, 'error')
        }),
      )
    }
  }
  for (const id of Object.keys(prev)) {
    if (next[id]) continue
    tasks.push(
      deleteFn(id).then(() => undefined).catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e)
        console.warn(`[supabase-write-sync] ${label} delete failed`, id, e)
        toast(`${label} の削除に失敗: ${msg.slice(0, 80)}`, 'error')
      }),
    )
  }
  return tasks
}

function sameCategory(a: SensorCategory, b: SensorCategory): boolean {
  return a.name === b.name && a.icon === b.icon && a.description === b.description
}
function sameGroup(a: SensorGroup, b: SensorGroup): boolean {
  return a.name === b.name && a.description === b.description && a.color === b.color
}
function sameNotificationGroup(a: NotificationGroup, b: NotificationGroup): boolean {
  return (
    a.name === b.name &&
    a.description === b.description &&
    a.timing === b.timing &&
    sameJson(a.channels, b.channels)
  )
}

function computeGatewayDiff(prev: Gateway, next: Gateway): GatewayUpdatePatch | null {
  const patch: GatewayUpdatePatch = {}
  if (prev.name !== next.name) patch.name = next.name ?? null
  if (prev.deviceNumber !== next.deviceNumber) patch.deviceNumber = next.deviceNumber
  if (prev.serialNumber !== next.serialNumber) patch.serialNumber = next.serialNumber
  if (prev.model !== next.model) patch.model = next.model
  if (prev.manufacturer !== next.manufacturer) patch.manufacturer = next.manufacturer
  if (prev.categoryId !== next.categoryId) patch.categoryId = next.categoryId ?? null
  if (prev.groupId !== next.groupId) patch.groupId = next.groupId ?? null
  if (!sameArray(prev.tags, next.tags)) patch.tags = next.tags ?? []
  if (prev.notificationGroupId !== next.notificationGroupId) {
    patch.notificationGroupId = next.notificationGroupId ?? null
  }
  if (!sameJson(prev.alertSettings, next.alertSettings)) {
    patch.alertSettings = next.alertSettings
  }
  return Object.keys(patch).length > 0 ? patch : null
}

function sameNote(a: SensorNote, b: SensorNote): boolean {
  return (
    a.body === b.body &&
    a.category === b.category &&
    a.sensorId === b.sensorId &&
    sameJson(a.approval, b.approval)
  )
}
function sameAlert(a: AlertLogEntry, b: AlertLogEntry): boolean {
  // mutable な部分のみ比較（occurredAt や種別はイベント発生時点で固定）
  return (
    a.confirmComment === b.confirmComment &&
    a.confirmedBy === b.confirmedBy &&
    a.confirmedAt?.getTime() === b.confirmedAt?.getTime() &&
    a.message === b.message
  )
}
function sameCheckin(a: DashboardCheckin, b: DashboardCheckin): boolean {
  return (
    a.status === b.status &&
    a.comment === b.comment &&
    sameJson(a.sensorComments, b.sensorComments) &&
    sameJson(a.approval, b.approval)
  )
}

/** Dashboard の意味的同一性。updatedAt / createdAt は揺らぐので無視。 */
function sameDashboard(a: Dashboard, b: Dashboard): boolean {
  return (
    a.name === b.name &&
    a.description === b.description &&
    sameJson(a.targetSensorIds, b.targetSensorIds) &&
    sameJson(a.defaultPeriod, b.defaultPeriod) &&
    sameJson(a.widgets, b.widgets) &&
    a.publicShareToken === b.publicShareToken &&
    a.publicShareIssuedAt?.toISOString() === b.publicShareIssuedAt?.toISOString()
  )
}

export function useSupabaseWriteSync(opts: {
  sensors: SensorStore
  sensorCategories: SensorCategoryStore
  sensorGroups: SensorGroupStore
  notificationGroups: NotificationGroupStore
  dashboards: DashboardStore
  sensorNotes: SensorNoteStore
  checkins: DashboardCheckinStore
  alertLogs: AlertLogStore
  gateways: GatewayStore
  hydrationState: 'disabled' | 'loading' | 'ready' | 'error'
}): void {
  const baselineRef = useRef<{
    sensors: SensorStore
    categories: SensorCategoryStore
    groups: SensorGroupStore
    notifGroups: NotificationGroupStore
    dashboards: DashboardStore
    notes: SensorNoteStore
    checkins: DashboardCheckinStore
    alertLogs: AlertLogStore
    gateways: GatewayStore
  } | null>(null)
  const readyRef = useRef<SyncReady>('pending')

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      readyRef.current = 'skipped'
      return
    }
    if (opts.hydrationState === 'loading') return
    if (opts.hydrationState === 'error') {
      readyRef.current = 'skipped'
      return
    }

    // ハイドレーション直後の最初の state を baseline として保存し、書き込みはしない。
    if (baselineRef.current === null) {
      baselineRef.current = {
        sensors: opts.sensors,
        categories: opts.sensorCategories,
        groups: opts.sensorGroups,
        notifGroups: opts.notificationGroups,
        dashboards: opts.dashboards,
        notes: opts.sensorNotes,
        checkins: opts.checkins,
        alertLogs: opts.alertLogs,
        gateways: opts.gateways,
      }
      readyRef.current = 'ready'
      return
    }

    const prev = baselineRef.current
    const promises: Promise<void>[] = []

    // ---- センサー (UPDATE only / DELETE) ----
    for (const [id, sensor] of Object.entries(opts.sensors)) {
      const before = prev.sensors[id]
      if (!before) continue // CREATE は Webhook 経由
      const patch = computeSensorDiff(before, sensor)
      if (!patch) continue
      promises.push(
        updateSensorInSupabase(id, patch).then(() => undefined).catch((e: unknown) => {
          const msg = e instanceof Error ? e.message : String(e)
          console.warn('[supabase-write-sync] sensor update failed', id, e)
          toast(`センサー設定の保存に失敗: ${msg.slice(0, 80)}`, 'error')
        }),
      )
    }
    for (const id of Object.keys(prev.sensors)) {
      if (opts.sensors[id]) continue
      promises.push(
        deleteSensorFromSupabase(id).then(() => undefined).catch((e: unknown) => {
          const msg = e instanceof Error ? e.message : String(e)
          console.warn('[supabase-write-sync] sensor delete failed', id, e)
          toast(`センサーの削除に失敗: ${msg.slice(0, 80)}`, 'error')
        }),
      )
    }

    // ---- ゲートウェイ (UPDATE / DELETE) ----
    for (const [id, gateway] of Object.entries(opts.gateways)) {
      const before = prev.gateways[id]
      if (!before) continue
      const patch = computeGatewayDiff(before, gateway)
      if (!patch) continue
      promises.push(
        updateGatewayInSupabase(id, patch).then(() => undefined).catch((e: unknown) => {
          const msg = e instanceof Error ? e.message : String(e)
          console.warn('[supabase-write-sync] gateway update failed', id, e)
          toast(`ゲートウェイ設定の保存に失敗: ${msg.slice(0, 80)}`, 'error')
        }),
      )
    }
    for (const id of Object.keys(prev.gateways)) {
      if (opts.gateways[id]) continue
      promises.push(
        deleteGatewayFromSupabase(id).then(() => undefined).catch((e: unknown) => {
          const msg = e instanceof Error ? e.message : String(e)
          console.warn('[supabase-write-sync] gateway delete failed', id, e)
          toast(`ゲートウェイの削除に失敗: ${msg.slice(0, 80)}`, 'error')
        }),
      )
    }

    // ---- 設定 3 ストア（INSERT/UPDATE/DELETE すべて） ----
    promises.push(
      ...syncStore(
        prev.categories,
        opts.sensorCategories,
        upsertCategoryInSupabase,
        deleteCategoryFromSupabase,
        sameCategory,
        '区分',
      ),
    )
    promises.push(
      ...syncStore(
        prev.groups,
        opts.sensorGroups,
        upsertGroupInSupabase,
        deleteGroupFromSupabase,
        sameGroup,
        'グループ',
      ),
    )
    promises.push(
      ...syncStore(
        prev.notifGroups,
        opts.notificationGroups,
        upsertNotificationGroupInSupabase,
        deleteNotificationGroupFromSupabase,
        sameNotificationGroup,
        '通知グループ',
      ),
    )
    promises.push(
      ...syncStore(
        prev.dashboards,
        opts.dashboards,
        upsertDashboardInSupabase,
        deleteDashboardFromSupabase,
        sameDashboard,
        'ダッシュボード',
      ),
    )
    promises.push(
      ...syncStore(
        prev.notes,
        opts.sensorNotes,
        upsertSensorNoteInSupabase,
        deleteSensorNoteFromSupabase,
        sameNote,
        '運用メモ',
      ),
    )
    promises.push(
      ...syncStore(
        prev.checkins,
        opts.checkins,
        upsertCheckinInSupabase,
        deleteCheckinFromSupabase,
        sameCheckin,
        '確認記録',
      ),
    )
    promises.push(
      ...syncStore(
        prev.alertLogs,
        opts.alertLogs,
        upsertAlertLogInSupabase,
        deleteAlertLogFromSupabase,
        sameAlert,
        'アラート',
      ),
    )

    baselineRef.current = {
      sensors: opts.sensors,
      categories: opts.sensorCategories,
      groups: opts.sensorGroups,
      notifGroups: opts.notificationGroups,
      dashboards: opts.dashboards,
      notes: opts.sensorNotes,
      checkins: opts.checkins,
      alertLogs: opts.alertLogs,
      gateways: opts.gateways,
    }
    void promises
  }, [
    opts.sensors,
    opts.sensorCategories,
    opts.sensorGroups,
    opts.notificationGroups,
    opts.dashboards,
    opts.sensorNotes,
    opts.checkins,
    opts.alertLogs,
    opts.gateways,
    opts.hydrationState,
  ])
}
