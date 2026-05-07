/**
 * アラートログ一覧画面 — Phase B / Phase 10 + 改訂
 *
 * 上部: 対象デバイス（SensorPicker）— レポート画面と同じ仕様
 * 下部: 絞り込みフィルタ（センサー画面と同じ FilterConditions ベース） +
 *       期間フィルタ + 種別フィルタ
 *
 * フィルタはすべて AND で評価される:
 *   - 対象デバイスに含まれる targetId のエントリのみ
 *   - そのエントリに紐付くセンサー / ゲートウェイが FilterConditions にマッチ
 *   - occurredAt が期間範囲内
 *   - kind が選択された種別に含まれる
 */
import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  AlertOctagon,
  WifiOff,
  Battery,
  ChevronLeft,
  ChevronRight,
  Filter as FilterIcon,
  CheckSquare,
} from 'lucide-react'
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
import { fromDateInputValue, toDateInputValue } from '../../lib/period'
import { isEmptyConditions, sensorMatches } from '../../lib/groups'
import { SensorPicker } from '../SensorPicker'
import { SensorFilterPanel } from '../SensorFilterPanel'

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
  /** 対象デバイス（SensorPicker による明示選択）。空なら全件対象。 */
  const [selectedDeviceIds, setSelectedDeviceIds] = useState<string[]>([])

  /** 下段フィルタ（センサー一覧と同じパターン） */
  const [conditions, setConditions] = useState<FilterConditions>({})

  /** 種別フィルタ（チェック ON のものだけ表示）。初期値は全種別 ON。 */
  const [selectedKinds, setSelectedKinds] = useState<Set<AlertLogKind>>(
    () => new Set<AlertLogKind>(KIND_ORDER),
  )

  /** 期間（YYYY-MM-DD 形式の文字列で UI に保持。空なら制限なし） */
  const [fromDate, setFromDate] = useState<string>('')
  const [toDate, setToDate] = useState<string>('')

  const [page, setPage] = useState(0)

  // フィルタ条件が変わったら 1 ページ目に戻す
  useEffect(() => {
    setPage(0)
  }, [selectedDeviceIds, conditions, selectedKinds, fromDate, toDate])

  // ワイド表示固定
  useEffect(() => {
    const el = document.querySelector('.app-content-inner')
    if (!el) return
    el.classList.add('is-wide')
    return () => {
      el.classList.remove('is-wide')
    }
  }, [])

  /** SensorPicker で「明示選択」されているデバイスの集合。
   *  空なら全件（フィルタ条件のみ適用）。 */
  const explicitTargetSet = useMemo(
    () =>
      selectedDeviceIds.length === 0 ? null : new Set(selectedDeviceIds),
    [selectedDeviceIds],
  )

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
        // 1) 対象デバイス（明示選択）
        if (explicitTargetSet && !explicitTargetSet.has(e.targetId)) return false
        // 2) センサー属性フィルタ（センサーターゲットのみ。ゲートウェイは
        //    フィルタ条件に該当する属性が無いため、属性フィルタが空でない限り
        //    ゲートウェイエントリは除外する）
        if (conditionMatchedSensorIds) {
          if (e.targetKind === 'sensor') {
            if (!conditionMatchedSensorIds.has(e.targetId)) return false
          } else {
            return false
          }
        }
        // 3) 種別
        if (!selectedKinds.has(e.kind)) return false
        // 4) 期間
        const t = entryTime(e)
        if (fromTs != null && t < fromTs) return false
        if (toTs != null && t >= toTs) return false
        return true
      })
      .sort((a, b) => entryTime(b) - entryTime(a))
  }, [
    alertLogs,
    explicitTargetSet,
    conditionMatchedSensorIds,
    selectedKinds,
    fromDate,
    toDate,
  ])

  const totalPages = Math.max(1, Math.ceil(filteredEntries.length / PAGE_SIZE))
  const pageIdx = Math.min(page, totalPages - 1)
  const pageEntries = filteredEntries.slice(
    pageIdx * PAGE_SIZE,
    (pageIdx + 1) * PAGE_SIZE,
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
    setSelectedDeviceIds([])
    setConditions({})
    setSelectedKinds(new Set(KIND_ORDER))
    setFromDate('')
    setToDate('')
  }

  const totalCount = Object.keys(alertLogs).length
  const filterActive =
    selectedDeviceIds.length > 0 ||
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
      </header>

      {/* ===== 上段: 対象デバイス（SensorPicker = レポート画面と同じ） ===== */}
      <section className="panel-card">
        <div className="panel-card-head">
          <h2>
            <CheckSquare size={16} className="head-icon" />
            対象デバイス
          </h2>
          <span className="panel-card-meta">
            {selectedDeviceIds.length === 0
              ? 'すべてのデバイスを対象'
              : `${selectedDeviceIds.length} 台選択中`}
          </span>
        </div>
        <SensorPicker
          candidateSensors={sensors}
          selected={selectedDeviceIds}
          onChange={setSelectedDeviceIds}
          groups={sensorGroups}
          categories={sensorCategories}
          savedFilters={savedFilters}
        />
      </section>

      {/* ===== 下段: 絞り込みフィルタ ===== */}
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
        />

        {/* 期間 + 種別 — アラートログ専用のフィルタ */}
        <div className="alerts-extra-filters">
          <div className="alerts-filter-block">
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
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  const today = new Date()
                  const past = new Date(today)
                  past.setDate(today.getDate() - 7)
                  setFromDate(toDateInputValue(past))
                  setToDate(toDateInputValue(today))
                }}
                title="直近 7 日"
              >
                7日
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  const today = new Date()
                  const past = new Date(today)
                  past.setDate(today.getDate() - 30)
                  setFromDate(toDateInputValue(past))
                  setToDate(toDateInputValue(today))
                }}
                title="直近 30 日"
              >
                30日
              </button>
            </div>
          </div>

          <div className="alerts-filter-block">
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

      {/* ===== グリッド ===== */}
      <section className="panel-card alerts-grid-card">
        {pageEntries.length === 0 ? (
          <p className="muted in-panel">
            条件に一致するアラートはありません。
          </p>
        ) : (
          <table className="alerts-grid">
            <thead>
              <tr>
                <th className="col-time">発生日時</th>
                <th className="col-target">対象デバイス</th>
                <th className="col-kind">種別</th>
                <th className="col-message">内容</th>
              </tr>
            </thead>
            <tbody>
              {pageEntries.map((e) => {
                const Icon = kindIcon(e.kind)
                return (
                  <tr key={e.id}>
                    <td className="col-time">
                      {formatDateTime(e.occurredAt)}
                    </td>
                    <td className="col-target">
                      <div className="alerts-target-cell">
                        <span
                          className={`alerts-target-kind alerts-target-kind-${e.targetKind}`}
                        >
                          {e.targetKind === 'sensor'
                            ? 'センサー'
                            : 'ゲートウェイ'}
                        </span>
                        <span className="alerts-target-cell-name">
                          {sensors[e.targetId]?.name ??
                            gateways[e.targetId]?.name ??
                            e.targetId}
                        </span>
                      </div>
                      <div className="alerts-target-cell-meta muted">
                        <span>
                          {e.manufacturer} {e.model}
                        </span>
                        <span>S/N: {e.serialNumber}</span>
                        {e.sensorNumber && <span>番号: {e.sensorNumber}</span>}
                      </div>
                    </td>
                    <td className="col-kind">
                      <span
                        className={`alert-kind-badge alert-kind-badge-${e.kind}`}
                      >
                        <Icon size={11} strokeWidth={2.4} />
                        {ALERT_LOG_KIND_LABELS[e.kind]}
                      </span>
                    </td>
                    <td className="col-message">{e.message}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}

        {filteredEntries.length > PAGE_SIZE && (
          <div className="alerts-pagination">
            <button
              type="button"
              className="icon-btn"
              disabled={pageIdx === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              aria-label="前のページ"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="alerts-pagination-info">
              {pageIdx + 1} / {totalPages} ページ
            </span>
            <button
              type="button"
              className="icon-btn"
              disabled={pageIdx >= totalPages - 1}
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              aria-label="次のページ"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        )}
      </section>
    </div>
  )
}
