/**
 * テナント一覧画面（/admin/tenants 相当）。
 *
 * 表示要素:
 *  - 検索 / 件数
 *  - 一覧テーブル（13 列、ワイド表示・横スクロール対応）:
 *      名前 / スラグ / 契約種別 / センサー / ゲートウェイ / メンバー / サポート /
 *      ツクルデAI / 請求サイクル / 決済 / 契約開始日 / 次回更新（残日数） / 自動送付
 *  - 並び替え:
 *      既定 = 次回更新の残日数 昇順（期限が近い順）
 *      ヘッダクリックでソート切替（登録日 / 次回更新）
 *  - 「新規テナント」で CreateTenantDialog を起動
 *  - 行クリックで詳細画面へ
 */
import { useMemo, useState } from 'react'
import { Plus, Building2, Search, ArrowUp, ArrowDown, Check } from 'lucide-react'
import {
  loadOrganizations,
  loadOrganizationMembers,
  loadStaffAssignments,
} from '../lib/adminStorage'
import { gatewaysFromState, loadState, sensorsFromState } from '../../lib/storage'
import { CreateTenantDialog } from '../components/CreateTenantDialog'
import type { BillingCycle, ContractType, PaymentMethod } from '../../types'

type Props = {
  onOpenTenant: (tenantId: string) => void
}

type SortKey = 'created' | 'expiry'
type SortOrder = 'asc' | 'desc'

function formatDate(d: Date | string | number | undefined): string {
  if (!d) return '—'
  const dt = new Date(d as string | number | Date)
  if (Number.isNaN(dt.getTime())) return '—'
  return `${dt.getFullYear()}/${String(dt.getMonth() + 1).padStart(2, '0')}/${String(dt.getDate()).padStart(2, '0')}`
}

function daysUntil(d: Date | string | number | undefined): number | null {
  if (!d) return null
  const t = new Date(d as string | number | Date).getTime()
  if (Number.isNaN(t)) return null
  return Math.ceil((t - Date.now()) / (24 * 60 * 60 * 1000))
}

function expiryClass(days: number | null): string {
  if (days === null) return ''
  if (days < 0) return 'is-expired'
  if (days <= 30) return 'is-soon'
  return ''
}

function contractTypeLabel(c: ContractType | undefined): string {
  if (c === 'purchase') return '買取'
  if (c === 'subscription') return 'サブスク'
  if (c === 'demo') return 'デモ'
  if (c === 'typeless') return 'タイプレス'
  return '—'
}

function billingCycleLabel(c: BillingCycle | undefined): string {
  if (c === 'monthly') return '月'
  if (c === 'annual') return '年'
  return '—'
}

function paymentLabel(p: PaymentMethod | undefined): string {
  if (p === 'bank_transfer') return '振込'
  if (p === 'credit_card') return 'カード'
  return '—'
}

export function AdminTenantsView({ onOpenTenant }: Props) {
  const [refreshTick, setRefreshTick] = useState(0)
  const [search, setSearch] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  // 既定: 次回更新の残日数 昇順（期限が近い順）
  const [sortKey, setSortKey] = useState<SortKey>('expiry')
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc')

  const tenants = useMemo(() => {
    const orgs = loadOrganizations()
    const members = loadOrganizationMembers()
    const assignments = loadStaffAssignments()
    const now = Date.now()

    // 顧客メンバー数を組織別に集計
    const memberCountByOrg: Record<string, number> = {}
    for (const m of Object.values(members)) {
      memberCountByOrg[m.organizationId] =
        (memberCountByOrg[m.organizationId] ?? 0) + 1
    }

    // 有効なサポート割り当て（revoked 無し / 期限切れ無し）を組織別に集計
    const supportCountByOrg: Record<string, number> = {}
    for (const a of Object.values(assignments)) {
      if (a.revokedAt) continue
      if (a.expiresAt && new Date(a.expiresAt).getTime() <= now) continue
      supportCountByOrg[a.organizationId] =
        (supportCountByOrg[a.organizationId] ?? 0) + 1
    }

    return Object.values(orgs).map((o) => {
      const tenantState = loadState(o.id)
      const sensorCount = tenantState
        ? Object.keys(sensorsFromState(tenantState)).length
        : 0
      const gatewayCount = tenantState
        ? Object.keys(gatewaysFromState(tenantState)).length
        : 0
      return {
        ...o,
        memberCount: memberCountByOrg[o.id] ?? 0,
        supportCount: supportCountByOrg[o.id] ?? 0,
        sensorCount,
        gatewayCount,
        remainingDays: daysUntil(o.contractExpiresAt),
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTick])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return tenants
    return tenants.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.slug.toLowerCase().includes(q) ||
        t.id.toLowerCase().includes(q),
    )
  }, [tenants, search])

  const sorted = useMemo(() => {
    const list = [...filtered]
    list.sort((a, b) => {
      if (sortKey === 'created') {
        const at = new Date(a.createdAt as unknown as string).getTime()
        const bt = new Date(b.createdAt as unknown as string).getTime()
        const ord = (Number.isNaN(at) ? 0 : at) - (Number.isNaN(bt) ? 0 : bt)
        return sortOrder === 'asc' ? ord : -ord
      }
      // expiry: 残日数で並べる（未設定は末尾固定）
      const ar = a.remainingDays
      const br = b.remainingDays
      if (ar === null && br === null) return 0
      if (ar === null) return 1
      if (br === null) return -1
      const ord = ar - br
      return sortOrder === 'asc' ? ord : -ord
    })
    return list
  }, [filtered, sortKey, sortOrder])

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortOrder(key === 'created' ? 'desc' : 'asc')
    }
  }

  function sortIcon(key: SortKey) {
    if (sortKey !== key) {
      return <span className="sort-indicator inactive">↕</span>
    }
    return sortOrder === 'asc' ? (
      <ArrowUp size={12} className="sort-indicator active" />
    ) : (
      <ArrowDown size={12} className="sort-indicator active" />
    )
  }

  // 列数（colSpan 計算用）
  const COL_COUNT = 13

  return (
    <div className="admin-view admin-view-wide">
      <header className="admin-view-header">
        <div className="admin-view-header-text">
          <h1 className="admin-view-title">
            <Building2 size={20} />
            <span>テナント</span>
          </h1>
          <p className="admin-view-sub">
            登録されている顧客組織の一覧と新規作成を行います。
          </p>
        </div>
        <div className="admin-view-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setCreateOpen(true)}
          >
            <Plus size={16} />
            <span>新規テナント</span>
          </button>
        </div>
      </header>

      <div className="admin-toolbar">
        <div className="admin-search">
          <Search size={14} />
          <input
            type="search"
            className="form-input"
            placeholder="名前・スラグ・IDで検索"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="admin-count">
          全 <strong>{tenants.length}</strong> 件
          {search && filtered.length !== tenants.length && (
            <>
              {' '}・ 一致 <strong>{filtered.length}</strong>
            </>
          )}
        </div>
      </div>

      <div className="admin-table-wrap admin-tenants-grid">
        <table className="admin-table tenants-table">
          <thead>
            <tr>
              <th className="col-tenant-name">名前</th>
              <th>スラグ</th>
              <th>契約種別</th>
              <th className="num">センサー</th>
              <th className="num">GW</th>
              <th className="num">メンバー</th>
              <th className="num">サポート</th>
              <th>AI 連携</th>
              <th>サイクル</th>
              <th>決済</th>
              <th
                className="sortable-th"
                onClick={() => toggleSort('created')}
                aria-sort={
                  sortKey === 'created'
                    ? sortOrder === 'asc'
                      ? 'ascending'
                      : 'descending'
                    : 'none'
                }
              >
                <span>契約開始日</span>
                {sortIcon('created')}
              </th>
              <th
                className="sortable-th"
                onClick={() => toggleSort('expiry')}
                aria-sort={
                  sortKey === 'expiry'
                    ? sortOrder === 'asc'
                      ? 'ascending'
                      : 'descending'
                    : 'none'
                }
              >
                <span>次回更新（残日数）</span>
                {sortIcon('expiry')}
              </th>
              <th>自動送付</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((t) => {
              const isAutoInvoice =
                t.paymentMethod === 'bank_transfer' && !!t.autoInvoice
              return (
                <tr
                  key={t.id}
                  className="admin-table-row"
                  onClick={() => onOpenTenant(t.id)}
                >
                  <td className="admin-table-name col-tenant-name">{t.name}</td>
                  <td className="mono">{t.slug}</td>
                  <td>
                    <span
                      className={`contract-type-pill contract-type-${t.contractType ?? 'subscription'}`}
                    >
                      {contractTypeLabel(t.contractType)}
                    </span>
                  </td>
                  <td className="num">{t.sensorCount}</td>
                  <td className="num">{t.gatewayCount}</td>
                  <td className="num">{t.memberCount}</td>
                  <td className="num">{t.supportCount}</td>
                  <td>
                    {t.tsukurudeAiEnabled ? (
                      <span className="bool-yes" title="ツクルデAI 連携あり">
                        <Check size={13} />
                      </span>
                    ) : (
                      <span className="bool-no muted">—</span>
                    )}
                  </td>
                  <td>{billingCycleLabel(t.billingCycle)}</td>
                  <td>{paymentLabel(t.paymentMethod)}</td>
                  <td>
                    {t.contractStartedAt ? (
                      formatDate(t.contractStartedAt)
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>
                    {t.contractExpiresAt ? (
                      <span
                        className={`contract-expiry-cell ${expiryClass(t.remainingDays)}`}
                      >
                        {formatDate(t.contractExpiresAt)}
                        {t.remainingDays !== null && (
                          <span className="contract-expiry-days">
                            {t.remainingDays < 0
                              ? `（${-t.remainingDays}日経過）`
                              : t.remainingDays === 0
                                ? '（本日）'
                                : `（あと${t.remainingDays}日）`}
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="muted">未設定</span>
                    )}
                  </td>
                  <td>
                    {t.paymentMethod === 'credit_card' ? (
                      <span className="muted" title="クレジット決済は自動引き落とし">
                        自動引落
                      </span>
                    ) : isAutoInvoice ? (
                      <span className="bool-yes" title="請求書を自動送付">
                        <Check size={13} />
                      </span>
                    ) : (
                      <span className="bool-no muted">—</span>
                    )}
                  </td>
                </tr>
              )
            })}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={COL_COUNT} className="admin-table-empty">
                  {search
                    ? '一致するテナントがありません'
                    : 'まだテナントがありません。「新規テナント」から作成してください。'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {createOpen && (
        <CreateTenantDialog
          onClose={() => setCreateOpen(false)}
          onCreated={(orgId) => {
            setCreateOpen(false)
            setRefreshTick((v) => v + 1)
            onOpenTenant(orgId)
          }}
        />
      )}
    </div>
  )
}
