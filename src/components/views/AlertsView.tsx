/**
 * アラートログ一覧画面 — Phase B / Phase 10 + 改訂
 *
 * 絞り込みフィルタ（センサー画面と同じ FilterConditions ベース）+ 期間 + 種別。
 *
 * フィルタはすべて AND で評価される:
 *   - そのエントリに紐付くセンサー / ゲートウェイが FilterConditions にマッチ
 *   - occurredAt が期間範囲内
 *   - kind が選択された種別に含まれる
 *
 * 「対象デバイス」を絞り込みたい場合は、下段の絞り込みパネル（センサー名／番号
 * 検索 + 区分 / 状態 / グループ / タグ）で対応する。
 */
import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  AlertOctagon,
  WifiOff,
  Battery,
  Cpu,
  Filter as FilterIcon,
  Router as RouterIcon,
  Settings2,
} from 'lucide-react'
import { PaginationControls } from '../PaginationControls'
import type {
  AlertLogEntry,
  AlertLogKind,
  AlertLogStore,
  FilterConditions,
  GatewayStore,
  SavedFilterStore,
  SensorCategoryStore,
  SensorGroupStore,
  SensorStore,
} from '../../types'
import { ALERT_LOG_KIND_LABELS } from '../../types'
import { fromDateInputValue } from '../../lib/period'
import { isEmptyConditions, sensorMatches } from '../../lib/groups'
import { SensorFilterPanel } from '../SensorFilterPanel'
import { AlertColumnSettingsDialog } from '../AlertColumnSettingsDialog'
import {
  ALERT_COLUMN_DEFS,
  loadColumnOrder as loadAlertColumnOrder,
  loadColumnVisibility as loadAlertColumnVisibility,
  saveColumnOrder as saveAlertColumnOrder,
  saveColumnVisibility as saveAlertColumnVisibility,
  type AlertColumnKey,
  type AlertColumnVisibility,
} from '../../lib/alertColumns'

type Props = {
  alertLogs: AlertLogStore
  sensors: SensorStore
  gateways: GatewayStore
  /** SensorPicker / SensorFilterPanel に渡すための補助情報 */
  sensorGroups: SensorGroupStore
  sensorCategories: SensorCategoryStore
  savedFilters: SavedFilterStore
}

const PAGE_SIZE = 50

const KIND_ORDER: AlertLogKind[] = [
  'deviation-alert',
  'deviation-warn',
  'offline',
  'battery',
]

function kindIcon(kind: AlertLogKind) {
  switch (kind) {
    case 'deviation-alert':
      return AlertOctagon
    case 'deviation-warn':
      return AlertTriangle
    case 'offline':
      return WifiOff
    case 'battery':
      return Battery
  }
}

function formatDateTime(d: Date): string {
  const dd = d instanceof Date ? d : new Date(d as unknown as string)
  if (Number.isNaN(dd.getTime())) return '—'
  const y = dd.getFullYear()
  const m = String(dd.getMonth() + 1).padStart(2, '0')
  const day = String(dd.getDate()).padStart(2, '0')
  const hh = String(dd.getHours()).padStart(2, '0')
  const mm = String(dd.getMinutes()).padStart(2, '0')
  const ss = String(dd.getSeconds()).padStart(2, '0')
  return `${y}/${m}/${day} ${hh}:${mm}:${ss}`
}

function entryTime(e: AlertLogEntry): number {
  return e.occurredAt instanceof Date
    ? e.occurredAt.getTime()
    : new Date(e.occurredAt as unknown as string).getTime()
}

export function AlertsView({
  alertLogs,
  sensors,
  gateways,
  sensorGroups,
  sensorCategories,
  savedFilters,
}: Props) {
  /** 下段フィルタ（センサー一覧と同じパターン） */
  const [conditions, setConditions] = useState<FilterConditions>({})

  /** 種別フィルタ（チェック ON のものだけ表示）。初期値は全種別 ON。 */
  const [selectedKinds, setSelectedKinds] = useState<Set<AlertLogKind>>(
    () => new Set<AlertLogKind>(KIND_ORDER),
  )

  /** 期間（YYYY-MM-DD 形式の文字列で UI に保持。空なら制限なし） */
  const [fromDate, setFromDate] = useState<string>('')
  const [toDate, setToDate] = useState<string>('')

  /** 1-based の現在ページ。PaginationControls が 1-based を期待するため。 */
  const [page, setPage] = useState(1)

  /** 列の表示・並び順設定 */
  const [columnVisibility, setColumnVisibility] =
    useState<AlertColumnVisibility>(() => loadAlertColumnVisibility())
  useEffect(() => {
    saveAlertColumnVisibility(columnVisibility)
  }, [columnVisibility])
  const [columnOrder, setColumnOrder] = useState<AlertColumnKey[]>(() =>
    loadAlertColumnOrder(),
  )
  useEffect(() => {
    saveAlertColumnOrder(columnOrder)
  }, [columnOrder])
  const [columnSettingsOpen, setColumnSettingsOpen] = useState(false)

  const ALERT_DEFS_MAP = useMemo(
    () => Object.fromEntries(ALERT_COLUMN_DEFS.map((d) => [d.key, d])),
    [],
  )
  const visibleColumns = columnOrder.filter((k) => columnVisibility[k])

  /** 各列に当てる CSS クラス（列幅・nowrap 制御は CSS 側に集約）。 */
  const columnClass: Partial<Record<AlertColumnKey, string>> = {
    kind: 'col-kind',
    deviceName: 'col-device-name',
    deviceNumber: 'col-device-number',
    message: 'col-message',
    confirmComment: 'col-confirm',
    category: 'col-category',
    group: 'col-group',
    tags: 'col-tags',
    manufacturer: 'col-manufacturer',
    model: 'col-model',
  }

  // フィルタ条件が変わったら 1 ページ目に戻す
  useEffect(() => {
    setPage(1)
  }, [conditions, selectedKinds, fromDate, toDate])

  // ワイド表示固定
  useEffect(() => {
    const el = document.querySelector('.app-content-inner')
    if (!el) return
    el.classList.add('is-wide')
    return () => {
      el.classList.remove('is-wide')
    }
  }, [])

  /** 下段フィルタ（センサー側の属性条件）にマッチするセンサー ID 集合。
   *  空条件なら null（すべて通す）。
   *  ゲートウェイ側のエントリは sensorMatches 対象外なので別ロジックで通す。 */
  const conditionMatchedSensorIds = useMemo(() => {
    if (isEmptyConditions(conditions)) return null
    const set = new Set<string>()
    for (const s of Object.values(sensors)) {
      if (sensorMatches(s, conditions)) set.add(s.id)
    }
    return set
  }, [conditions, sensors])

  /** フィルタ後のエントリ（新しい順） */
  const filteredEntries = useMemo(() => {
    const fromTs = fromDate ? fromDateInputValue(fromDate)?.getTime() : null
    const toTs = toDate
      ? (() => {
          const d = fromDateInputValue(toDate)
          if (!d) return null
          d.setDate(d.getDate() + 1)
          return d.getTime()
        })()
      : null

    const all = Object.values(alertLogs)
    return all
      .filter((e) => {
        // 1) センサー属性フィルタ（センサーターゲットのみ。ゲートウェイは
        //    フィルタ条件に該当する属性が無いため、属性フィルタが空でない限り
        //    ゲートウェイエントリは除外する）
        if (conditionMatchedSensorIds) {
          if (e.targetKind === 'sensor') {
            if (!conditionMatchedSensorIds.has(e.targetId)) return false
          } else {
            return false
          }
        }
        // 2) 種別
        if (!selectedKinds.has(e.kind)) return false
        // 3) 期間
        const t = entryTime(e)
        if (fromTs != null && t < fromTs) return false
        if (toTs != null && t >= toTs) return false
        return true
      })
      .sort((a, b) => entryTime(b) - entryTime(a))
  }, [
    alertLogs,
    conditionMatchedSensorIds,
    selectedKinds,
    fromDate,
    toDate,
  ])

  const totalPages = Math.max(1, Math.ceil(filteredEntries.length / PAGE_SIZE))
  const currentPage = Math.min(Math.max(1, page), totalPages)
  const pageEntries = filteredEntries.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  )

  function toggleKind(k: AlertLogKind) {
    setSelectedKinds((prev) => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })
  }

  function clearAllFilters() {
    setConditions({})
    setSelectedKinds(new Set(KIND_ORDER))
    setFromDate('')
    setToDate('')
  }

  const totalCount = Object.keys(alertLogs).length
  const filterActive =
    !isEmptyConditions(conditions) ||
    selectedKinds.size < KIND_ORDER.length ||
    !!fromDate ||
    !!toDate

  return (
    <div className="alerts-view">
      <header className="view-header">
        <div className="view-header-text">
          <h1>
            <AlertTriangle size={20} className="head-icon" />
            アラート
          </h1>
          <p>
            センサー・ゲートウェイで発生したアラートの蓄積ログ。通知のまとめ送信はここから期間でまとめて送られます。
          </p>
        </div>
        <div className="view-header-actions">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setColumnSettingsOpen(true)}
          >
            <Settings2 size={14} />
            <span>表示設定</span>
          </button>
        </div>
      </header>

      {/* ===== 絞り込みフィルタ ===== */}
      <section className="panel-card alerts-filter-card">
        <div className="panel-card-head">
          <h2>
            <FilterIcon size={16} className="head-icon" />
            絞り込み
          </h2>
          <div className="panel-card-meta">
            <span>
              {filteredEntries.length} 件 / 全 {totalCount} 件
            </span>
            {filterActive && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={clearAllFilters}
              >
                条件をクリア
              </button>
            )}
          </div>
        </div>

        {/* センサー画面と同じ FilterConditions ベースのフィルタパネル */}
        <SensorFilterPanel
          sensors={sensors}
          groups={sensorGroups}
          categories={sensorCategories}
          gateways={gateways}
          savedFilters={savedFilters}
          conditions={conditions}
          onChange={setConditions}
          hideGatewayFilter
        />

        {/* 期間 + 種別 — アラートログ専用のフィルタ。
            横並びで表示してスペースを有効活用する。 */}
        <div className="alerts-extra-filters alerts-extra-filters-row">
          <div className="alerts-filter-block alerts-filter-block-period">
            <h3 className="alerts-filter-label">期間</h3>
            <div className="alerts-period-row">
              <input
                type="date"
                className="select"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                aria-label="期間 開始日"
              />
              <span className="muted">〜</span>
              <input
                type="date"
                className="select"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                aria-label="期間 終了日"
              />
            </div>
          </div>

          <div className="alerts-filter-block alerts-filter-block-kinds">
            <h3 className="alerts-filter-label">種別（複数選択可）</h3>
            <div className="alerts-kind-chips">
              {KIND_ORDER.map((k) => {
                const Icon = kindIcon(k)
                const active = selectedKinds.has(k)
                return (
                  <button
                    key={k}
                    type="button"
                    className={`alert-kind-chip alert-kind-chip-${k} ${active ? 'is-active' : ''}`}
                    onClick={() => toggleKind(k)}
                    aria-pressed={active}
                  >
                    <Icon size={12} strokeWidth={2.4} />
                    <span>{ALERT_LOG_KIND_LABELS[k]}</span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </section>

      {/* ===== グリッド（列カスタマイズ対応） ===== */}
      <section className="panel-card alerts-grid-card">
        <div className="alerts-pagination-bar alerts-pagination-bar-top">
          <PaginationControls
            page={currentPage}
            totalPages={totalPages}
            pageSize={PAGE_SIZE}
            filteredCount={filteredEntries.length}
            totalCount={totalCount}
            onSetPage={setPage}
          />
        </div>

        {pageEntries.length === 0 ? (
          <p className="muted in-panel">
            条件に一致するアラートはありません。
          </p>
        ) : (
          <table className="alerts-grid">
            <thead>
              <tr>
                <th className="col-time">発生日時</th>
                {visibleColumns.map((key) => {
                  const def = ALERT_DEFS_MAP[key]
                  if (!def) return null
                  return (
                    <th key={key} className={columnClass[key]}>
                      {def.label}
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {pageEntries.map((e) => {
                const Icon = kindIcon(e.kind)
                const sensor =
                  e.targetKind === 'sensor' ? sensors[e.targetId] : undefined
                const category =
                  sensor?.categoryId
                    ? sensorCategories[sensor.categoryId]
                    : undefined
                const group =
                  sensor?.groupId ? sensorGroups[sensor.groupId] : undefined
                const deviceName =
                  sensors[e.targetId]?.name ??
                  gateways[e.targetId]?.name ??
                  e.targetId
                const deviceNumber =
                  e.sensorNumber ?? e.serialNumber ?? '—'
                const TargetIcon = e.targetKind === 'sensor' ? Cpu : RouterIcon
                const targetTitle =
                  e.targetKind === 'sensor' ? 'センサー' : 'ゲートウェイ'
                return (
                  <tr key={e.id}>
                    <td className="col-time">{formatDateTime(e.occurredAt)}</td>
                    {visibleColumns.map((key) => {
                      const cls = columnClass[key]
                      switch (key) {
                        case 'kind':
                          return (
                            <td key={key} className={cls}>
                              <span className="alert-kind-badge">
                                <Icon size={11} strokeWidth={2.4} />
                                {ALERT_LOG_KIND_LABELS[e.kind]}
                              </span>
                            </td>
                          )
                        case 'deviceName':
                          return (
                            <td key={key} className={cls}>
                              <div className="alerts-target-cell">
                                <span
                                  className="alerts-target-kind-icon"
                                  title={targetTitle}
                                  aria-label={targetTitle}
                                >
                                  <TargetIcon size={12} strokeWidth={2.2} />
                                </span>
                                <span
                                  className="alerts-target-cell-name"
                                  title={deviceName}
                                >
                                  {deviceName}
                                </span>
                              </div>
                            </td>
                          )
                        case 'deviceNumber':
                          return (
                            <td key={key} className={cls}>
                              <span className="mono">{deviceNumber}</span>
                            </td>
                          )
                        case 'message':
                          return (
                            <td key={key} className={cls} title={e.message}>
                              {e.message}
                            </td>
                          )
                        case 'confirmComment':
                          return (
                            <td
                              key={key}
                              className={`${cls ?? ''} cell-memo`}
                              title={e.confirmComment || ''}
                            >
                              {e.confirmComment || '—'}
                            </td>
                          )
                        case 'category':
                          return (
                            <td key={key} className={cls}>
                              {category ? category.name : '—'}
                            </td>
                          )
                        case 'group':
                          return (
                            <td key={key} className={cls}>
                              {group ? group.name : '—'}
                            </td>
                          )
                        case 'tags':
                          return (
                            <td key={key} className={cls}>
                              {sensor?.tags && sensor.tags.length > 0
                                ? sensor.tags.join(', ')
                                : '—'}
                            </td>
                          )
                        case 'manufacturer':
                          return (
                            <td key={key} className={cls}>
                              {e.manufacturer}
                            </td>
                          )
                        case 'model':
                          return (
                            <td key={key} className={cls}>
                              {e.model}
                            </td>
                          )
                        default:
                          return null
                      }
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}

        <div className="alerts-pagination-bar alerts-pagination-bar-bottom">
          <PaginationControls
            page={currentPage}
            totalPages={totalPages}
            pageSize={PAGE_SIZE}
            filteredCount={filteredEntries.length}
            totalCount={totalCount}
            onSetPage={setPage}
          />
        </div>
      </section>

      <AlertColumnSettingsDialog
        open={columnSettingsOpen}
        visibility={columnVisibility}
        onChange={setColumnVisibility}
        order={columnOrder}
        onOrderChange={setColumnOrder}
        onClose={() => setColumnSettingsOpen(false)}
      />
    </div>
  )
}
