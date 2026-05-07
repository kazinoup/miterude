import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Activity,
  AlertTriangle,
  Thermometer,
  Droplets,
  Download,
  FileBarChart2,
  Wifi,
  WifiOff,
  BatteryFull,
  BatteryMedium,
  BatteryLow,
  BatteryWarning,
  Info,
  Router as RouterIcon,
  CalendarDays,
  Rows3,
  LineChart as LineChartIcon,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
  Wrench,
  ShieldCheck,
  Sliders,
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
  Sensor,
  SensorCategoryStore,
  SensorGroupStore,
  SensorNote,
  SensorNoteStore,
  SensorStore,
  SensorThresholds,
  TempHumidityThresholds,
  ThresholdTemplateStore,
  UserSession,
  YearMonth,
} from '../../types'
import { SENSOR_NOTE_CATEGORY_LABELS } from '../../types'
import { normalizeTag } from '../../lib/groups'
import { CATEGORY_ICON_COMPONENTS } from '../../lib/categories'
import {
  cellIsDeviation,
  getThresholdForMetric,
  isMetricDeviationEnabled,
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
import { SensorThresholdSettings } from '../SensorThresholdSettings'
import { notesForSensor } from '../../lib/records'
import { toast } from '../../lib/toast'
import { formatRelativeAgo, formatThresholdRange } from '../../lib/jp'

type Props = {
  deviceId: string
  devices: DeviceStore
  sensors: SensorStore
  gateways: GatewayStore
  notificationGroups: NotificationGroupStore
  sensorNotes: SensorNoteStore
  session: UserSession
  groups: SensorGroupStore
  categories: SensorCategoryStore
  thresholdTemplates: ThresholdTemplateStore
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
  onUpdateSensorThresholds: (
    sensorId: string,
    thresholds: SensorThresholds | undefined,
  ) => void
  onUpdateSensorInfo: (
    sensorId: string,
    patch: Partial<Pick<
      Sensor,
      'name' | 'deviceNumber' | 'serialNumber' | 'model' | 'manufacturer' | 'gatewayId'
    >>,
  ) => void
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

// 区分（StorageKind）ベースのラベルは Phase 9.11 で廃止。
// ユーザー定義のカテゴリ（CategoryBadge）に置き換わっている。

/* ---------- タブ ---------- */
type DetailTab = 'basic' | 'history' | 'maintenance'

const TAB_DEFS: { key: DetailTab; label: string; icon: React.ReactNode }[] = [
  { key: 'basic', label: '基本情報', icon: <Info size={14} /> },
  { key: 'history', label: '履歴', icon: <CalendarDays size={14} /> },
  { key: 'maintenance', label: 'メンテナンス・運用メモ', icon: <Wrench size={14} /> },
]

/* ---------- CSV エクスポート ---------- */
/** 履歴データを CSV 文字列に変換する。Excel が日本語を正しく読めるよう BOM を付与。 */
function buildHistoryCsv(
  deviceId: string,
  readings: { measuredAt: Date; temperature: number; humidity: number; battery?: number }[],
  thresholds: SensorThresholds | undefined,
): string {
  const header = [
    '計測日時',
    '温度(℃)',
    '湿度(%)',
    'バッテリー(%)',
    '温度判定',
    '湿度判定',
  ].join(',')
  const tempT = getThresholdForMetric(thresholds, 'temperature')
  const humT = getThresholdForMetric(thresholds, 'humidity')

  function classify(v: number, m: typeof tempT): string {
    if (!m) return ''
    const alertActive = m.alert.enabled && (m.alert.min != null || m.alert.max != null)
    const warnActive = m.warn.enabled && (m.warn.min != null || m.warn.max != null)
    if (!alertActive && !warnActive) return ''
    if (alertActive) {
      if (m.alert.min != null && v < m.alert.min) return '危険'
      if (m.alert.max != null && v > m.alert.max) return '危険'
    }
    if (warnActive) {
      if (m.warn.min != null && v < m.warn.min) return '注意'
      if (m.warn.max != null && v > m.warn.max) return '注意'
    }
    return '正常'
  }

  const rows = readings.map((r) => {
    const ts = r.measuredAt.toLocaleString('sv-SE').replace('T', ' ')
    const t = r.temperature.toFixed(1)
    const h = r.humidity.toFixed(1)
    const b = r.battery != null ? r.battery.toFixed(0) : ''
    const tJ = classify(r.temperature, tempT)
    const hJ = classify(r.humidity, humT)
    return [ts, t, h, b, tJ, hJ].join(',')
  })

  // ﻿ (BOM) を付与して Excel で文字化けしないように
  return '﻿' + [`# ${deviceId}`, header, ...rows].join('\n')
}

/** Blob を生成してブラウザにダウンロードさせる */
function downloadCsv(filename: string, csvContent: string): void {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function SensorDetailView({
  deviceId,
  devices,
  sensors,
  gateways,
  notificationGroups,
  sensorNotes,
  session,
  groups,
  categories,
  thresholdTemplates,
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
  onUpdateSensorThresholds,
  onUpdateSensorInfo,
}: Props) {
  const [activeTab, setActiveTab] = useState<DetailTab>('basic')
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

  // Phase 9.11: 閾値はセンサー個別に持つようになった
  const sensorThresholds: SensorThresholds | undefined = sensor?.thresholds

  const tempSum = useMemo(
    () => summarizeRange(readings, range, 'temperature', sensorThresholds),
    [readings, range, sensorThresholds],
  )
  const humSum = useMemo(
    () => summarizeRange(readings, range, 'humidity', sensorThresholds),
    [readings, range, sensorThresholds],
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

  const tempT = getThresholdForMetric(sensorThresholds, 'temperature')
  const humT = getThresholdForMetric(sensorThresholds, 'humidity')
  const useT = isMetricDeviationEnabled(sensorThresholds, 'temperature')
  const useH = isMetricDeviationEnabled(sensorThresholds, 'humidity')

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
        <span className="bc-current">{sensor?.name || deviceId}</span>
      </div>

      <header className="view-header">
        <div className="view-header-text">
          <h1 className="device-title">
            <span className="device-title-id">{sensor?.name || deviceId}</span>
            {sensor && <span className="device-devnum">{sensor.deviceNumber}</span>}
          </h1>
          <p>{readings.length.toLocaleString('ja-JP')} 件の計測データ</p>
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
                  {sensors[id]?.name || id}
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

      {/* タブ切り替え */}
      <nav className="detail-tabs" role="tablist" aria-label="センサー詳細タブ">
        {TAB_DEFS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={activeTab === t.key}
            className={`detail-tab ${activeTab === t.key ? 'is-active' : ''}`}
            onClick={() => setActiveTab(t.key)}
          >
            <span className="detail-tab-icon">{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </nav>

      {activeTab === 'basic' && sensor && (
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
              <span className="muted panel-card-meta-note">変更は自動保存</span>
            </div>
          </div>

          {/* 2 行構成: 1 行目=識別 (名前・デバイス番号・シリアル番号)、
             2 行目=機器情報 (モデル・メーカー・ゲートウェイ)。最終受信は読み取り専用で別行。 */}
          <div className="meta-edit-grid">
            <label className="meta-edit-field meta-edit-field-name">
              <span className="meta-edit-label">センサー名</span>
              <input
                type="text"
                className="form-input"
                value={sensor.name ?? sensor.id}
                onChange={(e) => {
                  const v = e.target.value
                  // 空欄や id と同じなら name を未設定に戻す
                  const name =
                    v.trim() === '' || v === sensor.id ? undefined : v
                  onUpdateSensorInfo(deviceId, { name })
                }}
                placeholder={sensor.id}
              />
            </label>
            <label className="meta-edit-field">
              <span className="meta-edit-label">デバイス番号</span>
              <input
                type="text"
                className="form-input cell-mono"
                value={sensor.deviceNumber}
                onChange={(e) =>
                  onUpdateSensorInfo(deviceId, { deviceNumber: e.target.value })
                }
              />
            </label>
            <label className="meta-edit-field">
              <span className="meta-edit-label">シリアル番号</span>
              <input
                type="text"
                className="form-input cell-mono"
                value={sensor.serialNumber}
                onChange={(e) =>
                  onUpdateSensorInfo(deviceId, { serialNumber: e.target.value })
                }
              />
            </label>

            <label className="meta-edit-field">
              <span className="meta-edit-label">モデル</span>
              <input
                type="text"
                className="form-input"
                value={sensor.model}
                onChange={(e) =>
                  onUpdateSensorInfo(deviceId, { model: e.target.value })
                }
              />
            </label>
            <label className="meta-edit-field">
              <span className="meta-edit-label">メーカー</span>
              <input
                type="text"
                className="form-input"
                value={sensor.manufacturer}
                onChange={(e) =>
                  onUpdateSensorInfo(deviceId, { manufacturer: e.target.value })
                }
              />
            </label>
            <div className="meta-edit-field">
              <span className="meta-edit-label">接続ゲートウェイ</span>
              <div className="meta-edit-gateway">
                <select
                  className="select"
                  value={sensor.gatewayId}
                  onChange={(e) =>
                    onUpdateSensorInfo(deviceId, { gatewayId: e.target.value })
                  }
                >
                  {Object.values(gateways)
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}（{g.id}）
                      </option>
                    ))}
                </select>
                {gateway && (
                  <button
                    type="button"
                    className="link-btn meta-edit-gateway-link"
                    onClick={() => onOpenGateway(gateway.id)}
                    title="このゲートウェイの詳細を開く"
                  >
                    <RouterIcon size={13} />
                    <span>詳細</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* 読み取り専用情報（システムが管理する値） */}
          <div className="meta-readonly-row">
            <span className="meta-readonly-label">最終受信</span>
            <span className="meta-readonly-value mono">
              {fmtDateTime(sensor.lastSeenAt)}
            </span>
          </div>
        </section>
      )}

      {activeTab === 'basic' && sensor && (
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
          <div className="classify-row classify-row-3col">
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

      {/* 基本情報タブ: 逸脱判定（センサー固有の閾値） */}
      {activeTab === 'basic' && sensor && (
        <section className="panel-card">
          <div className="panel-card-head">
            <h2>
              <Sliders size={16} className="head-icon" />
              逸脱判定（閾値）
            </h2>
            <span className="panel-card-meta muted">
              このセンサー個別の上下限。レポートやダッシュボードの逸脱判定はこの値を基準に行われます。
            </span>
          </div>
          <SensorThresholdSettings
            sensor={sensor}
            templates={thresholdTemplates}
            onChange={(next: TempHumidityThresholds | undefined) => {
              onUpdateSensorThresholds(deviceId, next)
            }}
          />
        </section>
      )}

      {activeTab === 'history' && (
      <section className="panel-card history-card">
        <div className="panel-card-head">
          <h2>
            <CalendarDays size={16} className="head-icon" />
            履歴
          </h2>
          <div className="panel-card-meta">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                if (periodReadings.length === 0) {
                  toast('この期間にダウンロードできるデータがありません', 'info')
                  return
                }
                const periodTag =
                  periodType === 'day'
                    ? toDateInputValue(anchor)
                    : periodType === 'week'
                      ? `week-${toDateInputValue(anchor)}`
                      : toMonthInputValue(anchor)
                const filename = `${deviceId}_${periodTag}.csv`
                const csv = buildHistoryCsv(deviceId, periodReadings, sensorThresholds)
                downloadCsv(filename, csv)
                toast(`${filename} をダウンロードしました`, 'success')
              }}
              title="表示中の期間の計測データを CSV でダウンロード"
            >
              <Download size={14} />
              <span>CSV ダウンロード</span>
            </button>
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
              useT && tempT
                ? `基準 ${formatThresholdRange(tempT.alert.min, tempT.alert.max, '℃')}`
                : '逸脱判定なし'
            }
            icon={<Thermometer size={18} strokeWidth={2} />}
          />
          <KpiCard
            label="平均湿度"
            value={humSum.avg != null ? humSum.avg.toFixed(1) : '-'}
            unit="%"
            hint={
              useH && humT
                ? `基準 ${formatThresholdRange(humT.alert.min, humT.alert.max, '%')}`
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
                      {useT && tempT && tempT.alert.enabled && (
                        <>
                          {tempT.alert.min != null && (
                            <ReferenceLine
                              y={tempT.alert.min}
                              stroke="#c00"
                              strokeDasharray="4 4"
                              strokeWidth={1}
                            />
                          )}
                          {tempT.alert.max != null && (
                            <ReferenceLine
                              y={tempT.alert.max}
                              stroke="#c00"
                              strokeDasharray="4 4"
                              strokeWidth={1}
                            />
                          )}
                          {tempT.warn.enabled && tempT.warn.min != null && (
                            <ReferenceLine
                              y={tempT.warn.min}
                              stroke="#d97706"
                              strokeDasharray="4 4"
                              strokeWidth={1}
                            />
                          )}
                          {tempT.warn.enabled && tempT.warn.max != null && (
                            <ReferenceLine
                              y={tempT.warn.max}
                              stroke="#d97706"
                              strokeDasharray="4 4"
                              strokeWidth={1}
                            />
                          )}
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
                      {useH && humT && humT.alert.enabled && (
                        <>
                          {humT.alert.min != null && (
                            <ReferenceLine
                              y={humT.alert.min}
                              stroke="#c00"
                              strokeDasharray="4 4"
                              strokeWidth={1}
                            />
                          )}
                          {humT.alert.max != null && (
                            <ReferenceLine
                              y={humT.alert.max}
                              stroke="#c00"
                              strokeDasharray="4 4"
                              strokeWidth={1}
                            />
                          )}
                          {humT.warn.enabled && humT.warn.min != null && (
                            <ReferenceLine
                              y={humT.warn.min}
                              stroke="#d97706"
                              strokeDasharray="4 4"
                              strokeWidth={1}
                            />
                          )}
                          {humT.warn.enabled && humT.warn.max != null && (
                            <ReferenceLine
                              y={humT.warn.max}
                              stroke="#d97706"
                              strokeDasharray="4 4"
                              strokeWidth={1}
                            />
                          )}
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
            thresholds={sensorThresholds}
          />
        )}
      </section>
      )}

      {activeTab === 'basic' && sensor && (
        <SensorAlertSettings
          sensorId={deviceId}
          sensorModel={sensor.model}
          value={sensor.alertSettings}
          onChange={(next) => onUpdateAlertSettings(deviceId, next)}
          notificationGroups={notificationGroups}
          notificationGroupId={sensor.notificationGroupId ?? null}
          onNotificationGroupChange={(id) => onUpdateNotificationGroup(deviceId, id)}
        />
      )}

      {/* メンテナンス・運用メモタブ: 機種固有のメンテナンス操作（プレースホルダー）+ 運用メモ */}
      {activeTab === 'maintenance' && sensor && (
        <section className="panel-card maintenance-card">
          <div className="panel-card-head">
            <h2>
              <Wrench size={16} className="head-icon" />
              メンテナンス操作
            </h2>
            <span className="panel-card-meta muted">
              対応機種: {sensor.manufacturer} / {sensor.model}
            </span>
          </div>
          <p className="muted in-panel">
            機種ごとに利用可能なコマンドが異なります。今後、メーカー連携の拡張に応じて操作項目を追加していきます。
          </p>
          <div className="maintenance-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => toast('再起動コマンドを送信しました（モック動作）', 'success')}
            >
              <RotateCcw size={14} />
              <span>再起動コマンドを送信</span>
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => toast('設定を読み出しました（モック動作）', 'info')}
            >
              <RefreshCw size={14} />
              <span>設定をデバイスから読み出し</span>
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled
              title="メーカー連携の実装後に利用可能"
            >
              <Sliders size={14} />
              <span>設定をデバイスへプッシュ</span>
            </button>
          </div>
        </section>
      )}

      {activeTab === 'maintenance' && sensor && (
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
}: {
  readings: { measuredAt: Date; temperature: number; humidity: number; battery?: number }[]
  thresholds: SensorThresholds | undefined
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
            const tDev = cellIsDeviation(r.temperature, 'temperature', thresholds)
            const hDev = cellIsDeviation(r.humidity, 'humidity', thresholds)
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
