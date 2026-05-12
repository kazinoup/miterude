import { flushSync } from 'react-dom'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Sidebar } from './components/Sidebar'
import { DashboardView } from './components/views/DashboardView'
import { SensorsView } from './components/views/SensorsView'
import { SensorDetailView } from './components/views/SensorDetailView'
import { GatewaysView, GatewayDetailView } from './components/views/GatewaysView'
import { ReportView } from './components/views/ReportView'
import { SettingsView } from './components/views/SettingsView'
import { RecordsView } from './components/views/RecordsView'
import { AlertsView } from './components/views/AlertsView'
import { ManualView } from './components/views/ManualView'
import { ReportPreview } from './components/ReportPreview'
import { RecordsAndNotesReport } from './components/RecordsAndNotesReport'
import { ToastContainer } from './components/ToastContainer'
import { ContextSelectView } from './components/ContextSelectView'
import { ImpersonationBanner } from './components/ImpersonationBanner'
import { DashboardEditDialog } from './components/DashboardEditDialog'
import type {
  AlertLogStore,
  AlertSettings,
  DashboardCheckin,
  DashboardCheckinStore,
  DashboardReminder,
  DashboardReminderStore,
  DashboardDefaultPeriod,
  DashboardStore,
  DeviceStore,
  GatewayStore,
  InvoiceStore,
  ManufacturerIntegrationStore,
  NotificationGroup,
  Organization,
  NotificationGroupStore,
  ReportKind,
  ReportSchedule,
  ReportScheduleStore,
  SavedFilter,
  SavedFilterStore,
  SensorCategory,
  SensorCategoryStore,
  SensorGroup,
  SensorGroupStore,
  SensorNote,
  SensorNoteStore,
  SensorStore,
  SensorThresholds,
  ThresholdTemplate,
  ThresholdTemplateStore,
  UserSession,
  ViewKey,
  Widget,
  YearMonth,
} from './types'
import { yearMonthKey } from './types'
import {
  deviceHasDataForMonth,
  deviceHasDataForRange,
} from './lib/report'
import { ensureDate, syncMetadata } from './lib/mock'
import {
  appendAlertEntries,
  judgeAllReadingsForSensor,
  judgeBatteryForAlerts,
  judgeOfflineTransitionAlert,
} from './lib/alertLog'
import { canReportBattery } from './lib/supportedDevices'
import {
  loadAuthSession,
  loadOrganizations,
  saveOrganizations,
  upsertOrganization,
  loadUsers,
} from './admin/lib/adminStorage'
import {
  ensureSeedData,
  DEMO_ORG_ID,
  DEMO_SUPER_ADMIN_ID,
} from './admin/lib/adminSeed'
import { AdminApp } from './admin/AdminApp'
import { getEffectiveRole } from './lib/permissions'
import type { AuthSession } from './types'
import {
  gatewaysFromState,
  loadState,
  saveState,
  sensorsFromState,
  withGateways,
  withSensors,
} from './lib/storage'
import {
  addWidget,
  buildDefaultDashboard,
  createDashboard,
  deleteDashboard as removeDashboard,
  moveWidget,
  pruneSensorRefs,
  removeWidget,
  updateWidget,
  upsertDashboard,
} from './lib/dashboard'
import {
  buildDefaultIntegrations,
  removeNotificationGroup,
  upsertNotificationGroup,
} from './lib/notify'
import {
  approveCheckin,
  approveNote,
  removeNote as removeSensorNote,
  upsertCheckin,
  upsertNote,
} from './lib/records'
import {
  addTag as addSensorTag,
  removeTag as removeSensorTag,
  removeGroup as deleteGroupFromStore,
  removeSavedFilter as deleteSavedFilterFromStore,
  upsertGroup as upsertGroupInStore,
  upsertSavedFilter as upsertSavedFilterInStore,
} from './lib/groups'
import {
  buildDefaultCategories,
  removeCategory as deleteCategoryFromStore,
  upsertCategory as upsertCategoryInStore,
} from './lib/categories'
import {
  applyTemplateToSensor,
  buildDefaultTemplates,
  removeTemplate as deleteTemplateFromStore,
  upsertTemplate as upsertTemplateInStore,
} from './lib/thresholdTemplates'
import { toast } from './lib/toast'
import { useSupabaseHydration } from './lib/useSupabaseHydration'
import { useSupabaseRealtime } from './lib/useSupabaseRealtime'
import { useSupabaseWriteSync } from './lib/useSupabaseWriteSync'
import {
  parsePath,
  pathFromTenantState,
  pushPath,
  replacePath,
  useCurrentPath,
} from './lib/router'
import { getActiveOrgSlug } from './lib/supabase'
import './App.css'
import './styles/dashboard.css'
import './styles/report.css'
import './styles/admin.css'

function sortIds(ids: string[]): string[] {
  return [...ids].sort()
}

/** AuthSession から「いまアプリが対象とするテナント ID」を導出する。
 *  - tenant:        organizationId
 *  - impersonation: actingAsOrganizationId
 *  - admin / null:  null（テナント表示が要らない状態）
 *  null が返るときも現状はテナント UI を出さざるを得ないため、
 *   呼び出し側で DEMO_ORG_ID にフォールバック（Phase A-2 以降で /admin 画面に切替予定）。 */
function activeTenantIdFrom(session: AuthSession | null): string | null {
  if (!session) return null
  if (session.kind === 'tenant') return session.organizationId
  if (session.kind === 'impersonation') return session.actingAsOrganizationId
  return null
}

export default function App() {
  // Phase A-1: マルチテナント基盤の初期化
  //   - シードデータ投入（初回のみ）
  //   - 既存 v3 ストアの demo テナントへの移行
  //   - 認証セッション取得 → 対象テナント ID を確定
  const session = useMemo(() => {
    ensureSeedData()
    return loadAuthSession()
  }, [])

  // Phase A-4 / Phase K: super_admin が /admin にいる場合は AdminApp。
  // URL が /admin/* で session がまだ admin でない場合（例えば seed 直後で
  // tenant kind が残っている等）も、admin として表示できるよう URL も判定材料に入れる。
  //  - session.kind === 'admin' → 常に AdminApp
  //  - session.userId のユーザが super_admin で URL が /admin/* → AdminApp に切替（session 上書き）
  const urlIsAdmin =
    typeof window !== 'undefined' &&
    window.location.pathname.startsWith('/admin')
  if (session?.kind === 'admin') {
    return <AdminApp session={session} />
  }
  if (urlIsAdmin && session?.userId) {
    // localStorage の users で super_admin かどうかを判定
    try {
      const usersRaw = localStorage.getItem('miterude:admin:users')
      const users = usersRaw ? JSON.parse(usersRaw) : {}
      const u = users[session.userId]
      if (u?.systemRole === 'super_admin') {
        const adminSession = { kind: 'admin' as const, userId: session.userId }
        return <AdminApp session={adminSession} />
      }
    } catch {
      /* noop */
    }
  }

  const activeOrgId = activeTenantIdFrom(session) ?? DEMO_ORG_ID

  /** UI に渡すセッション情報（旧 MOCK_SESSION 互換）。
   *  users / organizations から動的に構築する。 */
  const MOCK_SESSION: UserSession = useMemo(() => {
    const users = loadUsers()
    const orgs = loadOrganizations()
    const userId = session?.userId
    const u = userId ? users[userId] : null
    const o = orgs[activeOrgId]
    return {
      organizationName: o?.name ?? 'CanBright（デモ組織）',
      userName: u?.displayName ?? '井上 太郎',
      email: u?.email ?? 'inoue@canbright.co.jp',
      effectiveRole: getEffectiveRole(),
    }
  }, [session, activeOrgId])

  /** 契約・支払いタブで使う Organization オブジェクト。
   *  admin_organizations ストアからロード。状態が変わると差し替えるため、
   *  軽量な refresh tick で再評価する。 */
  const [orgRefreshTick, setOrgRefreshTick] = useState(0)
  const currentOrganization = useMemo(() => {
    const orgs = loadOrganizations()
    return (
      orgs[activeOrgId] ?? {
        id: activeOrgId,
        name: 'CanBright（デモ組織）',
        slug: 'canbright-demo',
        createdAt: new Date(),
      }
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrgId, orgRefreshTick])

  function patchOrganization(patch: Partial<Organization>) {
    const orgs = loadOrganizations()
    const cur = orgs[activeOrgId]
    if (!cur) return
    const next: Organization = { ...cur, ...patch }
    saveOrganizations(upsertOrganization(orgs, next))
    setOrgRefreshTick((t) => t + 1)
  }

  // Phase A-2: コンテキスト選択画面の表示状態（ユーザーメニューの「切り替え」から起動）
  const [contextSelectOpen, setContextSelectOpen] = useState(false)

  // --- 永続化: マウント時にロード -----------------------------
  const initial = useMemo(() => loadState(activeOrgId), [activeOrgId])

  const [devices, setDevices] = useState<DeviceStore>(initial?.devices ?? {})
  // Phase F-4 D-2: 永続化レイヤは deviceMaster/sensorProps/gatewayProps の 3 ストアで
  // 持つが、UI コードが Sensor / Gateway の JOIN ビューを期待しているため、
  // React state はその JOIN ビューを保持する。永続化時に withSensors / withGateways
  // で 3 ストアに書き戻す。
  const [sensors, setSensors] = useState<SensorStore>(
    initial ? sensorsFromState(initial) : {},
  )
  const [gateways, setGateways] = useState<GatewayStore>(
    initial ? gatewaysFromState(initial) : {},
  )
  const [dashboards, setDashboards] = useState<DashboardStore>(
    initial?.dashboards ?? {},
  )
  const [activeDashboardId, setActiveDashboardId] = useState<string | null>(
    initial?.activeDashboardId ?? null,
  )
  const [notificationGroups, setNotificationGroups] = useState<NotificationGroupStore>(
    initial?.notificationGroups ?? {},
  )
  // テナント側からは編集不可になったため、setter は使わない（admin 側のみ更新）。
  // 実バックエンド移行後はこの localStorage state が `manufacturer_integrations`
  // テーブルからの SELECT 結果に置き換わる想定。
  const [manufacturerIntegrations] = useState<ManufacturerIntegrationStore>(
    initial?.manufacturerIntegrations ?? buildDefaultIntegrations(),
  )
  /** 銀行振込テナント向けの請求書履歴。
   *  実バックエンド移行後は `invoices` テーブルからの SELECT に置き換わる。
   *  クレジット契約の請求履歴は Stripe 側で管理するためここには保存しない。 */
  const [invoices] = useState<InvoiceStore>(initial?.invoices ?? {})
  const [checkins, setCheckins] = useState<DashboardCheckinStore>(
    initial?.checkins ?? {},
  )
  const [sensorNotes, setSensorNotes] = useState<SensorNoteStore>(
    initial?.sensorNotes ?? {},
  )
  const [sensorGroups, setSensorGroups] = useState<SensorGroupStore>(
    initial?.sensorGroups ?? {},
  )
  const [sensorCategories, setSensorCategories] = useState<SensorCategoryStore>(
    initial?.sensorCategories ?? buildDefaultCategories(),
  )
  const [thresholdTemplates, setThresholdTemplates] =
    useState<ThresholdTemplateStore>(
      initial?.thresholdTemplates ?? buildDefaultTemplates(),
    )
  const [savedFilters, setSavedFilters] = useState<SavedFilterStore>(
    initial?.savedFilters ?? {},
  )
  // Phase B (Phase 10): アラートログ
  const [alertLogs, setAlertLogs] = useState<AlertLogStore>(
    initial?.alertLogs ?? {},
  )
  // Phase G: 通知設定
  const [reportSchedules, setReportSchedules] = useState<ReportScheduleStore>(
    initial?.reportSchedules ?? {},
  )
  const [dashboardReminders, setDashboardReminders] =
    useState<DashboardReminderStore>(initial?.dashboardReminders ?? {})

  // Phase G (Block B): Supabase が設定されていればマウント時に
  // sensors / categories / groups を Supabase 由来で上書きする。
  // 失敗してもアプリ動作は継続（localStorage がフォールバック）。
  const supabaseHydration = useSupabaseHydration({
    setSensors,
    setSensorCategories,
    setSensorGroups,
    setNotificationGroups,
    setDevices,
    setDashboards,
    setActiveDashboardId,
    setSensorNotes,
    setCheckins,
    setAlertLogs,
    setGateways,
  })

  // Phase G (Block C): Realtime 購読 — webhook → DB に書き込まれた
  // 新規 sensor_readings / devices 状態変化を UI に即時反映する。
  const supabaseRealtime = useSupabaseRealtime({
    setDevices,
    setSensors,
  })

  const realtimeStatusRef = useRef<string>('idle')
  useEffect(() => {
    if (supabaseRealtime.status === realtimeStatusRef.current) return
    if (supabaseRealtime.status === 'subscribed') {
      toast('Realtime 接続: 計測値の更新をリアルタイムで反映します', 'info')
    } else if (supabaseRealtime.status === 'error') {
      toast('Realtime 接続でエラーが発生しました', 'error')
    }
    realtimeStatusRef.current = supabaseRealtime.status
  }, [supabaseRealtime.status])

  // Phase G (Block D): センサー設定の書き戻し同期。
  // sensors state の差分を検知して、Supabase の devices / sensor_props に反映する。
  useSupabaseWriteSync({
    sensors,
    sensorCategories,
    sensorGroups,
    notificationGroups,
    dashboards,
    sensorNotes,
    checkins,
    alertLogs,
    gateways,
    hydrationState: supabaseHydration.status.state,
  })

  // 結果をトーストで通知（初回 ready / error のときだけ）
  const supabaseStatusRef = useRef<'loading' | 'ready' | 'error' | 'disabled'>(
    'disabled',
  )
  useEffect(() => {
    const s = supabaseHydration.status.state
    if (s === supabaseStatusRef.current) return
    if (supabaseStatusRef.current === 'loading' && s === 'ready') {
      toast('Supabase から最新データを反映しました', 'success')
    } else if (s === 'error' && supabaseHydration.status.state === 'error') {
      toast(
        `Supabase 同期に失敗: ${supabaseHydration.status.error.slice(0, 80)}`,
        'error',
      )
    }
    supabaseStatusRef.current = s
  }, [supabaseHydration.status])

  const [view, setView] = useState<ViewKey>('dashboard')
  const [activeSensorId, setActiveSensorId] = useState<string | null>(null)
  const [activeGatewayId, setActiveGatewayId] = useState<string | null>(null)
  /** 設定画面を特定タブで開くためのヒント。
   *  navigate('settings') 直前に setSettingsInitialTab で指定し、
   *  SettingsView マウント時の初期タブとして消費する。 */
  const [settingsInitialTab, setSettingsInitialTab] = useState<
    'integrations' | 'notifications' | 'thresholds' | undefined
  >(undefined)
  /** マニュアル: 選択中カテゴリ / ページ */
  const [manualCategoryId, setManualCategoryId] = useState<string | null>(null)
  const [manualPageId, setManualPageId] = useState<string | null>(null)

  /* ---------------- Phase K: URL <-> view state 同期 ----------------
   * - マウント時 / popstate: URL を parse して view / activeXxx に反映
   * - state 変化時: pushPath で URL を更新（同じパスなら no-op）
   * - 別テナントへの遷移は main.tsx のブート時 resolveActiveOrgFromUrl で処理
   */
  const currentPath = useCurrentPath()
  const initialUrlAppliedRef = useRef(false)

  useEffect(() => {
    const parsed = parsePath(currentPath)
    if (!parsed || parsed.kind !== 'tenant') return
    setView(parsed.view)
    setActiveSensorId(parsed.activeSensorId)
    setActiveGatewayId(parsed.activeGatewayId)
    if (parsed.activeDashboardId) setActiveDashboardId(parsed.activeDashboardId)
    if (parsed.settingsTab) setSettingsInitialTab(parsed.settingsTab)
    setManualCategoryId(parsed.manualCategoryId ?? null)
    setManualPageId(parsed.manualPageId ?? null)
    initialUrlAppliedRef.current = true
  }, [currentPath])

  useEffect(() => {
    if (!initialUrlAppliedRef.current) return
    const slug = getActiveOrgSlug()
    if (!slug) return
    const nextPath = pathFromTenantState({
      kind: 'tenant',
      slug,
      view,
      activeSensorId,
      activeGatewayId,
      activeDashboardId,
      settingsTab: settingsInitialTab,
      manualCategoryId,
      manualPageId,
    })
    pushPath(nextPath)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, activeSensorId, activeGatewayId, activeDashboardId, settingsInitialTab, manualCategoryId, manualPageId])

  // 初回マウント時、URL に slug が無いケースを replaceState で正規化
  useEffect(() => {
    const slug = getActiveOrgSlug()
    if (!slug) return
    const parsed = parsePath(window.location.pathname)
    if (parsed && parsed.kind === 'tenant' && parsed.slug) return
    if (parsed && parsed.kind === 'admin') return
    const initial = pathFromTenantState({
      kind: 'tenant',
      slug,
      view,
      activeSensorId,
      activeGatewayId,
      activeDashboardId,
      settingsTab: settingsInitialTab,
    })
    replacePath(initial)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Phase 9.11: 共通 ReportThresholds は廃止。閾値はセンサー個別 (sensor.thresholds) で管理。
  // Phase A-2 (Phase 10): 「欠損表示の設定」は撤去。未計測セルはハイフン固定。

  const [reportDeviceIds, setReportDeviceIds] = useState<string[]>([])
  const [reportKind, setReportKind] = useState<ReportKind>('monthly')
  const [reportMonth, setReportMonth] = useState<YearMonth | null>(null)
  const [reportWeekStart, setReportWeekStart] = useState<Date | null>(null)
  // Phase A-4: 記録履歴・運用メモページの出力可否（既定 OFF）
  const [reportIncludeRecords, setReportIncludeRecords] = useState<boolean>(false)
  const [printingBulk, setPrintingBulk] = useState<
    | { kind: 'monthly'; ym: YearMonth; includeRecords: boolean }
    | { kind: 'weekly'; weekStart: Date; includeRecords: boolean }
    | null
  >(null)

  // 新規ダッシュボード作成ダイアログ
  const [createDashOpen, setCreateDashOpen] = useState(false)

  // 壊れたデータ（measuredAt 等が文字列のまま）を Date に正規化する自己修復パス。
  // idempotent なので毎回走らせても問題なし（不要なら早期 return）。
  useEffect(() => {
    let needs = false
    const fixed: DeviceStore = {}
    for (const [id, arr] of Object.entries(devices)) {
      if (!Array.isArray(arr) || arr.length === 0) {
        fixed[id] = arr
        continue
      }
      if (arr[0].measuredAt instanceof Date) {
        fixed[id] = arr
      } else {
        needs = true
        fixed[id] = arr.map((r) => ({ ...r, measuredAt: ensureDate(r.measuredAt) }))
      }
    }
    if (needs) {
      setDevices(fixed)
    }
  }, [devices])

  // 初回マウント時、devices があれば sensors/gateways を補正
  // & ダッシュボードが空なら既定を生成
  const didInitSync = useRef(false)
  useEffect(() => {
    if (didInitSync.current) return
    didInitSync.current = true

    let nextSensors = sensors
    let nextGateways = gateways
    if (Object.keys(devices).length > 0) {
      const synced = syncMetadata(devices, sensors, gateways)
      nextSensors = synced.sensors
      nextGateways = synced.gateways
      setSensors(nextSensors)
      setGateways(nextGateways)
    }

    if (Object.keys(dashboards).length === 0 && Object.keys(nextSensors).length > 0) {
      const def = buildDefaultDashboard(nextSensors)
      setDashboards({ [def.id]: def })
      setActiveDashboardId(def.id)
    } else if (Object.keys(dashboards).length > 0 && !activeDashboardId) {
      // 永続化された activeDashboardId が無い → 先頭を選択
      const firstId = Object.keys(dashboards).sort()[0]
      setActiveDashboardId(firstId)
    }

    // Phase B: 起動時にアラートログを補完。
    //   既存 readings × 現在の thresholds で判定し、欠けているエントリを追加。
    //   オフラインのセンサーには代表 1 件の "offline" アラートも生成（lastSeenAt + 24h を発生時刻とみなす）。
    // Phase C: バッテリー残量アラートも併せて判定。機種が取得不可なら何もしない。
    if (Object.keys(devices).length > 0) {
      let acc = alertLogs
      for (const [sid, sensor] of Object.entries(nextSensors)) {
        const readings = devices[sid] ?? []
        const generated = judgeAllReadingsForSensor(sensor, readings)
        if (generated.length > 0) acc = appendAlertEntries(acc, generated)
        // バッテリー残量アラート（Phase C）
        const battEnabled = sensor.alertSettings?.batteryEnabled === true
        const battThresh = sensor.alertSettings?.batteryThresholdPercent ?? 10
        if (battEnabled && canReportBattery(sensor.model)) {
          for (const r of readings) {
            const e = judgeBatteryForAlerts(sensor, r, battThresh)
            if (e.length > 0) acc = appendAlertEntries(acc, e)
          }
        }
        // 現在オフラインなら、最終受信から 24h 経過時点のオフラインアラートを 1 件作る
        if (sensor.online === false) {
          const offlineAt = new Date(
            (sensor.lastSeenAt instanceof Date
              ? sensor.lastSeenAt.getTime()
              : new Date(sensor.lastSeenAt as unknown as string).getTime()) +
              24 * 60 * 60 * 1000,
          )
          acc = appendAlertEntries(
            acc,
            judgeOfflineTransitionAlert(sensor, true, offlineAt),
          )
        }
      }
      if (acc !== alertLogs) setAlertLogs(acc)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 永続化: 変更ごとに保存（テナント別キーへ）
  useEffect(() => {
    // Phase F-4 D-2: 3 ストア形式に書き戻して保存。
    // sensors / gateways は React 上の JOIN ビューのまま withSensors / withGateways
    // を通して deviceMaster + sensorProps / gatewayProps へ展開する。
    let state: import('./lib/storage').PersistedState = {
      devices,
      deviceMaster: {},
      sensorProps: {},
      gatewayProps: {},
      dashboards,
      activeDashboardId,
      notificationGroups,
      manufacturerIntegrations,
      checkins,
      sensorNotes,
      sensorGroups,
      sensorCategories,
      thresholdTemplates,
      savedFilters,
      alertLogs,
      reportSchedules,
      dashboardReminders,
      invoices,
    }
    state = withSensors(state, sensors)
    state = withGateways(state, gateways)
    saveState(state, activeOrgId)
  }, [
    activeOrgId,
    devices,
    sensors,
    gateways,
    dashboards,
    activeDashboardId,
    notificationGroups,
    manufacturerIntegrations,
    checkins,
    sensorNotes,
    sensorGroups,
    sensorCategories,
    thresholdTemplates,
    savedFilters,
    alertLogs,
    reportSchedules,
    dashboardReminders,
  ])

  const bulkPrintDeviceIds = useMemo(() => {
    if (!printingBulk) return [] as string[]
    if (printingBulk.kind === 'monthly') {
      return sortIds(reportDeviceIds).filter((id) =>
        deviceHasDataForMonth(devices[id], printingBulk.ym),
      )
    }
    const range = {
      start: printingBulk.weekStart,
      end: (() => {
        const e = new Date(printingBulk.weekStart)
        e.setDate(e.getDate() + 7)
        return e
      })(),
    }
    return sortIds(reportDeviceIds).filter((id) =>
      deviceHasDataForRange(devices[id], range),
    )
  }, [printingBulk, reportDeviceIds, devices])

  function handleDevicesChange(next: DeviceStore) {
    setDevices(next)

    const synced = syncMetadata(next, sensors, gateways)
    setSensors(synced.sensors)
    setGateways(synced.gateways)

    const ids = Object.keys(next)

    if (activeSensorId && !ids.includes(activeSensorId)) {
      setActiveSensorId(null)
      if (view === 'sensor-detail') setView('sensors')
    }

    setReportDeviceIds((prev) => {
      const valid = prev.filter((id) => ids.includes(id))
      return valid.length > 0 ? valid : ids
    })

    // Phase A-1（Phase 10）: 月／週の既定値は ReportView 側で「先月／先週」を
    // 自動補完するため、ここで CSV 取り込み完了時に上書きしない。

    // ダッシュボードのクリーンアップ＋初回作成
    setDashboards((prev) => {
      const validSet = new Set(ids)
      const pruned = pruneSensorRefs(prev, validSet)
      if (Object.keys(pruned).length === 0 && ids.length > 0) {
        const def = buildDefaultDashboard(synced.sensors)
        setActiveDashboardId(def.id)
        return { [def.id]: def }
      }
      return pruned
    })

    // Phase B/C (Phase 10): CSV 取り込み完了時にアラートログを再計算。
    //   既存ログとは appendAlertEntries 側で重複除去されるので、再取り込みでも安全。
    setAlertLogs((prev) => {
      let acc = prev
      for (const sid of ids) {
        const sensor = synced.sensors[sid]
        if (!sensor) continue
        const readings = next[sid] ?? []
        // 逸脱（危険・注意）
        const generated = judgeAllReadingsForSensor(sensor, readings)
        if (generated.length > 0) acc = appendAlertEntries(acc, generated)
        // バッテリー（Phase C）
        const battEnabled = sensor.alertSettings?.batteryEnabled === true
        const battThresh = sensor.alertSettings?.batteryThresholdPercent ?? 10
        if (battEnabled && canReportBattery(sensor.model)) {
          for (const r of readings) {
            const e = judgeBatteryForAlerts(sensor, r, battThresh)
            if (e.length > 0) acc = appendAlertEntries(acc, e)
          }
        }
      }
      return acc
    })
  }

  function handleDeleteSensors(ids: string[]) {
    if (ids.length === 0) return
    const nextDevices = { ...devices }
    for (const id of ids) delete nextDevices[id]
    handleDevicesChange(nextDevices)
  }

  function handleUpdateAlertSettings(sensorId: string, next: AlertSettings) {
    setSensors((prev) => {
      const cur = prev[sensorId]
      if (!cur) return prev
      return { ...prev, [sensorId]: { ...cur, alertSettings: next } }
    })
    // Phase C: バッテリー設定が ON ならその場でログを再計算（OFF 時は何もしない）。
    //   既存エントリは appendAlertEntries で重複除去される。
    const sensor = sensors[sensorId]
    if (
      sensor &&
      next.batteryEnabled === true &&
      canReportBattery(sensor.model)
    ) {
      const readings = devices[sensorId] ?? []
      const threshold = next.batteryThresholdPercent ?? 10
      const updatedSensor = { ...sensor, alertSettings: next }
      setAlertLogs((prev) => {
        let acc = prev
        for (const r of readings) {
          const entries = judgeBatteryForAlerts(updatedSensor, r, threshold)
          if (entries.length > 0) acc = appendAlertEntries(acc, entries)
        }
        return acc
      })
    }
  }

  function handleUpdateSensorNotificationGroup(sensorId: string, groupId: string | null) {
    setSensors((prev) => {
      const cur = prev[sensorId]
      if (!cur) return prev
      return { ...prev, [sensorId]: { ...cur, notificationGroupId: groupId } }
    })
    if (groupId) {
      const g = notificationGroups[groupId]
      toast(`通知グループ「${g?.name ?? groupId}」を紐付けました`, 'success')
    } else {
      toast('通知グループの紐付けを解除しました', 'info')
    }
  }

  function handleUpsertNotificationGroup(g: NotificationGroup) {
    const isNew = !notificationGroups[g.id]
    setNotificationGroups((prev) => upsertNotificationGroup(prev, g))
    toast(isNew ? `通知グループ「${g.name}」を作成しました` : '通知グループを更新しました', 'success')
  }

  function handleDeleteNotificationGroup(id: string) {
    const g = notificationGroups[id]
    setNotificationGroups((prev) => removeNotificationGroup(prev, id))
    // 紐付くセンサーから外す
    setSensors((prev) => {
      const next = { ...prev }
      let changed = false
      for (const sid of Object.keys(next)) {
        if (next[sid].notificationGroupId === id) {
          next[sid] = { ...next[sid], notificationGroupId: null }
          changed = true
        }
      }
      return changed ? next : prev
    })
    toast(`通知グループ「${g?.name ?? id}」を削除しました`, 'info')
  }

  /* -------- Phase 8: 確認チェックイン・運用メモ -------- */

  function handleCreateCheckin(c: DashboardCheckin) {
    setCheckins((prev) => upsertCheckin(prev, c))
    // Phase: 確認記録のセンサーコメントを、対象期間に該当するアラートログに書き戻す。
    //   AlertLog.confirmComment / confirmedBy / confirmedAt を上書きする
    //   （最新の確認が常に上書き）。
    if (c.sensorComments.length > 0) {
      const rangeStart = c.snapshot.rangeStart
      const rangeEnd = c.snapshot.rangeEnd
      // 範囲が定義されていない（古いデータ）場合は lookbackHours で逆算
      const fallbackStart = !rangeStart
        ? new Date(c.timestamp.getTime() - c.snapshot.lookbackHours * 3600_000)
        : null
      const start = (rangeStart ?? fallbackStart ?? c.timestamp).getTime()
      const end = (rangeEnd ?? c.timestamp).getTime()

      // sensorId → comment（空コメントは無視）
      const commentBySensor = new Map<string, string>()
      for (const sc of c.sensorComments) {
        const text = (sc.comment ?? '').trim()
        if (text) commentBySensor.set(sc.sensorId, text)
      }
      if (commentBySensor.size > 0) {
        setAlertLogs((prev) => {
          let dirty = false
          const next: typeof prev = { ...prev }
          for (const [id, e] of Object.entries(prev)) {
            const memo = commentBySensor.get(e.targetId)
            if (!memo) continue
            const t =
              e.occurredAt instanceof Date
                ? e.occurredAt.getTime()
                : new Date(e.occurredAt as unknown as string).getTime()
            if (t < start || t > end) continue
            next[id] = {
              ...e,
              confirmComment: memo,
              confirmedBy: c.userName,
              confirmedAt: c.timestamp,
            }
            dirty = true
          }
          return dirty ? next : prev
        })
      }
    }
    toast(
      c.snapshot.deviationSensorCount > 0
        ? `${c.dashboardName} を確認しました（逸脱 ${c.snapshot.deviationSensorCount} 件にメモを残しました）`
        : `${c.dashboardName} を確認しました`,
      'success',
    )
  }

  function handleApproveCheckin(id: string) {
    setCheckins((prev) => approveCheckin(prev, id, MOCK_SESSION))
    toast('確認記録を承認しました', 'success')
  }

  function handleDeleteCheckin(id: string) {
    setCheckins((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    toast('確認記録を削除しました', 'info')
  }

  function handleCreateSensorNote(note: SensorNote) {
    setSensorNotes((prev) => upsertNote(prev, note))
    toast(`${note.sensorName} に運用メモを追加しました`, 'success')
  }

  function handleApproveNote(id: string) {
    setSensorNotes((prev) => approveNote(prev, id, MOCK_SESSION))
    toast('運用メモを承認しました', 'success')
  }

  function handleDeleteSensorNote(id: string) {
    setSensorNotes((prev) => removeSensorNote(prev, id))
    toast('運用メモを削除しました', 'info')
  }

  /* -------- Phase 9.5: グループ・保存フィルタ・タグ -------- */

  function handleUpsertGroup(g: SensorGroup) {
    const isNew = !sensorGroups[g.id]
    setSensorGroups((prev) => upsertGroupInStore(prev, g))
    toast(isNew ? `グループ「${g.name}」を作成しました` : 'グループを更新しました', 'success')
  }

  function handleDeleteGroup(id: string) {
    const g = sensorGroups[id]
    setSensorGroups((prev) => deleteGroupFromStore(prev, id))
    // 紐付くセンサーから groupId を外す
    setSensors((prev) => {
      let changed = false
      const next: SensorStore = { ...prev }
      for (const sid of Object.keys(next)) {
        if (next[sid].groupId === id) {
          next[sid] = { ...next[sid], groupId: null }
          changed = true
        }
      }
      return changed ? next : prev
    })
    toast(`グループ「${g?.name ?? id}」を削除しました`, 'info')
  }

  function handleUpsertSavedFilter(f: SavedFilter) {
    setSavedFilters((prev) => upsertSavedFilterInStore(prev, f))
  }

  function handleDeleteSavedFilter(id: string) {
    const f = savedFilters[id]
    setSavedFilters((prev) => deleteSavedFilterFromStore(prev, id))
    toast(`保存フィルタ「${f?.name ?? id}」を削除しました`, 'info')
  }

  function handleApplyBulkTags(ids: string[], tags: string[], remove: boolean) {
    setSensors((prev) => {
      const next: SensorStore = { ...prev }
      for (const sid of ids) {
        const s = next[sid]
        if (!s) continue
        let updated = s
        for (const t of tags) {
          updated = remove ? removeSensorTag(updated, t) : addSensorTag(updated, t)
        }
        if (updated !== s) next[sid] = updated
      }
      return next
    })
  }

  function handleApplyBulkGroup(ids: string[], groupId: string | null) {
    setSensors((prev) => {
      const next: SensorStore = { ...prev }
      for (const sid of ids) {
        const s = next[sid]
        if (!s) continue
        next[sid] = { ...s, groupId }
      }
      return next
    })
  }

  /* -------- Phase 9.9: ユーザー定義区分 -------- */

  function handleUpsertCategory(c: SensorCategory) {
    const isNew = !sensorCategories[c.id]
    setSensorCategories((prev) => upsertCategoryInStore(prev, c))
    toast(
      isNew ? `区分「${c.name}」を作成しました` : '区分を更新しました',
      'success',
    )
  }

  function handleDeleteCategory(id: string) {
    const c = sensorCategories[id]
    setSensorCategories((prev) => deleteCategoryFromStore(prev, id))
    // 紐付くセンサーから categoryId を外す
    setSensors((prev) => {
      let changed = false
      const next: SensorStore = { ...prev }
      for (const sid of Object.keys(next)) {
        if (next[sid].categoryId === id) {
          next[sid] = { ...next[sid], categoryId: null }
          changed = true
        }
      }
      return changed ? next : prev
    })
    toast(`区分「${c?.name ?? id}」を削除しました`, 'info')
  }

  function handleUpdateSensorCategory(sensorId: string, categoryId: string | null) {
    setSensors((prev) => {
      const cur = prev[sensorId]
      if (!cur) return prev
      return { ...prev, [sensorId]: { ...cur, categoryId } }
    })
  }

  function handleUpdateSensorThresholds(
    sensorId: string,
    thresholds: SensorThresholds | undefined,
  ) {
    setSensors((prev) => {
      const cur = prev[sensorId]
      if (!cur) return prev
      return { ...prev, [sensorId]: { ...cur, thresholds } }
    })
  }

  /* -------- Phase 9.14: 閾値テンプレート -------- */

  function handleUpsertThresholdTemplate(t: ThresholdTemplate) {
    const isNew = !thresholdTemplates[t.id]
    setThresholdTemplates((prev) => upsertTemplateInStore(prev, t))
    toast(
      isNew
        ? `閾値テンプレート「${t.name}」を作成しました`
        : `閾値テンプレート「${t.name}」を更新しました`,
      'success',
    )
  }

  function handleDeleteThresholdTemplate(id: string) {
    const t = thresholdTemplates[id]
    setThresholdTemplates((prev) => deleteTemplateFromStore(prev, id))
    toast(`閾値テンプレート「${t?.name ?? id}」を削除しました`, 'info')
  }

  /* Phase G: レポート定期配信 / ダッシュボード確認リマインド */
  function handleUpsertReportSchedule(s: ReportSchedule) {
    const isNew = !reportSchedules[s.id]
    setReportSchedules((prev) => ({ ...prev, [s.id]: s }))
    toast(
      isNew
        ? `定期配信「${s.name}」を作成しました`
        : `定期配信「${s.name}」を更新しました`,
      'success',
    )
  }

  function handleDeleteReportSchedule(id: string) {
    const s = reportSchedules[id]
    setReportSchedules((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    toast(`定期配信「${s?.name ?? id}」を削除しました`, 'info')
  }

  function handleUpsertDashboardReminder(r: DashboardReminder) {
    const isNew = !dashboardReminders[r.id]
    setDashboardReminders((prev) => ({ ...prev, [r.id]: r }))
    toast(
      isNew
        ? `リマインド「${r.name}」を作成しました`
        : `リマインド「${r.name}」を更新しました`,
      'success',
    )
  }

  function handleDeleteDashboardReminder(id: string) {
    const r = dashboardReminders[id]
    setDashboardReminders((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    toast(`リマインド「${r?.name ?? id}」を削除しました`, 'info')
  }

  /** 複数センサーへセンサー設定テンプレートを一括適用。
   *  種別が一致するものだけ更新し、他はスキップ。
   *  scope に含まれている項目だけが上書きされる（含まれない項目は元の値を維持）。 */
  function handleApplyTemplate(
    ids: string[],
    template: import('./types').SensorSettingsTemplate,
  ) {
    setSensors((prev) => {
      const next: SensorStore = { ...prev }
      let skipped = 0
      for (const sid of ids) {
        const s = next[sid]
        if (!s) continue
        const sensorKind = s.kind ?? 'temperature-humidity'
        if (template.targetKind !== sensorKind) {
          skipped += 1
          continue
        }
        next[sid] = applyTemplateToSensor(s, template)
      }
      if (skipped > 0) {
        setTimeout(
          () => toast(`${skipped} 台は種別が一致しないためスキップしました`, 'info'),
          0,
        )
      }
      return next
    })
  }

  /** 基本情報（名前・デバイス番号・シリアル・モデル・メーカー・ゲートウェイ）の編集 */
  function handleUpdateSensorInfo(
    sensorId: string,
    patch: Partial<
      Pick<
        import('./types').Sensor,
        'name' | 'deviceNumber' | 'serialNumber' | 'model' | 'manufacturer' | 'gatewayId'
      >
    >,
  ) {
    setSensors((prev) => {
      const cur = prev[sensorId]
      if (!cur) return prev
      return { ...prev, [sensorId]: { ...cur, ...patch } }
    })
  }

  function handleApplyBulkCategory(ids: string[], categoryId: string | null) {
    setSensors((prev) => {
      const next: SensorStore = { ...prev }
      for (const sid of ids) {
        const s = next[sid]
        if (!s) continue
        next[sid] = { ...s, categoryId }
      }
      return next
    })
  }

  function handleUpdateSensorTags(sensorId: string, tags: string[]) {
    setSensors((prev) => {
      const cur = prev[sensorId]
      if (!cur) return prev
      return { ...prev, [sensorId]: { ...cur, tags } }
    })
  }

  function handleUpdateSensorGroup(sensorId: string, groupId: string | null) {
    setSensors((prev) => {
      const cur = prev[sensorId]
      if (!cur) return prev
      return { ...prev, [sensorId]: { ...cur, groupId } }
    })
  }

  /** ゲートウェイの任意フィールドを部分更新する汎用ハンドラ。
   *  名称・デバイス番号・分類（区分/グループ/タグ）・アラート設定・通知グループなど、
   *  ゲートウェイ詳細画面のリアルタイム保存先として使う。 */
  function handleUpdateGateway(
    gatewayId: string,
    patch: Partial<import('./types').Gateway>,
  ) {
    setGateways((prev) => {
      const cur = prev[gatewayId]
      if (!cur) return prev
      return { ...prev, [gatewayId]: { ...cur, ...patch } }
    })
  }

  function openSensor(id: string) {
    setActiveSensorId(id)
    setView('sensor-detail')
  }

  function openGateway(id: string) {
    setActiveGatewayId(id)
    setView('gateway-detail')
  }

  function navigate(next: ViewKey) {
    setView(next)
    if (next !== 'sensor-detail') setActiveSensorId(null)
    if (next !== 'gateway-detail') setActiveGatewayId(null)
    // 設定画面以外へ遷移したら、次回の設定画面オープンは既定タブに戻す
    if (next !== 'settings') setSettingsInitialTab(undefined)
  }

  function gotoReport(deviceId?: string, ym?: YearMonth) {
    if (deviceId) {
      setReportDeviceIds((prev) => (prev.includes(deviceId) ? prev : [...prev, deviceId]))
    }
    if (ym) setReportMonth(ym)
    setView('report')
  }

  /* -------- ダッシュボード操作 -------- */

  function selectDashboard(id: string) {
    setActiveDashboardId(id)
    setView('dashboard')
  }

  function openCreateDashboard() {
    setCreateDashOpen(true)
  }

  function handleCreateDashboard(patch: {
    name: string
    description: string
    targetSensorIds: string[]
    defaultPeriod: DashboardDefaultPeriod
  }) {
    const d = createDashboard({
      name: patch.name,
      description: patch.description,
      targetSensorIds: patch.targetSensorIds,
      defaultPeriod: patch.defaultPeriod,
    })
    setDashboards((prev) => upsertDashboard(prev, d))
    setActiveDashboardId(d.id)
    setView('dashboard')
    setCreateDashOpen(false)
    toast(`ダッシュボード「${d.name}」を作成しました`, 'success')
  }

  function handleUpdateDashboard(
    id: string,
    patch: {
      name: string
      description: string
      targetSensorIds: string[]
      defaultPeriod: DashboardDefaultPeriod
    },
  ) {
    setDashboards((prev) => {
      const cur = prev[id]
      if (!cur) return prev
      return upsertDashboard(prev, {
        ...cur,
        name: patch.name,
        description: patch.description || undefined,
        targetSensorIds: patch.targetSensorIds,
        defaultPeriod: patch.defaultPeriod,
      })
    })
    toast('ダッシュボードを更新しました', 'success')
  }

  /** Phase F-5: ダッシュボードの公開 URL トークンを発行 / 取り消し。
   *  token=null で取り消し、文字列で発行。 */
  function handleSetDashboardShareToken(id: string, token: string | null) {
    setDashboards((prev) => {
      const cur = prev[id]
      if (!cur) return prev
      const updated = token
        ? {
            ...cur,
            publicShareToken: token,
            publicShareIssuedAt: new Date(),
          }
        : (() => {
            const { publicShareToken: _t, publicShareIssuedAt: _at, ...rest } =
              cur
            void _t
            void _at
            return rest
          })()
      return upsertDashboard(prev, updated)
    })
  }

  function handleDeleteDashboard(id: string) {
    setDashboards((prev) => {
      const next = removeDashboard(prev, id)
      // active が削除対象なら別に切り替え
      if (activeDashboardId === id) {
        const remaining = Object.keys(next).sort()
        setActiveDashboardId(remaining[0] ?? null)
      }
      return next
    })
    toast('ダッシュボードを削除しました', 'info')
  }

  function handleAddWidget(dashboardId: string, widget: Widget) {
    setDashboards((prev) => {
      const cur = prev[dashboardId]
      if (!cur) return prev
      return upsertDashboard(prev, addWidget(cur, widget))
    })
    toast('ウィジェットを追加しました', 'success')
  }

  function handleUpdateWidget(dashboardId: string, widget: Widget) {
    setDashboards((prev) => {
      const cur = prev[dashboardId]
      if (!cur) return prev
      return upsertDashboard(prev, updateWidget(cur, widget))
    })
    toast('ウィジェットを更新しました', 'success')
  }

  function handleRemoveWidget(dashboardId: string, widgetId: string) {
    setDashboards((prev) => {
      const cur = prev[dashboardId]
      if (!cur) return prev
      return upsertDashboard(prev, removeWidget(cur, widgetId))
    })
  }

  function handleMoveWidget(
    dashboardId: string,
    widgetId: string,
    delta: -1 | 1,
  ) {
    setDashboards((prev) => {
      const cur = prev[dashboardId]
      if (!cur) return prev
      return upsertDashboard(prev, moveWidget(cur, widgetId, delta))
    })
  }

  const startBulkPrint = useCallback(() => {
    let target:
      | { kind: 'monthly'; ym: YearMonth; includeRecords: boolean }
      | { kind: 'weekly'; weekStart: Date; includeRecords: boolean }
      | null = null
    let ids: string[] = []

    if (reportKind === 'monthly') {
      if (!reportMonth) return
      target = {
        kind: 'monthly',
        ym: reportMonth,
        includeRecords: reportIncludeRecords,
      }
      ids = sortIds(reportDeviceIds).filter((id) =>
        deviceHasDataForMonth(devices[id], reportMonth),
      )
    } else {
      if (!reportWeekStart) return
      const range = {
        start: reportWeekStart,
        end: (() => {
          const e = new Date(reportWeekStart)
          e.setDate(e.getDate() + 7)
          return e
        })(),
      }
      target = {
        kind: 'weekly',
        weekStart: reportWeekStart,
        includeRecords: reportIncludeRecords,
      }
      ids = sortIds(reportDeviceIds).filter((id) =>
        deviceHasDataForRange(devices[id], range),
      )
    }

    if (ids.length === 0 || !target) return

    flushSync(() => setPrintingBulk(target))
    document.body.classList.add('printing-bulk-month')

    const onAfterPrint = () => {
      document.body.classList.remove('printing-bulk-month')
      setPrintingBulk(null)
      window.removeEventListener('afterprint', onAfterPrint)
    }
    window.addEventListener('afterprint', onAfterPrint)

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        window.print()
      })
    })
  }, [
    reportKind,
    reportMonth,
    reportWeekStart,
    reportDeviceIds,
    reportIncludeRecords,
    devices,
  ])

  return (
    <div
      className={`app-shell ${session?.kind === 'impersonation' ? 'has-impersonation-banner' : ''}`}
    >
      {session?.kind === 'impersonation' && (
        <ImpersonationBanner
          session={session}
          fallbackAdminUserId={DEMO_SUPER_ADMIN_ID}
        />
      )}
      <Sidebar
        current={view}
        onNavigate={navigate}
        dashboards={dashboards}
        activeDashboardId={activeDashboardId}
        onSelectDashboard={selectDashboard}
        onCreateDashboard={openCreateDashboard}
        session={MOCK_SESSION}
        onSwitchContext={() => setContextSelectOpen(true)}
      />

      <main className="app-content">
        <div className="app-content-inner no-print-shell">
          {view === 'dashboard' && (
            <DashboardView
              devices={devices}
              sensors={sensors}
              gateways={gateways}
              dashboards={dashboards}
              activeDashboardId={activeDashboardId}
              checkins={checkins}
              session={MOCK_SESSION}
              sensorGroups={sensorGroups}
              sensorCategories={sensorCategories}
              savedFilters={savedFilters}
              onUpsertSavedFilter={handleUpsertSavedFilter}
              onDevicesChange={handleDevicesChange}
              onOpenSensor={openSensor}
              onCreateDashboard={openCreateDashboard}
              onUpdateDashboard={handleUpdateDashboard}
              onSetDashboardShareToken={handleSetDashboardShareToken}
              onDeleteDashboard={handleDeleteDashboard}
              onAddWidget={handleAddWidget}
              onUpdateWidget={handleUpdateWidget}
              onRemoveWidget={handleRemoveWidget}
              onMoveWidget={handleMoveWidget}
              onCreateCheckin={handleCreateCheckin}
              onGoRecords={() => navigate('records')}
              onGoSettings={() => navigate('settings')}
              onGoManual={() => navigate('manual')}
              dashboardReminders={dashboardReminders}
            />
          )}

          {view === 'sensors' && (
            <SensorsView
              devices={devices}
              sensors={sensors}
              gateways={gateways}
              groups={sensorGroups}
              categories={sensorCategories}
              savedFilters={savedFilters}
              thresholdTemplates={thresholdTemplates}
              notificationGroups={notificationGroups}
              onOpenSensor={openSensor}
              onDeleteSensors={handleDeleteSensors}
              onUpsertGroup={handleUpsertGroup}
              onDeleteGroup={handleDeleteGroup}
              onUpsertCategory={handleUpsertCategory}
              onDeleteCategory={handleDeleteCategory}
              onUpsertSavedFilter={handleUpsertSavedFilter}
              onDeleteSavedFilter={handleDeleteSavedFilter}
              onApplyBulkTags={handleApplyBulkTags}
              onApplyBulkGroup={handleApplyBulkGroup}
              onApplyBulkCategory={handleApplyBulkCategory}
              onApplyTemplate={handleApplyTemplate}
              onGoToThresholdTemplates={() => {
                setSettingsInitialTab('thresholds')
                navigate('settings')
              }}
            />
          )}

          {view === 'sensor-detail' && activeSensorId && devices[activeSensorId] && (
            <SensorDetailView
              deviceId={activeSensorId}
              devices={devices}
              sensors={sensors}
              gateways={gateways}
              notificationGroups={notificationGroups}
              sensorNotes={sensorNotes}
              session={MOCK_SESSION}
              groups={sensorGroups}
              categories={sensorCategories}
              thresholdTemplates={thresholdTemplates}
              onBack={() => navigate('sensors')}
              onGoReport={(id, ym) => gotoReport(id, ym)}
              onSwitchDevice={(id) => setActiveSensorId(id)}
              onOpenGateway={openGateway}
              onUpdateAlertSettings={handleUpdateAlertSettings}
              onUpdateNotificationGroup={handleUpdateSensorNotificationGroup}
              onCreateSensorNote={handleCreateSensorNote}
              onDeleteSensorNote={handleDeleteSensorNote}
              onUpdateSensorTags={handleUpdateSensorTags}
              onUpdateSensorGroup={handleUpdateSensorGroup}
              onUpdateSensorCategory={handleUpdateSensorCategory}
              onUpdateSensorThresholds={handleUpdateSensorThresholds}
              onUpdateSensorInfo={handleUpdateSensorInfo}
            />
          )}

          {view === 'gateways' && (
            <GatewaysView
              gateways={gateways}
              sensors={sensors}
              devices={devices}
              groups={sensorGroups}
              categories={sensorCategories}
              notificationGroups={notificationGroups}
              onOpenGateway={openGateway}
              onOpenSensor={openSensor}
              onUpdateGateway={handleUpdateGateway}
            />
          )}

          {view === 'gateway-detail' && activeGatewayId && (
            <GatewayDetailView
              gatewayId={activeGatewayId}
              gateways={gateways}
              sensors={sensors}
              devices={devices}
              groups={sensorGroups}
              categories={sensorCategories}
              notificationGroups={notificationGroups}
              onBack={() => navigate('gateways')}
              onOpenSensor={openSensor}
              onUpdateGateway={handleUpdateGateway}
            />
          )}

          {view === 'settings' && (
            <SettingsView
              notificationGroups={notificationGroups}
              manufacturerIntegrations={manufacturerIntegrations}
              sensors={sensors}
              gateways={gateways}
              thresholdTemplates={thresholdTemplates}
              organization={currentOrganization}
              invoices={invoices}
              onUpdateStripeCard={(patch) => {
                patchOrganization(patch)
              }}
              onUpsertNotificationGroup={handleUpsertNotificationGroup}
              onDeleteNotificationGroup={handleDeleteNotificationGroup}
              onUpsertThresholdTemplate={handleUpsertThresholdTemplate}
              onDeleteThresholdTemplate={handleDeleteThresholdTemplate}
              reportSchedules={reportSchedules}
              onUpsertReportSchedule={handleUpsertReportSchedule}
              onDeleteReportSchedule={handleDeleteReportSchedule}
              dashboardReminders={dashboardReminders}
              dashboards={dashboards}
              onUpsertDashboardReminder={handleUpsertDashboardReminder}
              onDeleteDashboardReminder={handleDeleteDashboardReminder}
              initialTab={settingsInitialTab}
            />
          )}

          {view === 'records' && (
            <RecordsView
              checkins={checkins}
              sensorNotes={sensorNotes}
              dashboards={dashboards}
              sensors={sensors}
              session={MOCK_SESSION}
              onApproveCheckin={handleApproveCheckin}
              onApproveNote={handleApproveNote}
              onDeleteCheckin={handleDeleteCheckin}
              onDeleteNote={handleDeleteSensorNote}
              onOpenSensor={openSensor}
            />
          )}

          {view === 'alerts' && (
            <AlertsView
              alertLogs={alertLogs}
              sensors={sensors}
              gateways={gateways}
              sensorGroups={sensorGroups}
              sensorCategories={sensorCategories}
              savedFilters={savedFilters}
            />
          )}

          {view === 'manual' && (
            <ManualView
              activeCategoryId={manualCategoryId}
              activePageId={manualPageId}
              onSelectionChange={(catId, pageId) => {
                setManualCategoryId(catId)
                setManualPageId(pageId)
              }}
            />
          )}

          {view === 'report' && (
            <ReportView
              devices={devices}
              selectedDeviceIds={reportDeviceIds}
              onSelectedDeviceIds={setReportDeviceIds}
              sensors={sensors}
              groups={sensorGroups}
              categories={sensorCategories}
              savedFilters={savedFilters}
              printKind={reportKind}
              onPrintKind={setReportKind}
              printMonth={reportMonth}
              onPrintMonth={setReportMonth}
              printWeekStart={reportWeekStart}
              onPrintWeekStart={setReportWeekStart}
              includeRecordsPage={reportIncludeRecords}
              onIncludeRecordsPage={setReportIncludeRecords}
              checkins={checkins}
              sensorNotes={sensorNotes}
              reportSchedules={reportSchedules}
              onGoSettings={() => navigate('settings')}
              onPrint={startBulkPrint}
            />
          )}
        </div>

        <ToastContainer />

        <DashboardEditDialog
          open={createDashOpen}
          initial={null}
          totalCount={Object.keys(dashboards).length}
          sensors={sensors}
          groups={sensorGroups}
          categories={sensorCategories}
          savedFilters={savedFilters}
          onClose={() => setCreateDashOpen(false)}
          onSubmit={handleCreateDashboard}
          onUpsertSavedFilter={handleUpsertSavedFilter}
        />

        {printingBulk && bulkPrintDeviceIds.length > 0 && (
          <div id="bulk-print-root" className="bulk-print-root" aria-hidden="true">
            {bulkPrintDeviceIds.map((deviceId) => {
              const s = sensors[deviceId]
              const label = s?.name?.trim() || s?.deviceNumber || deviceId
              return printingBulk.kind === 'monthly' ? (
                <ReportPreview
                  key={`print-m-${deviceId}-${yearMonthKey(printingBulk.ym)}`}
                  kind="monthly"
                  ym={printingBulk.ym}
                  deviceId={deviceId}
                  deviceLabel={label}
                  readings={devices[deviceId] ?? []}
                  thresholds={s?.thresholds}
                />
              ) : (
                <ReportPreview
                  key={`print-w-${deviceId}-${printingBulk.weekStart.toISOString().slice(0, 10)}`}
                  kind="weekly"
                  weekStart={printingBulk.weekStart}
                  deviceId={deviceId}
                  deviceLabel={label}
                  readings={devices[deviceId] ?? []}
                  thresholds={s?.thresholds}
                />
              )
            })}
            {/* Phase A-4: includeRecords ON のとき、対象デバイス全体に対して
             *   記録履歴・運用メモページを末尾に 1 ページ追加 */}
            {printingBulk.includeRecords &&
              (printingBulk.kind === 'monthly' ? (
                <RecordsAndNotesReport
                  kind="monthly"
                  ym={printingBulk.ym}
                  checkins={checkins}
                  sensorNotes={sensorNotes}
                  deviceIds={bulkPrintDeviceIds}
                />
              ) : (
                <RecordsAndNotesReport
                  kind="weekly"
                  weekStart={printingBulk.weekStart}
                  checkins={checkins}
                  sensorNotes={sensorNotes}
                  deviceIds={bulkPrintDeviceIds}
                />
              ))}
          </div>
        )}
      </main>

      {contextSelectOpen && (
        <ContextSelectView onCancel={() => setContextSelectOpen(false)} />
      )}
    </div>
  )
}
