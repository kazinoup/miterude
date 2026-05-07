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
import { ReportPreview } from './components/ReportPreview'
import { RecordsAndNotesReport } from './components/RecordsAndNotesReport'
import { ToastContainer } from './components/ToastContainer'
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
  ManufacturerIntegration,
  ManufacturerIntegrationStore,
  NotificationGroup,
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
  loadUsers,
} from './admin/lib/adminStorage'
import { ensureSeedData, DEMO_ORG_ID } from './admin/lib/adminSeed'
import { DevSessionBar } from './admin/DevSessionBar'
import type { AuthSession } from './types'
import { loadState, saveState } from './lib/storage'
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
  upsertIntegration,
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
  buildDefaultTemplates,
  cloneThresholds,
  removeTemplate as deleteTemplateFromStore,
  upsertTemplate as upsertTemplateInStore,
} from './lib/thresholdTemplates'
import { toast } from './lib/toast'
import './App.css'
import './styles/dashboard.css'
import './styles/report.css'

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
    }
  }, [session, activeOrgId])

  // --- 永続化: マウント時にロード -----------------------------
  const initial = useMemo(() => loadState(activeOrgId), [activeOrgId])

  const [devices, setDevices] = useState<DeviceStore>(initial?.devices ?? {})
  const [sensors, setSensors] = useState<SensorStore>(initial?.sensors ?? {})
  const [gateways, setGateways] = useState<GatewayStore>(initial?.gateways ?? {})
  const [dashboards, setDashboards] = useState<DashboardStore>(
    initial?.dashboards ?? {},
  )
  const [activeDashboardId, setActiveDashboardId] = useState<string | null>(
    initial?.activeDashboardId ?? null,
  )
  const [notificationGroups, setNotificationGroups] = useState<NotificationGroupStore>(
    initial?.notificationGroups ?? {},
  )
  const [manufacturerIntegrations, setManufacturerIntegrations] =
    useState<ManufacturerIntegrationStore>(
      initial?.manufacturerIntegrations ?? buildDefaultIntegrations(),
    )
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

  const [view, setView] = useState<ViewKey>('dashboard')
  const [activeSensorId, setActiveSensorId] = useState<string | null>(null)
  const [activeGatewayId, setActiveGatewayId] = useState<string | null>(null)
  /** 設定画面を特定タブで開くためのヒント。
   *  navigate('settings') 直前に setSettingsInitialTab で指定し、
   *  SettingsView マウント時の初期タブとして消費する。 */
  const [settingsInitialTab, setSettingsInitialTab] = useState<
    'integrations' | 'notifications' | 'thresholds' | 'devices' | undefined
  >(undefined)

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
    saveState(
      {
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
      },
      activeOrgId,
    )
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

  const sensorIds = useMemo(() => Object.keys(sensors).sort(), [sensors])

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

  function handleUpdateIntegration(i: ManufacturerIntegration) {
    setManufacturerIntegrations((prev) => upsertIntegration(prev, i))
    toast(`${i.manufacturer} 連携を${i.enabled ? '有効化' : '更新'}しました`, 'success')
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

  /** 複数センサーへ閾値を一括適用（種別が一致するものだけ更新、他はスキップ） */
  function handleApplyBulkThresholds(
    ids: string[],
    thresholds: SensorThresholds | undefined,
  ) {
    setSensors((prev) => {
      const next: SensorStore = { ...prev }
      let skipped = 0
      for (const sid of ids) {
        const s = next[sid]
        if (!s) continue
        if (thresholds) {
          // 種別チェック: thresholds.kind がセンサーの kind と一致するかチェック
          const sensorKind = s.kind ?? 'temperature-humidity'
          if (thresholds.kind !== sensorKind) {
            skipped += 1
            continue
          }
          // スナップショット適用: 参照を切り離してコピー
          next[sid] = { ...s, thresholds: cloneThresholds(thresholds) }
        } else {
          // クリア
          next[sid] = { ...s, thresholds: undefined }
        }
      }
      if (skipped > 0) {
        // state 更新中に toast を呼ぶと不安定なので setTimeout で逃がす
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
    <div className="app-shell">
      <Sidebar
        current={view}
        onNavigate={navigate}
        sensorCount={sensorIds.length}
        dashboards={dashboards}
        activeDashboardId={activeDashboardId}
        onSelectDashboard={selectDashboard}
        onCreateDashboard={openCreateDashboard}
        session={MOCK_SESSION}
      />

      <main className="app-content">
        {/* Phase A-1: 開発用セッション切替バー（後で正式なログイン画面に置換） */}
        <DevSessionBar />
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
              onDeleteDashboard={handleDeleteDashboard}
              onAddWidget={handleAddWidget}
              onUpdateWidget={handleUpdateWidget}
              onRemoveWidget={handleRemoveWidget}
              onMoveWidget={handleMoveWidget}
              onCreateCheckin={handleCreateCheckin}
              onGoRecords={() => navigate('records')}
              onGoSettings={() => navigate('settings')}
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
              onApplyBulkThresholds={handleApplyBulkThresholds}
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
              onOpenGateway={openGateway}
              onOpenSensor={openSensor}
            />
          )}

          {view === 'gateway-detail' && activeGatewayId && (
            <GatewayDetailView
              gatewayId={activeGatewayId}
              gateways={gateways}
              sensors={sensors}
              devices={devices}
              onBack={() => navigate('gateways')}
              onOpenSensor={openSensor}
            />
          )}

          {view === 'settings' && (
            <SettingsView
              notificationGroups={notificationGroups}
              manufacturerIntegrations={manufacturerIntegrations}
              sensors={sensors}
              thresholdTemplates={thresholdTemplates}
              onUpsertNotificationGroup={handleUpsertNotificationGroup}
              onDeleteNotificationGroup={handleDeleteNotificationGroup}
              onUpdateIntegration={handleUpdateIntegration}
              onUpsertThresholdTemplate={handleUpsertThresholdTemplate}
              onDeleteThresholdTemplate={handleDeleteThresholdTemplate}
              devices={devices}
              onDevicesChange={handleDevicesChange}
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
            {bulkPrintDeviceIds.map((deviceId) =>
              printingBulk.kind === 'monthly' ? (
                <ReportPreview
                  key={`print-m-${deviceId}-${yearMonthKey(printingBulk.ym)}`}
                  kind="monthly"
                  ym={printingBulk.ym}
                  deviceId={deviceId}
                  readings={devices[deviceId] ?? []}
                  thresholds={sensors[deviceId]?.thresholds}
                />
              ) : (
                <ReportPreview
                  key={`print-w-${deviceId}-${printingBulk.weekStart.toISOString().slice(0, 10)}`}
                  kind="weekly"
                  weekStart={printingBulk.weekStart}
                  deviceId={deviceId}
                  readings={devices[deviceId] ?? []}
                  thresholds={sensors[deviceId]?.thresholds}
                />
              ),
            )}
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
    </div>
  )
}
