import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Activity,
  AlertTriangle,
  Thermometer,
  Droplets,
  FileBarChart2,
  Wifi,
  WifiOff,
  BatteryFull,
  BatteryMedium,
  BatteryLow,
  BatteryWarning,
  Router as RouterIcon,
  CalendarDays,
  Rows3,
  LineChart as LineChartIcon,
  Pencil,
  Plus,
  Trash2,
  ShieldCheck,
} from 'lucide-react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type {
  AlertSettings,
  DeviceStore,
  GatewayStore,
  NotificationGroupStore,
  ReportThresholds,
  Sensor,
  SensorCategoryStore,
  SensorGroupStore,
  SensorNote,
  SensorNoteStore,
  SensorStore,
  StorageKind,
  UserSession,
  YearMonth,
} from '../../types'
import { SENSOR_NOTE_CATEGORY_LABELS } from '../../types'
import { normalizeTag } from '../../lib/groups'
import { CATEGORY_ICON_COMPONENTS } from '../../lib/categories'
import {
  activeTempRange,
  cellIsDeviation,
  inferStorageKindForRange,
  isMetricDeviationEnabled,
  storageKindLabelJp,
  summarizeRange,
} from '../../lib/report'
import {
  formatPeriodLabel,
  fromDateInputValue,
  fromMonthInputValue,
  periodRange,
  shiftPeriod,
  toDateInputValue,
  toMonthInputValue,
  type PeriodType,
} from '../../lib/period'
import { KpiCard } from '../KpiCard'
import { SensorAlertSettings } from '../SensorAlertSettings'
import { SensorNoteDialog } from '../SensorNoteDialog'
import { notesForSensor } from '../../lib/records'
import { formatRelativeAgo } from '../../lib/jp'

type Props = {
  deviceId: string
  devices: DeviceStore
  sensors: SensorStore
  gateways: GatewayStore
  thresholds: ReportThresholds
  notificationGroups: NotificationGroupStore
  sensorNotes: SensorNoteStore
  session: UserSession
  groups: SensorGroupStore
  categories: SensorCategoryStore
  onBack: () => void
  onGoReport: (deviceId: string, ym?: YearMonth) => void
  onSwitchDevice: (deviceId: string) => void
  onOpenGateway: (gatewayId: string) => void
  onUpdateAlertSettings: (sensorId: string, next: AlertSettings) => void
  onUpdateNotificationGroup: (sensorId: string, groupId: string | null) => void
  onCreateSensorNote: (note: SensorNote) => void
  onDeleteSensorNote: (id: string) => void
  onUpdateSensorTags: (sensorId: string, tags: string[]) => void
  onUpdateSensorGroup: (sensorId: string, groupId: string | null) => void
  onUpdateSensorCategory: (sensorId: string, categoryId: string | null) => void
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
}

function fmtTime(d: Date): string {
  return d.toLocaleString('ja-JP', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function fmtDateTime(d?: Date): string {
  if (!d) return '-'
  return d.toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function batteryIcon(pct: number) {
  if (pct < 15) return BatteryWarning
  if (pct < 35) return BatteryLow
  if (pct < 65) return BatteryMedium
  return BatteryFull
}

function StorageLabel({ kind }: { kind: StorageKind }) {
  return <span className="storage-label">{storageKindLabelJp(kind)}</span>
}

function MetaItem({
  label,
  value,
  mono,
}: {
  label: string
  value: React.ReactNode
  mono?: boolean
}) {
  return (
    <div className="meta-item">
      <span className="meta-item-label">{label}</span>
      <span className={`meta-item-value ${mono ? 'mono' : ''}`}>{value}</span>
    </div>
  )
}

export function SensorDetailView({
  deviceId,
  devices,
  sensors,
  gateways,
  thresholds,
  notificationGroups,
  sensorNotes,
  session,
  groups,
  categories,
  onBack,
  onGoReport,
  onSwitchDevice,
  onOpenGateway,
  onUpdateAlertSettings,
  onUpdateNotificationGroup,
  onCreateSensorNote,
  onDeleteSensorNote,
  onUpdateSensorTags,
  onUpdateSensorGroup,
  onUpdateSensorCategory,
}: Props) {
  const [noteDialogOpen, setNoteDialogOpen] = useState(false)
  const [tagInput, setTagInput] = useState('')
  const sensorNoteList = useMemo(
    () => notesForSensor(sensorNotes, deviceId),
    [sensorNotes, deviceId],
  )
  const readings = devices[deviceId] ?? []
  const sensor: Sensor | undefined = sensors[deviceId]
  const gateway = sensor ? gateways[sensor.gatewayId] : undefined

  // 履歴ビューア state
  const [periodType, setPeriodType] = useState<PeriodType>('month')
  const initialAnchor = useMemo(() => {
    const last = readings[readings.length - 1]
    return last?.measuredAt ?? new Date()
  }, [readings])
  const [anchor, setAnchor] = useState<Date>(initialAnchor)
  const [viewMode, setViewMode] = useState<'chart' | 'list'>('chart')

  // デバイスや読み込みデータが切り替わった際にアンカーを最新側に更新
  useEffect(() => {
    setAnchor(initialAnchor)
  }, [deviceId, initialAnchor])

  const range = useMemo(() => periodRange(periodType, anchor), [periodType, anchor])

  const periodReadings = useMemo(
    () => readings.filter((r) => r.measuredAt >= range.start && r.measuredAt < range.end),
    [readings, range],
  )

  const storageKind = useMemo(
    () => inferStorageKindForRange(readings, range),
    [readings, range],
  )

  const tempSum = useMemo(
    () => summarizeRange(readings, range, 'temperature', thresholds, storageKind),
    [readings, range, thresholds, storageKind],
  )
  const humSum = useMemo(
    () => summarizeRange(readings, range, 'humidity', thresholds, storageKind),
    [readings, range, thresholds, storageKind],
  )

  const chartData = useMemo(
    () =>
      periodReadings.map((r) => ({
        ts: r.measuredAt.getTime(),
        温度: r.temperature,
        湿度: r.humidity,
      })),
    [periodReadings],
  )

  const tempRange = activeTempRange(storageKind, thresholds)
  const useT = isMetricDeviationEnabled('temperature', thresholds, storageKind)
  const useH = isMetricDeviationEnabled('humidity', thresholds, storageKind)

  const allDeviceIds = useMemo(() => Object.keys(sensors).sort(), [sensors])
  const deviceIndex = allDeviceIds.indexOf(deviceId)
  const prevDevice = deviceIndex > 0 ? allDeviceIds[deviceIndex - 1] : null
  const nextDevice =
    deviceIndex >= 0 && deviceIndex < allDeviceIds.length - 1
      ? allDeviceIds[deviceIndex + 1]
      : null

  const xTickFormatter = (ts: number) => {
    const d = new Date(ts)
    if (periodType === 'day') {
      return d.toLocaleString('ja-JP', { hour: '2-digit', minute: '2-digit' })
    }
    return d.toLocaleString('ja-JP', { month: '2-digit', day: '2-digit' })
  }

  const xAxisTimeProps = {
    dataKey: 'ts' as const,
    type: 'number' as const,
    domain: [range.start.getTime(), range.end.getTime()] as [number, number],
    tick: { fontSize: 11, fill: '#4b5563' },
    tickFormatter: xTickFormatter,
    minTickGap: periodType === 'day' ? 24 : 32,
    stroke: '#94a3b8',
  }

  const monthForReport: YearMonth = {
    year: anchor.getFullYear(),
    month: anchor.getMonth() + 1,
  }

  const BatteryIcon = sensor ? batteryIcon(sensor.battery) : BatteryFull

  const periodTabs: { key: PeriodType; label: string }[] = [
    { key: 'day', label: '日' },
    { key: 'week', label: '週' },
    { key: 'month', label: '月' },
  ]

  return (
    <div className="device-detail-view">
      <div className="breadcrumb">
        <button type="button" className="link-btn" onClick={onBack}>
          <ArrowLeft size={14} />
          <span>センサー一覧</span>
        </button>
        <ChevronRight size={14} className="bc-sep" />
        <span className="bc-current">{deviceId}</span>
      </div>

      <header className="view-header">
        <div className="view-header-text">
          <h1 className="device-title">
            <span className="device-title-id">{deviceId}</span>
            {sensor && <span className="device-devnum">{sensor.deviceNumber}</span>}
          </h1>
          <p>
            <StorageLabel kind={storageKind} /> ・{' '}
            {readings.length.toLocaleString('ja-JP')} 件
          </p>
        </div>
        <div className="view-header-actions">
          <div className="device-switcher">
            <button
              type="button"
              className="icon-btn"
              disabled={!prevDevice}
              onClick={() => prevDevice && onSwitchDevice(prevDevice)}
              aria-label="前のセンサー"
            >
              <ChevronLeft size={16} />
            </button>
            <select
              value={deviceId}
              onChange={(e) => onSwitchDevice(e.target.value)}
              className="select"
            >
              {allDeviceIds.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="icon-btn"
              disabled={!nextDevice}
              onClick={() => nextDevice && onSwitchDevice(nextDevice)}
              aria-label="次のセンサー"
            >
              <ChevronRight size={16} />
            </button>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => onGoReport(deviceId, monthForReport)}
          >
            <FileBarChart2 size={16} />
            <span>月報を表示</span>
          </button>
        </div>
      </header>

      {sensor && (
        <section className="panel-card sensor-meta-card">
          <div className="panel-card-head">
            <h2>センサー情報</h2>
            <div className="panel-card-meta">
              {sensor.online ? (
                <span className="badge badge-online">
                  <Wifi size={11} strokeWidth={2.2} />
                  オンライン
                </span>
              ) : (
                <span className="badge badge-offline">
                  <WifiOff size={11} strokeWidth={2.2} />
                  オフライン
                </span>
              )}
              <span
                className={`battery-cell ${
                  sensor.battery < 15
                    ? 'cell-deviation'
                    : sensor.battery < 35
                      ? 'battery-low'
                      : ''
                }`}
              >
                <BatteryIcon size={14} strokeWidth={2} />
                <span>{sensor.battery}%</span>
              </span>
            </div>
          </div>
          <div className="meta-grid">
            <MetaItem label="デバイス番号" value={sensor.deviceNumber} mono />
            <MetaItem label="シリアル番号" value={sensor.serialNumber} mono />
            <MetaItem label="モデル" value={sensor.model} />
            <MetaItem label="メーカー" value={sensor.manufacturer} />
            <MetaItem
              label="接続ゲートウェイ"
              value={
                gateway ? (
                  <button
                    type="button"
                    className="link-btn meta-link-btn"
                    onClick={() => onOpenGateway(gateway.id)}
                  >
                    <RouterIcon size={13} />
                    <span>{gateway.name}</span>
                    <span className="meta-sub-inline">（{gateway.id}）</span>
                  </button>
                ) : (
                  <span className="muted">-</span>
                )
              }
            />
            <MetaItem label="最終受信" value={fmtDateTime(sensor.lastSeenAt)} mono />
          </div>
        </section>
      )}

      {sensor && (
        <section className="panel-card">
          <div className="panel-card-head">
            <h2>
              <Pencil size={16} className="head-icon" />
              分類
            </h2>
            <span className="panel-card-meta muted">
              グループ・タグはセンサー一覧の絞り込みやダッシュボード対象選択で使えます。
            </span>
          </div>
          <div className="classify-row">
            <label className="classify-field">
              <span className="classify-label">区分</span>
              <div className="classify-select-wrap">
                {(() => {
                  const cat = sensor.categoryId ? categories[sensor.categoryId] : undefined
                  if (!cat) {
                    return <span className="classify-icon classify-icon-empty" aria-hidden="true">—</span>
                  }
                  const Icon = CATEGORY_ICON_COMPONENTS[cat.icon]
                  return (
                    <span className="classify-icon" aria-hidden="true">
                      <Icon size={14} strokeWidth={2.2} />
                    </span>
                  )
                })()}
                <select
                  className="select"
                  value={sensor.categoryId ?? ''}
                  onChange={(e) =>
                    onUpdateSensorCategory(deviceId, e.target.value || null)
                  }
                >
                  <option value="">未設定</option>
                  {Object.values(categories)
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </select>
              </div>
            </label>
            <label className="classify-field">
              <span className="classify-label">グループ</span>
              <select
                className="select"
                value={sensor.groupId ?? ''}
                onChange={(e) =>
                  onUpdateSensorGroup(deviceId, e.target.value || null)
                }
              >
                <option value="">未分類</option>
                {Object.values(groups)
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
              </select>
            </label>
            <div className="classify-field">
              <span className="classify-label">タグ</span>
              <div className="tag-editor">
                {(sensor.tags ?? []).map((t) => (
                  <span key={t} className="tag-editor-pill">
                    {t}
                    <button
                      type="button"
                      className="tag-editor-pill-remove"
                      aria-label={`タグ ${t} を削除`}
                      onClick={() =>
                        onUpdateSensorTags(
                          deviceId,
                          (sensor.tags ?? []).filter((x) => x !== t),
                        )
                      }
                    >
                      ×
                    </button>
                  </span>
                ))}
                <input
                  type="text"
                  className="tag-editor-input"
                  placeholder="タグを入力して Enter"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      const t = normalizeTag(tagInput)
                      if (!t) return
                      const cur = sensor.tags ?? []
                      if (!cur.includes(t)) {
                        onUpdateSensorTags(deviceId, [...cur, t])
                      }
                      setTagInput('')
                    } else if (
                      e.key === 'Backspace' &&
                      !tagInput &&
                      (sensor.tags ?? []).length > 0
                    ) {
                      // Backspace で末尾タグを削除
                      const cur = sensor.tags ?? []
                      onUpdateSensorTags(deviceId, cur.slice(0, -1))
                    }
                  }}
                />
              </div>
            </div>
          </div>
        </section>
      )}

      <section className="panel-card history-card">
        <div className="panel-card-head">
          <h2>
            <CalendarDays size={16} className="head-icon" />
            履歴
          </h2>
          <div className="view-toggle" role="group" aria-label="表示モード">
            <button
              type="button"
              className={`view-toggle-btn ${viewMode === 'chart' ? 'is-active' : ''}`}
              onClick={() => setViewMode('chart')}
              aria-pressed={viewMode === 'chart'}
            >
              <LineChartIcon size={14} />
              <span>グラフ</span>
            </button>
            <button
              type="button"
              className={`view-toggle-btn ${viewMode === 'list' ? 'is-active' : ''}`}
              onClick={() => setViewMode('list')}
              aria-pressed={viewMode === 'list'}
            >
              <Rows3 size={14} />
              <span>一覧</span>
            </button>
          </div>
        </div>

        <div className="history-controls">
          <div className="period-tabs" role="group" aria-label="期間タイプ">
            {periodTabs.map((p) => (
              <button
                key={p.key}
                type="button"
                className={`period-tab ${periodType === p.key ? 'is-active' : ''}`}
                onClick={() => setPeriodType(p.key)}
                aria-pressed={periodType === p.key}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="period-nav">
            <button
              type="button"
              className="icon-btn"
              onClick={() => setAnchor((a) => shiftPeriod(periodType, a, -1))}
              aria-label="前の期間"
            >
              <ChevronLeft size={16} />
            </button>

            {periodType === 'month' ? (
              <input
                type="month"
                className="select"
                value={toMonthInputValue(anchor)}
                onChange={(e) => {
                  const d = fromMonthInputValue(e.target.value)
                  if (d) setAnchor(d)
                }}
              />
            ) : (
              <input
                type="date"
                className="select"
                value={toDateInputValue(anchor)}
                onChange={(e) => {
                  const d = fromDateInputValue(e.target.value)
                  if (d) setAnchor(d)
                }}
              />
            )}

            <button
              type="button"
              className="icon-btn"
              onClick={() => setAnchor((a) => shiftPeriod(periodType, a, 1))}
              aria-label="次の期間"
            >
              <ChevronRight size={16} />
            </button>

            <span className="period-label">{formatPeriodLabel(periodType, anchor)}</span>
          </div>
        </div>

        <div className="kpi-grid kpi-grid-4">
          <KpiCard
            label="計測回数"
            value={tempSum.count.toLocaleString('ja-JP')}
            unit="件"
            icon={<Activity size={18} strokeWidth={2} />}
          />
          <KpiCard
            label="平均温度"
            value={tempSum.avg != null ? tempSum.avg.toFixed(1) : '-'}
            unit="℃"
            hint={
              useT
                ? `基準 ${tempRange.min.toFixed(1)} 〜 ${tempRange.max.toFixed(1)}℃`
                : '逸脱判定なし'
            }
            icon={<Thermometer size={18} strokeWidth={2} />}
          />
          <KpiCard
            label="平均湿度"
            value={humSum.avg != null ? humSum.avg.toFixed(1) : '-'}
            unit="%"
            hint={
              useH
                ? `基準 ${thresholds.humMin.toFixed(0)} 〜 ${thresholds.humMax.toFixed(0)}%`
                : '逸脱判定なし'
            }
            icon={<Droplets size={18} strokeWidth={2} />}
          />
          <KpiCard
            label="逸脱回数"
            value={
              (useT ? tempSum.deviationCount : 0) + (useH ? humSum.deviationCount : 0)
            }
            unit="回"
            hint={`温度 ${useT ? tempSum.deviationCount : '—'} ／ 湿度 ${
              useH ? humSum.deviationCount : '—'
            }`}
            icon={<AlertTriangle size={18} strokeWidth={2} />}
            deviation={
              (useT && tempSum.deviationCount > 0) ||
              (useH && humSum.deviationCount > 0)
            }
          />
        </div>

        {viewMode === 'chart' ? (
          <div className="history-charts">
            <div>
              <p className="chart-block-title">温度（℃）</p>
              <div className="detail-chart-wrap">
                {chartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart
                      data={chartData}
                      margin={{ top: 8, right: 16, left: 8, bottom: 8 }}
                    >
                      <CartesianGrid stroke="#e6eaf0" strokeDasharray="3 3" />
                      <XAxis {...xAxisTimeProps} />
                      <YAxis
                        tick={{ fontSize: 11, fill: '#4b5563' }}
                        stroke="#94a3b8"
                        width={44}
                        domain={['auto', 'auto']}
                      />
                      <Tooltip
                        contentStyle={{
                          background: '#ffffff',
                          border: '1px solid #d3dae3',
                          borderRadius: 6,
                          fontSize: 12,
                        }}
                        labelFormatter={(ts) => fmtTime(new Date(ts as number))}
                        formatter={(v) => [`${Number(v).toFixed(1)} ℃`, '温度']}
                      />
                      {useT && (
                        <>
                          <ReferenceLine
                            y={tempRange.min}
                            stroke="#c00"
                            strokeDasharray="4 4"
                            strokeWidth={1}
                          />
                          <ReferenceLine
                            y={tempRange.max}
                            stroke="#c00"
                            strokeDasharray="4 4"
                            strokeWidth={1}
                          />
                        </>
                      )}
                      <Line
                        type="monotone"
                        dataKey="温度"
                        stroke="#1a6fb5"
                        strokeWidth={2}
                        dot={false}
                        isAnimationActive={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="no-data">この期間のデータがありません。</p>
                )}
              </div>
            </div>

            <div>
              <p className="chart-block-title">湿度（%）</p>
              <div className="detail-chart-wrap">
                {chartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart
                      data={chartData}
                      margin={{ top: 8, right: 16, left: 8, bottom: 8 }}
                    >
                      <CartesianGrid stroke="#e6eaf0" strokeDasharray="3 3" />
                      <XAxis {...xAxisTimeProps} />
                      <YAxis
                        tick={{ fontSize: 11, fill: '#4b5563' }}
                        stroke="#94a3b8"
                        width={44}
                        domain={[0, 100]}
                      />
                      <Tooltip
                        contentStyle={{
                          background: '#ffffff',
                          border: '1px solid #d3dae3',
                          borderRadius: 6,
                          fontSize: 12,
                        }}
                        labelFormatter={(ts) => fmtTime(new Date(ts as number))}
                        formatter={(v) => [`${Number(v).toFixed(1)} %`, '湿度']}
                      />
                      {useH && (
                        <>
                          <ReferenceLine
                            y={thresholds.humMin}
                            stroke="#c00"
                            strokeDasharray="4 4"
                            strokeWidth={1}
                          />
                          <ReferenceLine
                            y={thresholds.humMax}
                            stroke="#c00"
                            strokeDasharray="4 4"
                            strokeWidth={1}
                          />
                        </>
                      )}
                      <Line
                        type="monotone"
                        dataKey="湿度"
                        stroke="#b45309"
                        strokeWidth={1.8}
                        dot={false}
                        isAnimationActive={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="no-data">この期間のデータがありません。</p>
                )}
              </div>
            </div>
          </div>
        ) : (
          <HistoryList
            readings={periodReadings}
            thresholds={thresholds}
            storageKind={storageKind}
          />
        )}
      </section>

      {sensor && (
        <SensorAlertSettings
          sensorId={deviceId}
          value={sensor.alertSettings}
          onChange={(next) => onUpdateAlertSettings(deviceId, next)}
          notificationGroups={notificationGroups}
          notificationGroupId={sensor.notificationGroupId ?? null}
          onNotificationGroupChange={(id) => onUpdateNotificationGroup(deviceId, id)}
        />
      )}

      {sensor && (
        <section className="panel-card sensor-notes-card">
          <div className="panel-card-head">
            <h2>
              <Pencil size={16} className="head-icon" />
              運用メモ
            </h2>
            <div className="panel-card-meta">
              <span>{sensorNoteList.length} 件</span>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => setNoteDialogOpen(true)}
              >
                <Plus size={14} />
                <span>メモを追加</span>
              </button>
            </div>
          </div>

          {sensorNoteList.length === 0 ? (
            <p className="muted in-panel">
              このセンサーに関する運用メモはまだありません。設置・移動・校正・修理対応などを記録しておけます。
            </p>
          ) : (
            <ul className="sensor-note-list">
              {sensorNoteList.map((n) => (
                <li key={n.id} className="sensor-note-item">
                  <header className="sensor-note-head">
                    <span className="sensor-note-category">
                      {SENSOR_NOTE_CATEGORY_LABELS[n.category]}
                    </span>
                    <span className="sensor-note-meta">
                      {n.timestamp.toLocaleString('ja-JP', {
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}{' '}
                      ・ {n.authorName}
                      <span className="muted">（{formatRelativeAgo(n.timestamp)}）</span>
                    </span>
                    {n.approval && (
                      <span className="badge badge-online">
                        <ShieldCheck size={11} strokeWidth={2.2} />
                        承認済（{n.approval.approvedByName}）
                      </span>
                    )}
                    <button
                      type="button"
                      className="icon-btn icon-btn-danger"
                      aria-label="削除"
                      onClick={() => {
                        if (confirm('この運用メモを削除しますか？')) {
                          onDeleteSensorNote(n.id)
                        }
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </header>
                  <p className="sensor-note-body">{n.body}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {sensor && (
        <SensorNoteDialog
          open={noteDialogOpen}
          sensor={sensor}
          session={session}
          onClose={() => setNoteDialogOpen(false)}
          onSubmit={(note) => {
            onCreateSensorNote(note)
            setNoteDialogOpen(false)
          }}
        />
      )}

      <footer className="detail-foot">
        <div className="muted period-foot">
          全期間: {readings[0] ? fmtDate(readings[0].measuredAt) : '-'} 〜{' '}
          {readings[readings.length - 1]
            ? fmtDate(readings[readings.length - 1].measuredAt)
            : '-'}
        </div>
      </footer>
    </div>
  )
}

/** 履歴の一覧表示（最大 200 件まで） */
function HistoryList({
  readings,
  thresholds,
  storageKind,
}: {
  readings: { measuredAt: Date; temperature: number; humidity: number; battery?: number }[]
  thresholds: ReportThresholds
  storageKind: StorageKind
}) {
  const truncated = readings.length > 200
  const view = truncated ? readings.slice(-200).reverse() : [...readings].reverse()

  if (readings.length === 0) {
    return <p className="muted in-panel">この期間のデータがありません。</p>
  }

  return (
    <div className="recent-table-wrap">
      <table className="recent-table">
        <thead>
          <tr>
            <th>計測日時</th>
            <th className="num">温度</th>
            <th className="num">湿度</th>
            <th className="num">バッテリー</th>
          </tr>
        </thead>
        <tbody>
          {view.map((r, i) => {
            const tDev = cellIsDeviation(r.temperature, 'temperature', thresholds, storageKind)
            const hDev = cellIsDeviation(r.humidity, 'humidity', thresholds, storageKind)
            return (
              <tr key={`${r.measuredAt.getTime()}-${i}`}>
                <td>{fmtTime(r.measuredAt)}</td>
                <td className={`num ${tDev ? 'cell-deviation' : ''}`}>
                  {r.temperature.toFixed(1)} ℃
                </td>
                <td className={`num ${hDev ? 'cell-deviation' : ''}`}>
                  {r.humidity.toFixed(1)} %
                </td>
                <td className="num">
                  {r.battery != null ? `${r.battery.toFixed(0)} %` : '-'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {truncated && (
        <p className="muted in-panel" style={{ marginTop: '0.5rem' }}>
          ※ {readings.length.toLocaleString('ja-JP')} 件中、最新 200 件を表示しています。
        </p>
      )}
    </div>
  )
}
