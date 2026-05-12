/**
 * Supabase ハイドレーション hook — Phase G (Block B)
 *
 * App マウント時に Supabase からセンサー / カテゴリ / グループを取得し、
 * 既存の localStorage 由来の React state を「Supabase 由来」に置き換える。
 *
 * 設計方針:
 * - Supabase が未設定なら何もしない（localStorage モードのまま）
 * - 失敗してもアプリは動作継続（コンソールに警告だけ）
 * - 書き込みは依然 localStorage（次フェーズで Supabase 書き戻し）
 * - したがって、本 hook 適用後の編集はリロードで消える前提
 */
import { useEffect, useState } from 'react'
import {
  fetchAlertLogsAsStore,
  fetchCheckinsAsStore,
  fetchDashboardsAsStore,
  fetchGatewaysAsStore,
  fetchManualCategoriesList,
  fetchManualPagesList,
  fetchSensorNotesAsStore,
  fetchSensorsAsStore,
  fetchCategoriesAsStore,
  fetchGroupsAsStore,
  fetchNotificationGroupsAsStore,
  fetchReadingsAsDeviceStore,
  fetchReportSchedulesAsStore,
  upsertDashboardInSupabase,
} from './supabaseQueries'
import {
  saveManualCategories,
  saveManualPages,
} from '../admin/lib/adminStorage'
import type {
  AlertLogStore,
  Dashboard,
  DashboardCheckinStore,
  GatewayStore,
  ManualCategoryStore,
  ManualPageStore,
  ReportScheduleStore,
  SensorNoteStore,
} from '../types'
import { isSupabaseConfigured } from './supabase'
import type {
  DashboardStore,
  DeviceStore,
  NotificationGroupStore,
  SensorCategoryStore,
  SensorGroupStore,
  SensorStore,
} from '../types'

export type HydrationStatus =
  | { state: 'disabled' }
  | { state: 'loading' }
  | { state: 'ready'; loadedAt: Date }
  | { state: 'error'; error: string }

type SetDashboards =
  | ((d: DashboardStore) => void)
  | ((updater: (prev: DashboardStore) => DashboardStore) => void)

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function isUuid(s: string): boolean {
  return UUID_RE.test(s)
}

export function useSupabaseHydration(opts: {
  setSensors: (s: SensorStore) => void
  setSensorCategories: (s: SensorCategoryStore) => void
  setSensorGroups: (s: SensorGroupStore) => void
  setNotificationGroups: (s: NotificationGroupStore) => void
  setDevices: (d: DeviceStore) => void
  /** 既存ダッシュボードの targetSensorIds を Supabase の sensor ID 群で
   *  上書きするためのセッタ。localStorage に残った古い demo ID で
   *  ウィジェットが「削除済み」になるのを防ぐ。 */
  setDashboards: SetDashboards
  /** activeDashboardId の張り替え（旧 ID → 新 UUID マイグレーション用） */
  setActiveDashboardId?: (updater: (prev: string | null) => string | null) => void
  /** メモ / 記録履歴 / アラートログ（Block H） */
  setSensorNotes: (s: SensorNoteStore) => void
  setCheckins: (s: DashboardCheckinStore) => void
  setAlertLogs: (s: AlertLogStore) => void
  /** ゲートウェイ（Block I） */
  setGateways: (s: GatewayStore) => void
  /** Phase 1.8: レポート定期配信 */
  setReportSchedules: (s: ReportScheduleStore) => void
  /** 時系列を遡る日数（既定 30 日） */
  readingsSinceDays?: number
}): { status: HydrationStatus; reload: () => void } {
  const [status, setStatus] = useState<HydrationStatus>(
    isSupabaseConfigured() ? { state: 'loading' } : { state: 'disabled' },
  )
  const [reloadTick, setReloadTick] = useState(0)

  useEffect(() => {
    if (!isSupabaseConfigured()) return
    let cancelled = false
    setStatus({ state: 'loading' })
    ;(async () => {
      try {
        const [
          sensors, categories, groups, notifGroups, devices, dashboards,
          notes, checkins, alertLogs, gateways,
          manualCats, manualPages, reportSchedules,
        ] = await Promise.all([
          fetchSensorsAsStore(),
          fetchCategoriesAsStore(),
          fetchGroupsAsStore(),
          fetchNotificationGroupsAsStore(),
          fetchReadingsAsDeviceStore({
            sinceDays: opts.readingsSinceDays ?? 30,
          }),
          fetchDashboardsAsStore(),
          fetchSensorNotesAsStore(),
          fetchCheckinsAsStore(),
          fetchAlertLogsAsStore(),
          fetchGatewaysAsStore(),
          // マニュアル（全テナント共通）— マイグレーション未適用環境を考慮して失敗時は空に
          fetchManualCategoriesList().catch(() => []),
          fetchManualPagesList().catch(() => []),
          // レポート定期配信 — マイグレーション未適用環境を考慮して失敗時は空に
          fetchReportSchedulesAsStore().catch(() => ({})),
        ])
        if (cancelled) return
        opts.setSensors(sensors)
        opts.setSensorCategories(categories)
        opts.setSensorGroups(groups)
        opts.setNotificationGroups(notifGroups)
        opts.setDevices(devices)
        opts.setSensorNotes(notes)
        opts.setCheckins(checkins)
        opts.setAlertLogs(alertLogs)
        opts.setGateways(gateways)
        opts.setReportSchedules(reportSchedules)

        // Manual は React state ではなく localStorage を直接更新
        // (ManualView が loadManualCategories/Pages で都度読む)
        const manualCatStore: ManualCategoryStore = {}
        for (const c of manualCats) manualCatStore[c.id] = c
        const manualPageStore: ManualPageStore = {}
        for (const p of manualPages) manualPageStore[p.id] = p
        saveManualCategories(manualCatStore)
        saveManualPages(manualPageStore)

        const supabaseSensorIds = Object.keys(sensors)
        const setDashboards = opts.setDashboards as (
          updater: (prev: DashboardStore) => DashboardStore,
        ) => void

        if (Object.keys(dashboards).length > 0) {
          // Supabase 側に保存済みのダッシュボードがあれば、それで完全に置き換え。
          // 念のため targetSensorIds は Supabase の sensor 群で再計算して整合化。
          setDashboards(() => {
            const next: DashboardStore = {}
            for (const [id, d] of Object.entries(dashboards)) {
              next[id] = {
                ...d,
                targetSensorIds:
                  d.targetSensorIds && d.targetSensorIds.length > 0
                    ? d.targetSensorIds.filter((sid) => sid in sensors)
                    : supabaseSensorIds,
              }
            }
            return next
          })
        } else {
          // Supabase に何も無いときは、localStorage 由来を温存しつつ
          // targetSensorIds を Supabase の sensor 群に張り替える。
          // 旧 ID（"d-XXXXXXXX" 等）を含む場合は UUID に振り直す。
          // ※ React の setter にクロージャを渡す方式だと、後段の seed ループが
          //   先に実行されてしまうため、migrated は React state を直接読まずに
          //   ローカルの prev スナップショット（このタイミングで生存している
          //   localStorage 由来の dashboards）に対して計算する。
          // ハイドレーション直前の React state を取得する余地がないため、
          //   localStorage 経由で直接読み取って初期セットを構築する。
          const storedRaw = (() => {
            try {
              const key = 'miterude:tenant:org-demo-001:state:v6'
              const r = localStorage.getItem(key)
              return r ? JSON.parse(r) : null
            } catch {
              return null
            }
          })()
          const prevDashStore: DashboardStore =
            (storedRaw && storedRaw.dashboards) ?? {}

          const idMap: Record<string, string> = {}
          const next: DashboardStore = {}
          const migrated: Dashboard[] = []
          for (const [oldId, dRaw] of Object.entries(prevDashStore)) {
            const d = dRaw as Dashboard
            const newId = isUuid(oldId) ? oldId : crypto.randomUUID()
            idMap[oldId] = newId
            const newDashboard: Dashboard = {
              ...d,
              id: newId,
              targetSensorIds: supabaseSensorIds,
            }
            next[newId] = newDashboard
            migrated.push(newDashboard)
          }

          ;(opts.setDashboards as (s: DashboardStore) => void)(next)
          if (opts.setActiveDashboardId) {
            opts.setActiveDashboardId((prev) =>
              prev && idMap[prev] ? idMap[prev] : prev,
            )
          }
          for (const d of migrated) {
            upsertDashboardInSupabase(d).catch((e) => {
              console.warn('[supabase-hydration] dashboard seed failed', d.id, e)
            })
          }
        }

        setStatus({ state: 'ready', loadedAt: new Date() })
      } catch (e) {
        const msg = extractErrorMessage(e)
        console.warn('[supabase-hydration] failed:', e)
        if (!cancelled) setStatus({ state: 'error', error: msg })
      }
    })()
    return () => {
      cancelled = true
    }
    // setter は安定（App の useState 由来）なので依存に含めない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadTick])

  return {
    status,
    reload: () => setReloadTick((t) => t + 1),
  }
}

function extractErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  if (e && typeof e === 'object') {
    const obj = e as Record<string, unknown>
    if (typeof obj.message === 'string') return obj.message
    if (typeof obj.error === 'string') return obj.error
    try {
      return JSON.stringify(e)
    } catch {
      return String(e)
    }
  }
  return String(e)
}
