import { useEffect, useMemo, useState } from 'react'
import {
  Plus,
  Pencil,
  Trash2,
  ArrowUp,
  ArrowDown,
  LayoutGrid,
  LineChart as LineChartIcon,
  Map as MapIcon,
  Settings,
  LayoutDashboard,
  ClipboardCheck,
  CheckCircle2,
  AlertTriangle,
  Clock,
  History,
  Wrench,
  Check,
} from 'lucide-react'
import type {
  Dashboard,
  DashboardCheckin,
  DashboardCheckinStore,
  DashboardDefaultPeriod,
  DashboardPeriodMode,
  DashboardStore,
  DeviceStore,
  GatewayStore,
  ReportThresholds,
  SavedFilter,
  SavedFilterStore,
  SensorCategoryStore,
  SensorGroupStore,
  SensorStore,
  UserSession,
  Widget,
} from '../../types'
import { TileWidget } from '../widgets/TileWidget'
import { ChartWidget } from '../widgets/ChartWidget'
import { MapWidget } from '../widgets/MapWidget'
import { DeviationWidget } from '../widgets/DeviationWidget'
import { WidgetEditDialog } from '../widgets/WidgetEditDialog'
import { DashboardEditDialog } from '../DashboardEditDialog'
import { DashboardConfirmDialog } from '../DashboardConfirmDialog'
import { EmptyState } from '../EmptyState'
import { effectiveSensorIds as resolveEffective } from '../../lib/dashboard'
import { findLatestCheckin } from '../../lib/records'
import { formatRelativeAgo } from '../../lib/jp'

type Props = {
  devices: DeviceStore
  sensors: SensorStore
  gateways: GatewayStore
  thresholds: ReportThresholds
  dashboards: DashboardStore
  activeDashboardId: string | null
  checkins: DashboardCheckinStore
  session: UserSession
  sensorGroups: SensorGroupStore
  sensorCategories: SensorCategoryStore
  savedFilters: SavedFilterStore
  onUpsertSavedFilter: (f: SavedFilter) => void
  onDevicesChange: (next: DeviceStore) => void
  onOpenSensor: (id: string) => void
  onCreateDashboard: () => void
  onUpdateDashboard: (
    id: string,
    patch: {
      name: string
      description: string
      targetSensorIds: string[]
      defaultPeriod: DashboardDefaultPeriod
    },
  ) => void
  onDeleteDashboard: (id: string) => void
  onAddWidget: (dashboardId: string, widget: Widget) => void
  onUpdateWidget: (dashboardId: string, widget: Widget) => void
  onRemoveWidget: (dashboardId: string, widgetId: string) => void
  onMoveWidget: (dashboardId: string, widgetId: string, delta: -1 | 1) => void
  onCreateCheckin: (checkin: DashboardCheckin) => void
  onGoRecords: () => void
}

const PERIOD_MODE_KEY = 'miterude:dashboard:period-mode'

function loadPreferredMode(): DashboardPeriodMode {
  try {
    const v = localStorage.getItem(PERIOD_MODE_KEY)
    if (v === 'fixed' || v === 'since-last-checkin') return v
  } catch {
    /* noop */
  }
  return 'fixed'
}

function savePreferredMode(mode: DashboardPeriodMode) {
  try {
    localStorage.setItem(PERIOD_MODE_KEY, mode)
  } catch {
    /* noop */
  }
}

function periodLabelFromDefault(p: DashboardDefaultPeriod): string {
  if (p.type === 'day') return '直近 1 日'
  if (p.type === 'week') return '直近 1 週間'
  return '直近 1 ヶ月'
}

function rangeFromDefault(p: DashboardDefaultPeriod, now: Date = new Date()): {
  start: Date
  end: Date
} {
  const end = now
  const start = new Date(end)
  if (p.type === 'day') start.setDate(start.getDate() - 1)
  else if (p.type === 'week') start.setDate(start.getDate() - 7)
  else start.setMonth(start.getMonth() - 1)
  return { start, end }
}

function fineGrainFromRange(rangeMs: number): boolean {
  // 1日以下なら時刻刻みの細粒度表記
  return rangeMs <= 24 * 60 * 60 * 1000 * 1.2
}

export function DashboardView({
  devices,
  sensors,
  gateways,
  thresholds,
  dashboards,
  activeDashboardId,
  checkins,
  session,
  sensorGroups,
  sensorCategories,
  savedFilters,
  onUpsertSavedFilter,
  onDevicesChange,
  onOpenSensor,
  onCreateDashboard,
  onUpdateDashboard,
  onDeleteDashboard,
  onAddWidget,
  onUpdateWidget,
  onRemoveWidget,
  onMoveWidget,
  onCreateCheckin,
  onGoRecords,
}: Props) {
  const sensorList = useMemo(() => Object.values(sensors), [sensors])

  const [widgetDialog, setWidgetDialog] = useState<{
    open: boolean
    initial: Widget | null
  }>({ open: false, initial: null })

  const [dashboardDialogOpen, setDashboardDialogOpen] = useState(false)
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false)
  const [periodMode, setPeriodMode] = useState<DashboardPeriodMode>(() =>
    loadPreferredMode(),
  )
  /** Phase 9.6: ダッシュボードのビュー / 編集モード */
  const [editMode, setEditMode] = useState(false)

  // ダッシュボード切り替え時に編集モードは解除する
  useEffect(() => {
    setEditMode(false)
  }, [activeDashboardId])

  useEffect(() => {
    savePreferredMode(periodMode)
  }, [periodMode])

  if (sensorList.length === 0) {
    return <EmptyState devices={devices} onDevicesChange={onDevicesChange} />
  }

  const dashboard: Dashboard | null = activeDashboardId
    ? dashboards[activeDashboardId] ?? null
    : null

  const dashboardCount = Object.keys(dashboards).length

  if (!dashboard) {
    return (
      <div className="dashboard-view">
        <header className="view-header">
          <div className="view-header-text">
            <h1>ダッシュボード</h1>
            <p>
              {dashboardCount === 0
                ? 'まだダッシュボードがありません。フロアやチームごとに作成できます。'
                : '左側のサイドバーからダッシュボードを選択してください。'}
            </p>
          </div>
          <div className="view-header-actions">
            <button type="button" className="btn btn-primary" onClick={onCreateDashboard}>
              <Plus size={16} />
              <span>新しいダッシュボード</span>
            </button>
          </div>
        </header>
        <div className="empty-state">
          <div className="empty-illust">
            <LayoutDashboard size={48} strokeWidth={1.5} />
          </div>
          <h2 className="empty-title">ダッシュボードを作成しましょう</h2>
          <p className="empty-desc">
            ダッシュボードは「対象センサー × 期間」のテンプレートです。
            <br />
            この設定をベースに、タイル・グラフ・マップ・逸脱ピックアップを並べて、毎日の確認作業を効率化できます。
          </p>
        </div>
      </div>
    )
  }

  // 効果的な期間 (effective range) を計算
  const lastCheckin = findLatestCheckin(checkins, dashboard.id)
  const now = new Date()
  let effectiveRange: { start: Date; end: Date }
  let effectiveLabel: string
  if (periodMode === 'since-last-checkin') {
    if (lastCheckin) {
      effectiveRange = { start: lastCheckin.timestamp, end: now }
      const ago = formatRelativeAgo(lastCheckin.timestamp, now)
      effectiveLabel = `前回確認 (${ago}前) からの差分`
    } else {
      // 履歴がなければ既定期間にフォールバック
      effectiveRange = rangeFromDefault(dashboard.defaultPeriod, now)
      effectiveLabel = `${periodLabelFromDefault(dashboard.defaultPeriod)}（前回確認なし）`
    }
  } else {
    effectiveRange = rangeFromDefault(dashboard.defaultPeriod, now)
    effectiveLabel = periodLabelFromDefault(dashboard.defaultPeriod)
  }
  const fineGrain = fineGrainFromRange(
    effectiveRange.end.getTime() - effectiveRange.start.getTime(),
  )

  return (
    <div className="dashboard-view">
      <header className="view-header">
        <div className="view-header-text">
          <h1>{dashboard.name}</h1>
          {dashboard.description && <p>{dashboard.description}</p>}
          <p className="dashboard-context-info">
            <span>
              対象 <strong>{dashboard.targetSensorIds.length}</strong> 台 ・
              既定期間 <strong>{periodLabelFromDefault(dashboard.defaultPeriod)}</strong>
            </span>
            {lastCheckin ? (
              <span>
                <CheckCircle2 size={12} /> 最終確認{' '}
                <strong>{formatRelativeAgo(lastCheckin.timestamp)}</strong> ・{' '}
                {lastCheckin.userName}
                <button type="button" className="link-btn" onClick={onGoRecords}>
                  履歴を見る
                </button>
              </span>
            ) : (
              <span className="muted">確認記録なし</span>
            )}
          </p>
        </div>
        <div className="view-header-actions">
          {editMode ? (
            <>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setDashboardDialogOpen(true)}
              >
                <Settings size={16} />
                <span>ダッシュボード設定</span>
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setWidgetDialog({ open: true, initial: null })}
              >
                <Plus size={16} />
                <span>ウィジェット追加</span>
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setEditMode(false)}
              >
                <Check size={16} />
                <span>編集を完了</span>
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setEditMode(true)}
                title="ウィジェットの追加・編集・並び替え・削除を行う"
              >
                <Wrench size={16} />
                <span>編集する</span>
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setConfirmDialogOpen(true)}
              >
                <ClipboardCheck size={16} />
                <span>確認を記録</span>
              </button>
            </>
          )}
        </div>
      </header>

      {editMode && (
        <div className="edit-mode-banner">
          <Wrench size={14} />
          <span>
            <strong>編集モード中</strong>{' '}
            ・ ウィジェットの追加・編集・並び替え・削除ができます
          </span>
        </div>
      )}

      {/* 期間モード切替バー */}
      <div className="dashboard-period-bar">
        <div className="dashboard-period-mode">
          <span className="muted">期間モード:</span>
          <div className="seg-toggle">
            <button
              type="button"
              className={`seg-toggle-btn ${periodMode === 'fixed' ? 'is-active' : ''}`}
              onClick={() => setPeriodMode('fixed')}
              title="ダッシュボード設定の固定期間で表示"
            >
              <Clock size={13} />
              固定期間
            </button>
            <button
              type="button"
              className={`seg-toggle-btn ${periodMode === 'since-last-checkin' ? 'is-active' : ''}`}
              onClick={() => setPeriodMode('since-last-checkin')}
              title="前回の確認チェックインから今までを表示"
              disabled={!lastCheckin && periodMode !== 'since-last-checkin'}
            >
              <History size={13} />
              前回確認から
            </button>
          </div>
        </div>
        <div className="dashboard-period-current">
          <strong>{effectiveLabel}</strong>
          <span className="muted">
            {effectiveRange.start.toLocaleString('ja-JP', {
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
            })}{' '}
            〜{' '}
            {effectiveRange.end.toLocaleString('ja-JP', {
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
        </div>
      </div>

      {dashboard.widgets.length === 0 ? (
        <div className="empty-state empty-state-compact">
          <h2 className="empty-title">まだウィジェットがありません</h2>
          <p className="empty-desc">
            タイル群・折れ線グラフ・フロアマップ・逸脱ピックアップを組み合わせて、確認しやすいレイアウトを作りましょう。
          </p>
          <div className="empty-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setEditMode(true)
                setWidgetDialog({ open: true, initial: null })
              }}
            >
              <Plus size={16} />
              <span>最初のウィジェットを追加</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="widgets-grid">
          {dashboard.widgets.map((w, idx) => {
            const effIds = resolveEffective(w, dashboard)
            return (
              <article
                key={w.id}
                className={`widget-card widget-${w.span}`}
                data-widget-type={w.type}
              >
                <header className="widget-card-head">
                  <div className="widget-card-title">
                    {w.type === 'tiles' ? (
                      <LayoutGrid size={14} className="head-icon" />
                    ) : w.type === 'chart' ? (
                      <LineChartIcon size={14} className="head-icon" />
                    ) : w.type === 'map' ? (
                      <MapIcon size={14} className="head-icon" />
                    ) : (
                      <AlertTriangle size={14} className="head-icon" />
                    )}
                    <h3>{w.title}</h3>
                    <span className="widget-card-meta">
                      {w.sensorIds.length === 0
                        ? `全 ${dashboard.targetSensorIds.length} 台`
                        : `${effIds.length} 台（絞り込み）`}
                      {w.type === 'chart' &&
                        ` ・ ${w.metric === 'temperature' ? '温度' : '湿度'}`}
                    </span>
                  </div>
                  {editMode && (
                    <div className="widget-card-actions">
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label="上へ"
                        disabled={idx === 0}
                        onClick={() => onMoveWidget(dashboard.id, w.id, -1)}
                      >
                        <ArrowUp size={14} />
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label="下へ"
                        disabled={idx === dashboard.widgets.length - 1}
                        onClick={() => onMoveWidget(dashboard.id, w.id, 1)}
                      >
                        <ArrowDown size={14} />
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label="編集"
                        onClick={() => setWidgetDialog({ open: true, initial: w })}
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        type="button"
                        className="icon-btn icon-btn-danger"
                        aria-label="削除"
                        onClick={() => {
                          if (confirm('このウィジェットを削除しますか？')) {
                            onRemoveWidget(dashboard.id, w.id)
                          }
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  )}
                </header>
                <div className="widget-card-body">
                  {w.type === 'tiles' ? (
                    <TileWidget
                      widget={{ ...w, sensorIds: effIds }}
                      devices={devices}
                      sensors={sensors}
                      gateways={gateways}
                      categories={sensorCategories}
                      thresholds={thresholds}
                      onOpenSensor={onOpenSensor}
                    />
                  ) : w.type === 'chart' ? (
                    <ChartWidget
                      widget={w}
                      devices={devices}
                      sensors={sensors}
                      effectiveSensorIds={effIds}
                      range={effectiveRange}
                      fineGrain={fineGrain}
                    />
                  ) : w.type === 'map' ? (
                    <MapWidget
                      widget={{ ...w, sensorIds: effIds }}
                      devices={devices}
                      sensors={sensors}
                      categories={sensorCategories}
                      thresholds={thresholds}
                      onUpdate={(next) => onUpdateWidget(dashboard.id, next)}
                      onOpenSensor={onOpenSensor}
                      editable={editMode}
                    />
                  ) : (
                    <DeviationWidget
                      widget={w}
                      devices={devices}
                      sensors={sensors}
                      thresholds={thresholds}
                      effectiveSensorIds={effIds}
                      range={effectiveRange}
                      periodLabel={effectiveLabel}
                      onOpenSensor={onOpenSensor}
                    />
                  )}
                </div>
              </article>
            )
          })}
        </div>
      )}

      <WidgetEditDialog
        open={widgetDialog.open}
        initial={widgetDialog.initial}
        dashboard={dashboard}
        sensors={sensors}
        groups={sensorGroups}
        categories={sensorCategories}
        savedFilters={savedFilters}
        onClose={() => setWidgetDialog({ open: false, initial: null })}
        onSubmit={(w) => {
          if (widgetDialog.initial) {
            onUpdateWidget(dashboard.id, w)
          } else {
            onAddWidget(dashboard.id, w)
          }
          setWidgetDialog({ open: false, initial: null })
        }}
      />

      <DashboardEditDialog
        open={dashboardDialogOpen}
        initial={dashboard}
        totalCount={dashboardCount}
        sensors={sensors}
        groups={sensorGroups}
        categories={sensorCategories}
        savedFilters={savedFilters}
        onClose={() => setDashboardDialogOpen(false)}
        onSubmit={(patch) => {
          onUpdateDashboard(dashboard.id, patch)
          setDashboardDialogOpen(false)
        }}
        onDelete={() => {
          onDeleteDashboard(dashboard.id)
          setDashboardDialogOpen(false)
        }}
        onUpsertSavedFilter={onUpsertSavedFilter}
      />

      <DashboardConfirmDialog
        open={confirmDialogOpen}
        dashboard={dashboard}
        devices={devices}
        sensors={sensors}
        thresholds={thresholds}
        session={session}
        range={effectiveRange}
        periodLabel={effectiveLabel}
        onClose={() => setConfirmDialogOpen(false)}
        onSubmit={(checkin) => {
          onCreateCheckin(checkin)
          setConfirmDialogOpen(false)
        }}
      />
    </div>
  )
}
