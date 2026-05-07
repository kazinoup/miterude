/**
 * アラートログ一覧画面 — Phase B / Phase 10
 *
 * - グリッド形式で AlertLogEntry を表示
 * - フィルタ: 対象デバイス（センサー＋ゲートウェイ）、期間（from/to）、種別 multi-select
 * - ページネーション: 50 件 / ページ
 *
 * 通知のまとめ送信（1日1回など）の元データ。ここに溜まったログを期間で SELECT して
 * メールにまとめる、というロジックを将来作る。画面では「いつ・何が起きたか」を確認するだけ。
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
  Search,
} from 'lucide-react'
import type {
  AlertLogEntry,
  AlertLogKind,
  AlertLogStore,
  GatewayStore,
  SensorStore,
} from '../../types'
import { ALERT_LOG_KIND_LABELS } from '../../types'
import {
  fromDateInputValue,
  toDateInputValue,
} from '../../lib/period'

type Props = {
  alertLogs: AlertLogStore
  sensors: SensorStore
  gateways: GatewayStore
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

export function AlertsView({ alertLogs, sensors, gateways }: Props) {
  // 対象デバイス（センサー + ゲートウェイ）の絞り込み（ID 集合）
  const [selectedTargets, setSelectedTargets] = useState<Set<string>>(new Set())
  const [targetSearch, setTargetSearch] = useState('')

  // 種別フィルタ（チェック ON のものだけ表示）。初期値は全種別 ON。
  const [selectedKinds, setSelectedKinds] = useState<Set<AlertLogKind>>(
    () => new Set<AlertLogKind>(KIND_ORDER),
  )

  // 期間（YYYY-MM-DD 形式の文字列で UI に保持。空なら制限なし）
  const [fromDate, setFromDate] = useState<string>('')
  const [toDate, setToDate] = useState<string>('')

  const [page, setPage] = useState(0)

  // フィルタ条件が変わったら 1 ページ目に戻す
  useEffect(() => {
    setPage(0)
  }, [selectedTargets, selectedKinds, fromDate, toDate])

  /** 対象デバイス候補（センサー + ゲートウェイ）をまとめて返す */
  const targetCandidates = useMemo(() => {
    const list: {
      id: string
      label: string
      sub: string
      kind: 'sensor' | 'gateway'
    }[] = []
    for (const s of Object.values(sensors)) {
      list.push({
        id: s.id,
        label: s.name ?? s.id,
        sub: `${s.manufacturer} ${s.model} / ${s.deviceNumber}`,
        kind: 'sensor',
      })
    }
    for (const g of Object.values(gateways)) {
      list.push({
        id: g.id,
        label: g.name,
        sub: `${g.manufacturer} ${g.model}`,
        kind: 'gateway',
      })
    }
    list.sort((a, b) => a.label.localeCompare(b.label))
    if (targetSearch.trim()) {
      const q = targetSearch.trim().toLowerCase()
      return list.filter(
        (t) =>
          t.label.toLowerCase().includes(q) ||
          t.sub.toLowerCase().includes(q),
      )
    }
    return list
  }, [sensors, gateways, targetSearch])

  /** フィルタ後のエントリ（新しい順） */
  const filteredEntries = useMemo(() => {
    const fromTs = fromDate ? fromDateInputValue(fromDate)?.getTime() : null
    const toTs = toDate
      ? (() => {
          const d = fromDateInputValue(toDate)
          if (!d) return null
          // 終日まで含めるため翌日 0:00 未満で切る
          d.setDate(d.getDate() + 1)
          return d.getTime()
        })()
      : null

    const all = Object.values(alertLogs)
    return all
      .filter((e) => {
        if (selectedTargets.size > 0 && !selectedTargets.has(e.targetId)) return false
        if (!selectedKinds.has(e.kind)) return false
        const t = entryTime(e)
        if (fromTs != null && t < fromTs) return false
        if (toTs != null && t >= toTs) return false
        return true
      })
      .sort((a, b) => entryTime(b) - entryTime(a))
  }, [alertLogs, selectedTargets, selectedKinds, fromDate, toDate])

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

  function toggleTarget(id: string) {
    setSelectedTargets((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function clearAllFilters() {
    setSelectedTargets(new Set())
    setSelectedKinds(new Set(KIND_ORDER))
    setFromDate('')
    setToDate('')
    setTargetSearch('')
  }

  const totalCount = Object.keys(alertLogs).length
  const filterActive =
    selectedTargets.size > 0 ||
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

      {/* フィルタパネル */}
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

        <div className="alerts-filter-grid">
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
                  // ショートカット: 直近 7 日
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
            <h3 className="alerts-filter-label">種別</h3>
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

          <div className="alerts-filter-block alerts-filter-block-targets">
            <h3 className="alerts-filter-label">
              対象デバイス
              {selectedTargets.size > 0 && (
                <span className="muted"> （{selectedTargets.size} 件選択中）</span>
              )}
            </h3>
            <div className="alerts-target-search">
              <Search size={13} />
              <input
                type="text"
                className="select"
                placeholder="名前 / メーカー / モデル / 番号で検索"
                value={targetSearch}
                onChange={(e) => setTargetSearch(e.target.value)}
              />
            </div>
            <div className="alerts-target-list">
              {targetCandidates.length === 0 ? (
                <p className="muted in-panel">
                  該当するデバイスがありません。
                </p>
              ) : (
                targetCandidates.map((t) => {
                  const checked = selectedTargets.has(t.id)
                  return (
                    <label key={t.id} className="alerts-target-item">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleTarget(t.id)}
                      />
                      <span className="alerts-target-info">
                        <span className="alerts-target-label">
                          <span
                            className={`alerts-target-kind alerts-target-kind-${t.kind}`}
                          >
                            {t.kind === 'sensor' ? 'センサー' : 'ゲートウェイ'}
                          </span>
                          {t.label}
                        </span>
                        <span className="alerts-target-sub muted">{t.sub}</span>
                      </span>
                    </label>
                  )
                })
              )}
            </div>
          </div>
        </div>
      </section>

      {/* グリッド */}
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
                    <td className="col-time">{formatDateTime(e.occurredAt)}</td>
                    <td className="col-target">
                      <div className="alerts-target-cell">
                        <span
                          className={`alerts-target-kind alerts-target-kind-${e.targetKind}`}
                        >
                          {e.targetKind === 'sensor' ? 'センサー' : 'ゲートウェイ'}
                        </span>
                        <span className="alerts-target-cell-name">
                          {sensors[e.targetId]?.name ??
                            gateways[e.targetId]?.name ??
                            e.targetId}
                        </span>
                      </div>
                      <div className="alerts-target-cell-meta muted">
                        <span>{e.manufacturer} {e.model}</span>
                        <span>S/N: {e.serialNumber}</span>
                        {e.sensorNumber && <span>番号: {e.sensorNumber}</span>}
                      </div>
                    </td>
                    <td className="col-kind">
                      <span className={`alert-kind-badge alert-kind-badge-${e.kind}`}>
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

        {/* ページネーション */}
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
