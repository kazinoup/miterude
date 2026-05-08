/**
 * Phase A-4: テナント一覧画面（/admin/tenants 相当）。
 *
 * - 全 organization をテーブル表示（メンバー数、プラン、作成日付き）
 * - 「新規作成」で CreateTenantDialog を開く
 * - 行クリックで詳細画面へ遷移
 */
import { useMemo, useState } from 'react'
import { Plus, Building2, Search } from 'lucide-react'
import {
  loadOrganizations,
  loadOrganizationMembers,
} from '../lib/adminStorage'
import { CreateTenantDialog } from '../components/CreateTenantDialog'
import type { Organization } from '../../types'

type Props = {
  onOpenTenant: (tenantId: string) => void
}

function formatDate(d: Date | string | number | undefined): string {
  if (!d) return '—'
  const dt = typeof d === 'object' ? d : new Date(d)
  if (Number.isNaN(dt.getTime())) return '—'
  return `${dt.getFullYear()}/${String(dt.getMonth() + 1).padStart(2, '0')}/${String(
    dt.getDate(),
  ).padStart(2, '0')}`
}

function planLabel(plan: Organization['plan']): string {
  if (plan === 'demo') return 'デモ'
  if (plan === 'standard') return 'スタンダード'
  return 'エンタープライズ'
}

export function AdminTenantsView({ onOpenTenant }: Props) {
  const [refreshTick, setRefreshTick] = useState(0)
  const [search, setSearch] = useState('')
  const [createOpen, setCreateOpen] = useState(false)

  const tenants = useMemo(() => {
    const orgs = loadOrganizations()
    const members = loadOrganizationMembers()
    const memberCountByOrg: Record<string, number> = {}
    for (const m of Object.values(members)) {
      memberCountByOrg[m.organizationId] =
        (memberCountByOrg[m.organizationId] ?? 0) + 1
    }
    return Object.values(orgs)
      .map((o) => ({
        ...o,
        memberCount: memberCountByOrg[o.id] ?? 0,
      }))
      .sort((a, b) => {
        // localStorage 経由で Date が文字列化されているケースもあるので、毎回 new Date する
        const at = new Date(a.createdAt as unknown as string | number | Date).getTime()
        const bt = new Date(b.createdAt as unknown as string | number | Date).getTime()
        return (Number.isNaN(bt) ? 0 : bt) - (Number.isNaN(at) ? 0 : at)
      })
    // refreshTick を依存に入れて再計算
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

  return (
    <div className="admin-view">
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

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>名前</th>
              <th>スラグ</th>
              <th>プラン</th>
              <th>メンバー</th>
              <th>作成日</th>
              <th>ID</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((t) => (
              <tr
                key={t.id}
                className="admin-table-row"
                onClick={() => onOpenTenant(t.id)}
              >
                <td className="admin-table-name">{t.name}</td>
                <td className="mono">{t.slug}</td>
                <td>
                  <span className={`plan-pill plan-${t.plan}`}>
                    {planLabel(t.plan)}
                  </span>
                </td>
                <td className="num">{t.memberCount}</td>
                <td>{formatDate(t.createdAt)}</td>
                <td className="mono ellipsis">{t.id}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="admin-table-empty">
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
