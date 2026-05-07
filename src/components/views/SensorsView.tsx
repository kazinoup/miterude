import { useEffect, useMemo, useState } from 'react'
import {
  ChevronRight,
  Trash2,
  Thermometer,
  Droplets,
  LayoutGrid,
  Rows3,
  Clock,
  BatteryFull,
  BatteryMedium,
  BatteryLow,
  BatteryWarning,
  Wifi,
  WifiOff,
  RotateCcw,
  X,
  Folder,
  Tag,
  Tags,
  Settings2,
  ChevronLeft,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react'
import { toast } from '../../lib/toast'
import type {
  DeviceStore,
  FilterConditions,
  Gateway,
  GatewayStore,
  SavedFilter,
  SavedFilterStore,
  Sensor,
  SensorCategory,
  SensorCategoryStore,
  SensorGroup,
  SensorGroupStore,
  SensorReading,
  SensorStore,
  SensorThresholds,
  ThresholdTemplateStore,
} from '../../types'
import {
  evaluateMetricLevel,
  getThresholdForMetric,
  isMetricDeviationEnabled,
} from '../../lib/report'
import type { ReactNode } from 'react'
import {
  collectAllTags,
  isEmptyConditions,
  sensorMatches,
} from '../../lib/groups'
import { CATEGORY_ICON_COMPONENTS } from '../../lib/categories'
import { formatRelativeAgo } from '../../lib/jp'
import {
  loadColumnOrder,
  loadColumnVisibility,
  loadWideMode,
  saveColumnOrder,
  saveColumnVisibility,
  saveWideMode,
  type SensorColumnKey,
  type SensorColumnVisibility,
} from '../../lib/sensorColumns'
import { SensorFilterPanel } from '../SensorFilterPanel'
import { SaveFilterDialog } from '../SaveFilterDialog'
import { SensorGroupManageDialog } from '../SensorGroupManageDialog'
import { SensorCategoryManageDialog } from '../SensorCategoryManageDialog'
import {
  SensorColumnSettingsDialog,
  type PageSize,
} from '../SensorColumnSettingsDialog'
import { SensorBulkActionsDialog } from '../SensorBulkActionsDialog'
import { ConfirmDialog } from '../ConfirmDialog'

type Props = {
  devices: DeviceStore
  sensors: SensorStore
  gateways: GatewayStore
  groups: SensorGroupStore
  categories: SensorCategoryStore
  savedFilters: SavedFilterStore
  thresholdTemplates: ThresholdTemplateStore
  onOpenSensor: (id: string) => void
  onDeleteSensors: (ids: string[]) => void
  onUpsertGroup: (g: SensorGroup) => void
  onDeleteGroup: (id: string) => void
  onUpsertCategory: (c: SensorCategory) => void
  onDeleteCategory: (id: string) => void
  onUpsertSavedFilter: (f: SavedFilter) => void
  onDeleteSavedFilter: (id: string) => void
  onApplyBulkTags: (ids: string[], tags: string[], remove: boolean) => void
  onApplyBulkGroup: (ids: string[], groupId: string | null) => void
  onApplyBulkCategory: (ids: string[], categoryId: string | null) => void
  onApplyBulkThresholds: (
    ids: string[],
    thresholds: SensorThresholds | undefined,
  ) => void
}

type SensorRow = {
  sensor: Sensor
  count: number
  first?: Date
  last?: Date
  monthCount: number
  lastTemp?: number
  lastHum?: number
  gateway?: Gateway
}

type SortKey = 'name' | 'updated' | 'battery'
type ViewMode = 'table' | 'tile'

const PAGE_SIZE_STORAGE_KEY = 'miterude:sensors:pageSize:v1'
const VALID_PAGE_SIZES: PageSize[] = [25, 50, 100, 200]
const DEFAULT_PAGE_SIZE: PageSize = 100

function loadPageSize(): PageSize {
  try {
    const raw = localStorage.getItem(PAGE_SIZE_STORAGE_KEY)
    if (!raw) return DEFAULT_PAGE_SIZE
    const n = Number(raw)
    if (VALID_PAGE_SIZES.includes(n as PageSize)) return n as PageSize
  } catch {
    /* noop */
  }
  return DEFAULT_PAGE_SIZE
}

function savePageSize(n: PageSize): void {
  try {
    localStorage.setItem(PAGE_SIZE_STORAGE_KEY, String(n))
  } catch {
    /* noop */
  }
}

function buildRow(
  sensor: Sensor,
  readings: SensorReading[],
  gateways: GatewayStore,
): SensorRow {
  if (readings.length === 0) {
    return {
      sensor,
      count: 0,
      monthCount: 0,
      gateway: gateways[sensor.gatewayId],
    }
  }
  const first = readings[0].measuredAt
  const last = readings[readings.length - 1].measuredAt
  const lastReading = readings[readings.length - 1]
  return {
    sensor,
    count: readings.length,
    first,
    last,
    monthCount: 0, // 不要になったが互換のため残置
    lastTemp: lastReading?.temperature,
    lastHum: lastReading?.humidity,
    gateway: gateways[sensor.gatewayId],
  }
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

/** 最新値セル: 温湿度センサーなら "25.0℃ 50%"（逸脱は色分け）、
 *  値がない場合は "—" を返す。
 */
function LatestValueCell({
  row,
}: {
  row: SensorRow
}) {
  const { lastTemp, lastHum, sensor } = row
  const hasTemp = lastTemp != null
  const hasHum = lastHum != null
  if (!hasTemp && !hasHum) {
    return <span className="muted">—</span>
  }
  const tLevel = evaluateMetricLevel(lastTemp ?? null, 'temperature', sensor.thresholds)
  const hLevel = evaluateMetricLevel(lastHum ?? null, 'humidity', sensor.thresholds)
  return (
    <span className="latest-values">
      {hasTemp && (
        <span className={`latest-value ${levelClass(tLevel)}`}>
          {lastTemp!.toFixed(1)}℃
        </span>
      )}
      {hasHum && (
        <span className={`latest-value ${levelClass(hLevel)}`}>
          {lastHum!.toFixed(1)}%
        </span>
      )}
    </span>
  )
}

/** 逸脱レベル → CSS クラス */
function levelClass(level: ReturnType<typeof evaluateMetricLevel>): string {
  if (level === 'alert') return 'cell-deviation'
  if (level === 'warn') return 'cell-warning'
  return ''
}

/** 閾値セル: そのセンサー個別の閾値（温度・湿度）の危険レベルを表示する。
 *  「温度のみ」「湿度のみ」逸脱判定がオフの場合は "—" を該当箇所に出す。 */
function ThresholdCell({ sensor }: { sensor: Sensor }) {
  const useT = isMetricDeviationEnabled(sensor.thresholds, 'temperature')
  const useH = isMetricDeviationEnabled(sensor.thresholds, 'humidity')
  if (!useT && !useH) {
    return <span className="muted">未設定</span>
  }
  const tempT = getThresholdForMetric(sensor.thresholds, 'temperature')
  const humT = getThresholdForMetric(sensor.thresholds, 'humidity')
  return (
    <span className="threshold-cell">
      {useT && tempT ? (
        <span className="threshold-part">
          {formatThresholdShort(tempT.alert.min, tempT.alert.max, '℃')}
        </span>
      ) : (
        <span className="threshold-part muted">—℃</span>
      )}
      <span className="threshold-sep">/</span>
      {useH && humT ? (
        <span className="threshold-part">
          {formatThresholdShort(humT.alert.min, humT.alert.max, '%')}
        </span>
      ) : (
        <span className="threshold-part muted">—%</span>
      )}
    </span>
  )
}

/** セル表示用の短縮形（小数点なし）: "0〜10℃" / "0℃〜" / "〜10℃" */
function formatThresholdShort(
  min: number | undefined,
  max: number | undefined,
  unit: string,
): string {
  if (min != null && max != null) return `${min.toFixed(0)}〜${max.toFixed(0)}${unit}`
  if (min != null) return `${min.toFixed(0)}${unit}〜`
  if (max != null) return `〜${max.toFixed(0)}${unit}`
  return '—'
}

/* ---------- 列レンダリング（Phase 9.13: 並び替えに対応） ----------
 *  各列の <th> ラベルと <td> セルを 1 箇所に集約。
 *  SensorsView 本体では columnOrder 配列を順番に回しながら描画する。
 */
const COLUMN_LABEL: Record<SensorColumnKey, string> = {
  deviceNumber: 'デバイス番号',
  serialNumber: 'シリアル番号',
  model: 'モデル',
  manufacturer: 'メーカー',
  category: '区分',
  group: 'グループ',
  gateway: 'ゲートウェイ',
  tags: 'タグ',
  status: '状態',
  battery: 'バッテリー',
  lastUpdated: '最終更新',
  latestValue: '最新値',
  threshold: '閾値',
}

/** ヘッダ <th> に当てる class（数値系の列は num を含む） */
const COLUMN_HEAD_CLASS: Record<SensorColumnKey, string> = {
  deviceNumber: 'col-deviceNumber',
  serialNumber: 'col-serialNumber',
  model: 'col-model',
  manufacturer: 'col-manufacturer',
  category: 'col-category',
  group: 'col-group',
  gateway: 'col-gateway',
  tags: 'col-tags',
  status: 'col-status',
  battery: 'num col-battery',
  lastUpdated: 'col-lastUpdated',
  latestValue: 'num col-latestValue',
  threshold: 'col-threshold',
}

/** 1 行 × 1 列の <td> を描画する */
function renderCell(
  key: SensorColumnKey,
  r: SensorRow,
  groups: Record<string, SensorGroup>,
  categories: Record<string, SensorCategory>,
): ReactNode {
  const sensor = r.sensor
  switch (key) {
    case 'deviceNumber':
      return (
        <td key={key} className="cell-mono col-deviceNumber">
          {sensor.deviceNumber}
        </td>
      )
    case 'serialNumber':
      return (
        <td
          key={key}
          className="cell-mono cell-serial col-serialNumber"
          title={sensor.serialNumber}
        >
          {sensor.serialNumber}
        </td>
      )
    case 'model':
      return (
        <td key={key} className="col-model" title={sensor.model}>
          {sensor.model}
        </td>
      )
    case 'manufacturer':
      return (
        <td key={key} className="col-manufacturer" title={sensor.manufacturer}>
          {sensor.manufacturer}
        </td>
      )
    case 'category': {
      const cat = sensor.categoryId ? categories[sensor.categoryId] : undefined
      return (
        <td key={key} className="col-category">
          <CategoryBadge category={cat} />
        </td>
      )
    }
    case 'group': {
      const grp = sensor.groupId ? groups[sensor.groupId] : undefined
      return (
        <td key={key} className="col-group">
          <GroupBadge group={grp} />
        </td>
      )
    }
    case 'gateway':
      return (
        <td key={key} className="col-gateway" title={r.gateway?.name ?? ''}>
          {r.gateway ? (
            <span className="gateway-cell">{r.gateway.name}</span>
          ) : (
            <span className="muted">—</span>
          )}
        </td>
      )
    case 'tags':
      return (
        <td key={key} className="col-tags">
          <TagPills tags={sensor.tags ?? []} max={3} />
        </td>
      )
    case 'status':
      return (
        <td key={key} className="col-status">
          <OnlineBadge online={sensor.online} />
        </td>
      )
    case 'battery':
      return (
        <td key={key} className="num col-battery">
          <BatteryIndicator pct={sensor.battery} />
        </td>
      )
    case 'lastUpdated': {
      const lastAt = r.last ?? sensor.lastSeenAt
      return (
        <td
          key={key}
          className="updated-cell col-lastUpdated"
          title={fmtDateTime(lastAt)}
        >
          {formatRelativeAgo(lastAt)}
        </td>
      )
    }
    case 'latestValue':
      return (
        <td key={key} className="num col-latestValue">
          <LatestValueCell row={r} />
        </td>
      )
    case 'threshold':
      return (
        <td key={key} className="threshold-col col-threshold">
          <ThresholdCell sensor={sensor} />
        </td>
      )
  }
}

/** 件数表示 + ページ送りボタンのセット。上下のツールバーで共用する。 */
function PaginationControls({
  page,
  totalPages,
  pageSize,
  filteredCount,
  totalCount,
  onSetPage,
}: {
  page: number
  totalPages: number
  pageSize: number
  filteredCount: number
  totalCount: number
  onSetPage: (n: number | ((p: number) => number)) => void
}) {
  const start = filteredCount === 0 ? 0 : (page - 1) * pageSize + 1
  const end = Math.min(page * pageSize, filteredCount)
  const isFiltered = filteredCount !== totalCount
  return (
    <div className="pagination-bar">
      <span className="pagination-info">
        {isFiltered ? (
          <>
            絞り込み <strong>{filteredCount}</strong> 件中、
            <strong>
              {start}〜{end}
            </strong>{' '}
            件を表示（全 {totalCount} 台）
          </>
        ) : (
          <>
            全 <strong>{totalCount}</strong> 件中、
            <strong>
              {start}〜{end}
            </strong>{' '}
            件を表示
          </>
        )}
      </span>
      <div className="pagination-controls">
        <button
          type="button"
          className="icon-btn"
          disabled={page === 1}
          onClick={() => onSetPage(1)}
          aria-label="最初のページ"
        >
          <ChevronsLeft size={16} />
        </button>
        <button
          type="button"
          className="icon-btn"
          disabled={page === 1}
          onClick={() => onSetPage((p) => Math.max(1, p - 1))}
          aria-label="前のページ"
        >
          <ChevronLeft size={16} />
        </button>
        <span className="pagination-current">
          {page} / {totalPages}
        </span>
        <button
          type="button"
          className="icon-btn"
          disabled={page === totalPages}
          onClick={() => onSetPage((p) => Math.min(totalPages, p + 1))}
          aria-label="次のページ"
        >
          <ChevronRight size={16} />
        </button>
        <button
          type="button"
          className="icon-btn"
          disabled={page === totalPages}
          onClick={() => onSetPage(totalPages)}
          aria-label="最後のページ"
        >
          <ChevronsRight size={16} />
        </button>
      </div>
    </div>
  )
}

function CategoryBadge({ category }: { category?: SensorCategory }) {
  if (!category) {
    return (
      <span className="badge badge-outline badge-muted" title="区分が未設定です">
        <Tags size={12} strokeWidth={2.2} />
        未設定
      </span>
    )
  }
  const Icon = CATEGORY_ICON_COMPONENTS[category.icon]
  return (
    <span className="badge badge-outline" title={category.name}>
      <Icon size={12} strokeWidth={2.2} />
      {category.name}
    </span>
  )
}

function BatteryIndicator({ pct }: { pct: number }) {
  let Icon = BatteryFull
  let cls = ''
  if (pct < 15) {
    Icon = BatteryWarning
    cls = 'cell-deviation'
  } else if (pct < 35) {
    Icon = BatteryLow
    cls = 'battery-low'
  } else if (pct < 65) {
    Icon = BatteryMedium
  }
  return (
    <span className={`battery-cell ${cls}`}>
      <Icon size={14} strokeWidth={2} />
      <span>{pct}%</span>
    </span>
  )
}

function OnlineBadge({ online }: { online: boolean }) {
  if (online) {
    return (
      <span className="badge badge-online">
        <Wifi size={11} strokeWidth={2.2} />
        オンライン
      </span>
    )
  }
  return (
    <span className="badge badge-offline">
      <WifiOff size={11} strokeWidth={2.2} />
      オフライン
    </span>
  )
}

function TagPills({ tags, max = 4 }: { tags: string[]; max?: number }) {
  if (!tags || tags.length === 0) {
    return <span className="muted">—</span>
  }
  const visible = tags.slice(0, max)
  const rest = tags.length - visible.length
  return (
    <div className="cell-tag-pills">
      {visible.map((t) => (
        <span key={t} className="cell-tag-pill">
          {t}
        </span>
      ))}
      {rest > 0 && <span className="cell-tag-more">+{rest}</span>}
    </div>
  )
}

function GroupBadge({
  group,
}: {
  group: SensorGroup | undefined
}) {
  if (!group) {
    return <span className="muted">未分類</span>
  }
  return (
    <span className="cell-group-badge">
      <Folder size={11} strokeWidth={2.2} />
      {group.name}
    </span>
  )
}

type TileProps = {
  row: SensorRow
  group?: SensorGroup
  category?: SensorCategory
  onOpen: (id: string) => void
}

function SensorTile({ row, group, category, onOpen }: TileProps) {
  const { sensor } = row
  const tLevel = evaluateMetricLevel(row.lastTemp ?? null, 'temperature', sensor.thresholds)
  const hLevel = evaluateMetricLevel(row.lastHum ?? null, 'humidity', sensor.thresholds)
  const tDev = tLevel === 'alert' || tLevel === 'warn'
  const hDev = hLevel === 'alert' || hLevel === 'warn'

  return (
    <article
      className={`device-tile ${tDev || hDev ? 'has-deviation' : ''}`}
      onClick={() => onOpen(sensor.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen(sensor.id)
        }
      }}
    >
      <header className="tile-header">
        <div className="tile-id-block">
          <span className="tile-id">{sensor.id}</span>
          <span className="tile-devnum">{sensor.deviceNumber}</span>
        </div>
        <CategoryBadge category={category} />
      </header>

      <div className="tile-readings">
        <div className="tile-reading">
          <span className="tile-reading-label">
            <Thermometer size={13} strokeWidth={2.2} />
            温度
          </span>
          <div className={`tile-reading-value ${levelClass(tLevel)}`}>
            <span className="num-big">
              {row.lastTemp != null ? row.lastTemp.toFixed(1) : '-'}
            </span>
            <span className="num-unit">℃</span>
          </div>
        </div>
        <div className="tile-reading">
          <span className="tile-reading-label">
            <Droplets size={13} strokeWidth={2.2} />
            湿度
          </span>
          <div className={`tile-reading-value ${levelClass(hLevel)}`}>
            <span className="num-big">
              {row.lastHum != null ? row.lastHum.toFixed(1) : '-'}
            </span>
            <span className="num-unit">%</span>
          </div>
        </div>
      </div>

      <footer className="tile-footer">
        <div className="tile-foot-row tile-foot-meta">
          <OnlineBadge online={sensor.online} />
          <BatteryIndicator pct={sensor.battery} />
        </div>
        <div className="tile-foot-row tile-foot-meta">
          <GroupBadge group={group} />
          {(sensor.tags ?? []).length > 0 && <TagPills tags={sensor.tags ?? []} max={3} />}
        </div>
        <div className="tile-foot-row" title={fmtDateTime(row.last)}>
          <Clock size={12} strokeWidth={2} />
          <span>{formatRelativeAgo(row.last ?? sensor.lastSeenAt)}</span>
        </div>
      </footer>

    </article>
  )
}

export function SensorsView({
  devices,
  sensors,
  gateways,
  groups,
  categories,
  savedFilters,
  thresholdTemplates,
  onOpenSensor,
  onDeleteSensors,
  onUpsertGroup,
  onDeleteGroup,
  onUpsertCategory,
  onDeleteCategory,
  onUpsertSavedFilter,
  onDeleteSavedFilter,
  onApplyBulkTags,
  onApplyBulkGroup,
  onApplyBulkCategory,
  onApplyBulkThresholds,
}: Props) {
  const sensorList = useMemo(
    () => Object.values(sensors).sort((a, b) => a.id.localeCompare(b.id)),
    [sensors],
  )

  const rows: SensorRow[] = useMemo(
    () => sensorList.map((s) => buildRow(s, devices[s.id] ?? [], gateways)),
    [sensorList, devices, gateways],
  )

  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [viewMode, setViewMode] = useState<ViewMode>('table')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [conditions, setConditions] = useState<FilterConditions>({})
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<PageSize>(() => loadPageSize())
  useEffect(() => {
    savePageSize(pageSize)
  }, [pageSize])
  const [saveDialogOpen, setSaveDialogOpen] = useState(false)
  const [groupDialogOpen, setGroupDialogOpen] = useState(false)
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false)
  const [columnSettingsOpen, setColumnSettingsOpen] = useState(false)
  const [bulkActionOpen, setBulkActionOpen] = useState(false)
  const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = useState(false)

  // 列の表示／非表示 — localStorage に永続化
  const [columnVisibility, setColumnVisibility] = useState<SensorColumnVisibility>(
    () => loadColumnVisibility(),
  )
  useEffect(() => {
    saveColumnVisibility(columnVisibility)
  }, [columnVisibility])
  const vis = columnVisibility

  // 列の並び順 — localStorage に永続化（Phase 9.13）
  const [columnOrder, setColumnOrder] = useState<SensorColumnKey[]>(
    () => loadColumnOrder(),
  )
  useEffect(() => {
    saveColumnOrder(columnOrder)
  }, [columnOrder])

  // Phase B: ワイド表示モード
  const [wideMode, setWideMode] = useState<boolean>(() => loadWideMode())
  useEffect(() => {
    saveWideMode(wideMode)
  }, [wideMode])
  // SensorsView がマウントされている間だけ app-content-inner にクラスを付与
  useEffect(() => {
    const el = document.querySelector('.app-content-inner')
    if (!el) return
    if (wideMode) el.classList.add('is-wide')
    else el.classList.remove('is-wide')
    return () => {
      el.classList.remove('is-wide')
    }
  }, [wideMode])

  // フィルタ適用（区分は sensor.categoryId として groups.ts 側で判定）
  const filteredRows = useMemo(() => {
    if (isEmptyConditions(conditions)) return rows
    return rows.filter((r) => sensorMatches(r.sensor, conditions))
  }, [rows, conditions])

  const sortedRows = useMemo(() => {
    const out = [...filteredRows]
    if (sortKey === 'updated') {
      out.sort((a, b) => {
        const at = a.last?.getTime() ?? 0
        const bt = b.last?.getTime() ?? 0
        if (bt !== at) return bt - at
        return a.sensor.id.localeCompare(b.sensor.id)
      })
    } else if (sortKey === 'battery') {
      out.sort((a, b) => {
        if (a.sensor.battery !== b.sensor.battery) return a.sensor.battery - b.sensor.battery
        return a.sensor.id.localeCompare(b.sensor.id)
      })
    } else {
      out.sort((a, b) => a.sensor.id.localeCompare(b.sensor.id))
    }
    return out
  }, [filteredRows, sortKey])

  // ページネーション
  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize))
  useEffect(() => {
    if (page > totalPages) setPage(totalPages)
    if (page < 1) setPage(1)
  }, [page, totalPages])

  // フィルタが変わったら 1 ページ目に戻す
  useEffect(() => {
    setPage(1)
  }, [conditions, pageSize])

  const pagedRows = useMemo(() => {
    const start = (page - 1) * pageSize
    return sortedRows.slice(start, start + pageSize)
  }, [sortedRows, page, pageSize])

  // 選択ロジック（フィルタ後の母集合に対して）
  const visibleIds = useMemo(() => sortedRows.map((r) => r.sensor.id), [sortedRows])
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selected.has(id))
  const someVisibleSelected = !allVisibleSelected && visibleIds.some((id) => selected.has(id))

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAllVisible() {
    setSelected((prev) => {
      if (allVisibleSelected) {
        const next = new Set(prev)
        for (const id of visibleIds) next.delete(id)
        return next
      }
      const next = new Set(prev)
      for (const id of visibleIds) next.add(id)
      return next
    })
  }

  function clearSelection() {
    setSelected(new Set())
  }

  function bulkRestart() {
    const ids = Array.from(selected)
    if (ids.length === 0) return
    toast(`${ids.length} 台のセンサーに再起動コマンドを送信しました`, 'success')
    clearSelection()
  }

  function bulkDelete() {
    const ids = Array.from(selected)
    if (ids.length === 0) return
    setBulkDeleteConfirmOpen(true)
  }

  function confirmBulkDelete() {
    const ids = Array.from(selected)
    if (ids.length === 0) {
      setBulkDeleteConfirmOpen(false)
      return
    }
    onDeleteSensors(ids)
    toast(`${ids.length} 台のセンサーを削除しました`, 'info')
    clearSelection()
    setBulkDeleteConfirmOpen(false)
  }

  // 保存フィルタを適用
  function applySavedFilter(f: SavedFilter) {
    setConditions(f.conditions)
    toast(`保存フィルタ「${f.name}」を適用しました`, 'info')
  }

  // 一括操作（タグ/グループ）
  function handleBulkAction(
    action:
      | { kind: 'tag-add'; tags: string[] }
      | { kind: 'tag-remove'; tags: string[] }
      | { kind: 'group-set'; groupId: string | null }
      | { kind: 'category-set'; categoryId: string | null }
      | { kind: 'threshold-set'; thresholds: SensorThresholds | undefined },
  ) {
    const ids = Array.from(selected)
    if (ids.length === 0) return
    if (action.kind === 'tag-add') {
      onApplyBulkTags(ids, action.tags, false)
      toast(`${ids.length} 台にタグを付与しました`, 'success')
    } else if (action.kind === 'tag-remove') {
      onApplyBulkTags(ids, action.tags, true)
      toast(`${ids.length} 台からタグを削除しました`, 'info')
    } else if (action.kind === 'group-set') {
      onApplyBulkGroup(ids, action.groupId)
      const groupName = action.groupId
        ? groups[action.groupId]?.name ?? '（不明）'
        : '未分類'
      toast(`${ids.length} 台を「${groupName}」に移動しました`, 'success')
    } else if (action.kind === 'category-set') {
      onApplyBulkCategory(ids, action.categoryId)
      const catName = action.categoryId
        ? categories[action.categoryId]?.name ?? '（不明）'
        : '未設定'
      toast(`${ids.length} 台の区分を「${catName}」に変更しました`, 'success')
    } else {
      // threshold-set
      onApplyBulkThresholds(ids, action.thresholds)
      // App.tsx 側で種別不一致は弾くが、ここでは「適用しました」を出す
      toast(
        action.thresholds
          ? `${ids.length} 台に閾値を適用しました（種別が一致するセンサーのみ）`
          : `${ids.length} 台の閾値をクリアしました`,
        'success',
      )
    }
    setBulkActionOpen(false)
  }

  const allTagsList = useMemo(() => collectAllTags(sensors).map((t) => t.tag), [sensors])

  if (sensorList.length === 0) {
    return (
      <div className="dashboard-view">
        <header className="view-header">
          <div className="view-header-text">
            <h1>センサー</h1>
            <p>登録されているセンサーがありません。</p>
          </div>
        </header>
        <div className="panel-card">
          <p className="muted in-panel">
            左下のインポートアイコンから CSV を取り込むと、ここにセンサー一覧が表示されます。
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="dashboard-view">
      <header className="view-header">
        <div className="view-header-text">
          <h1>センサー</h1>
          <p>登録されているセンサー（IoT デバイス）を一覧で確認します。</p>
        </div>
        <div className="view-header-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setCategoryDialogOpen(true)}
          >
            <Tags size={14} />
            <span>区分管理</span>
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setGroupDialogOpen(true)}
          >
            <Folder size={14} />
            <span>グループ管理</span>
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setColumnSettingsOpen(true)}
            title="一覧に表示する列を選択"
          >
            <Settings2 size={14} />
            <span>表示設定</span>
          </button>
        </div>
      </header>

      <SensorFilterPanel
        sensors={sensors}
        groups={groups}
        savedFilters={savedFilters}
        conditions={conditions}
        onChange={setConditions}
        onSaveAsFilter={() => setSaveDialogOpen(true)}
        onApplySavedFilter={applySavedFilter}
        onDeleteSavedFilter={onDeleteSavedFilter}
        categories={categories}
        gateways={gateways}
      />

      <section className="panel-card">
        {selected.size > 0 && (
          <div className="bulk-bar">
            <div className="bulk-bar-info">
              <strong>{selected.size}</strong> 件選択中
              <button type="button" className="link-btn" onClick={clearSelection}>
                <X size={12} />
                <span>解除</span>
              </button>
            </div>
            <div className="bulk-bar-actions-primary">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setBulkActionOpen(true)}
              >
                <Tag size={14} />
                <span>タグ／グループ</span>
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={bulkRestart}
              >
                <RotateCcw size={14} />
                <span>再起動</span>
              </button>
            </div>
            <div className="bulk-bar-actions-danger">
              <button
                type="button"
                className="btn btn-secondary btn-sm bulk-danger"
                onClick={bulkDelete}
              >
                <Trash2 size={14} />
                <span>削除</span>
              </button>
            </div>
          </div>
        )}

        {/* 上段ツールバー: 並び順 / 表示モード（左） + ページネーション（右） */}
        <div className="list-toolbar list-toolbar-top">
          <div className="list-toolbar-left">
            <label className="sort-control">
              <span className="sort-label">並び順</span>
              <select
                className="select select-sm"
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value as SortKey)}
              >
                <option value="name">名前（昇順）</option>
                <option value="updated">最終更新（新しい順）</option>
                <option value="battery">バッテリー残量（少ない順）</option>
              </select>
            </label>
            <div className="view-toggle" role="group" aria-label="表示モード">
              <button
                type="button"
                className={`view-toggle-btn ${viewMode === 'table' ? 'is-active' : ''}`}
                onClick={() => setViewMode('table')}
                aria-pressed={viewMode === 'table'}
              >
                <Rows3 size={15} />
                <span>テーブル</span>
              </button>
              <button
                type="button"
                className={`view-toggle-btn ${viewMode === 'tile' ? 'is-active' : ''}`}
                onClick={() => setViewMode('tile')}
                aria-pressed={viewMode === 'tile'}
              >
                <LayoutGrid size={15} />
                <span>タイル</span>
              </button>
            </div>
          </div>
          <PaginationControls
            page={page}
            totalPages={totalPages}
            pageSize={pageSize}
            filteredCount={sortedRows.length}
            totalCount={sensorList.length}
            onSetPage={setPage}
          />
        </div>

        {viewMode === 'table' ? (
          <div className="device-table-wrap">
            <table className="device-table">
              <thead>
                <tr>
                  <th className="check-cell col-check">
                    <input
                      type="checkbox"
                      aria-label="表示中をすべて選択"
                      checked={allVisibleSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = someVisibleSelected
                      }}
                      onChange={toggleAllVisible}
                    />
                  </th>
                  <th className="col-name">名前</th>
                  {columnOrder
                    .filter((k) => vis[k])
                    .map((k) => (
                      <th key={k} className={COLUMN_HEAD_CLASS[k]}>
                        {COLUMN_LABEL[k]}
                      </th>
                    ))}
                  <th aria-label="操作" className="col-action"></th>
                </tr>
              </thead>
              <tbody>
                {pagedRows.map((r) => {
                  const isChecked = selected.has(r.sensor.id)
                  return (
                    <tr
                      key={r.sensor.id}
                      className={`device-row ${isChecked ? 'is-selected' : ''}`}
                      onClick={() => onOpenSensor(r.sensor.id)}
                    >
                      <td
                        className="check-cell col-check"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          aria-label={`${r.sensor.id} を選択`}
                          checked={isChecked}
                          onChange={() => toggleSelected(r.sensor.id)}
                        />
                      </td>
                      <td className="col-name" title={r.sensor.name ?? r.sensor.id}>
                        <span className="device-id-name">
                          {r.sensor.name ?? r.sensor.id}
                        </span>
                      </td>
                      {columnOrder
                        .filter((k) => vis[k])
                        .map((k) => renderCell(k, r, groups, categories))}
                      <td
                        className="row-actions col-action"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          className="icon-btn"
                          aria-label={`${r.sensor.id} を開く`}
                          onClick={() => onOpenSensor(r.sensor.id)}
                        >
                          <ChevronRight size={18} />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="device-tile-grid">
            {pagedRows.map((r) => (
              <SensorTile
                key={r.sensor.id}
                row={r}
                group={r.sensor.groupId ? groups[r.sensor.groupId] : undefined}
                category={
                  r.sensor.categoryId ? categories[r.sensor.categoryId] : undefined
                }
                onOpen={onOpenSensor}
              />
            ))}
          </div>
        )}

        {/* 下段ツールバー: ページネーションのみ（件数は内部に集約） */}
        {sortedRows.length > 0 && (
          <div className="list-toolbar list-toolbar-bottom">
            <PaginationControls
              page={page}
              totalPages={totalPages}
              pageSize={pageSize}
              filteredCount={sortedRows.length}
              totalCount={sensorList.length}
              onSetPage={setPage}
            />
          </div>
        )}
      </section>

      <SaveFilterDialog
        open={saveDialogOpen}
        conditions={conditions}
        onClose={() => setSaveDialogOpen(false)}
        onSubmit={(f) => {
          onUpsertSavedFilter(f)
          setSaveDialogOpen(false)
          toast(`保存フィルタ「${f.name}」を作成しました`, 'success')
        }}
      />

      <SensorGroupManageDialog
        open={groupDialogOpen}
        groups={groups}
        sensors={sensors}
        onClose={() => setGroupDialogOpen(false)}
        onUpsert={onUpsertGroup}
        onDelete={onDeleteGroup}
      />

      <SensorCategoryManageDialog
        open={categoryDialogOpen}
        categories={categories}
        sensors={sensors}
        onClose={() => setCategoryDialogOpen(false)}
        onUpsert={onUpsertCategory}
        onDelete={onDeleteCategory}
      />

      <SensorBulkActionsDialog
        open={bulkActionOpen}
        selectedCount={selected.size}
        groups={groups}
        categories={categories}
        thresholdTemplates={thresholdTemplates}
        existingTags={allTagsList}
        onClose={() => setBulkActionOpen(false)}
        onApply={handleBulkAction}
      />

      <SensorColumnSettingsDialog
        open={columnSettingsOpen}
        visibility={columnVisibility}
        onChange={setColumnVisibility}
        wideMode={wideMode}
        onWideModeChange={setWideMode}
        pageSize={pageSize}
        onPageSizeChange={setPageSize}
        order={columnOrder}
        onOrderChange={setColumnOrder}
        onClose={() => setColumnSettingsOpen(false)}
      />

      <ConfirmDialog
        open={bulkDeleteConfirmOpen}
        title="センサーを削除"
        message={
          <>
            <strong>{selected.size}</strong> 台のセンサーを削除します。
            <br />
            この操作は元に戻せません。よろしいですか？
          </>
        }
        confirmLabel="削除する"
        cancelLabel="キャンセル"
        variant="danger"
        onConfirm={confirmBulkDelete}
        onCancel={() => setBulkDeleteConfirmOpen(false)}
      />
    </div>
  )
}
