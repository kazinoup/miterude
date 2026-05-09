/**
 * Phase A-5: スタッフ一覧画面（/admin/staff 相当）。
 *
 * - systemRole === 'support' のユーザーを一覧表示
 * - 「スタッフ追加」で CreateStaffDialog を起動
 * - 行クリックで詳細画面へ
 */
import { useMemo, useState } from 'react'
import { Plus, Users2, Search } from 'lucide-react'
import {
  loadStaffAssignments,
  loadUsers,
} from '../lib/adminStorage'
import { CreateStaffDialog } from '../components/CreateStaffDialog'

type Props = {
  onOpenStaff: (userId: string) => void
}

function formatDate(d: Date | string | number | undefined): string {
  if (!d) return '—'
  const dt = new Date(d as string | number | Date)
  if (Number.isNaN(dt.getTime())) return '—'
  return `${dt.getFullYear()}/${String(dt.getMonth() + 1).padStart(2, '0')}/${String(dt.getDate()).padStart(2, '0')}`
}

export function AdminStaffView({ onOpenStaff }: Props) {
  const [refreshTick, setRefreshTick] = useState(0)
  const [search, setSearch] = useState('')
  const [createOpen, setCreateOpen] = useState(false)

  const rows = useMemo(() => {
    const users = loadUsers()
    const assignments = loadStaffAssignments()
    const now = Date.now()
    const activeCountByStaff: Record<string, number> = {}
    for (const a of Object.values(assignments)) {
      if (a.revokedAt) continue
      const exp = a.expiresAt ? new Date(a.expiresAt).getTime() : Infinity
      if (exp <= now) continue
      activeCountByStaff[a.staffUserId] =
        (activeCountByStaff[a.staffUserId] ?? 0) + 1
    }
    return Object.values(users)
      .filter((u) => u.systemRole === 'support')
      .map((u) => ({
        ...u,
        activeAssignments: activeCountByStaff[u.id] ?? 0,
      }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName, 'ja'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTick])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(
      (r) =>
        r.displayName.toLowerCase().includes(q) ||
        r.email.toLowerCase().includes(q) ||
        r.id.toLowerCase().includes(q),
    )
  }, [rows, search])

  return (
    <div className="admin-view">
      <header className="admin-view-header">
        <div className="admin-view-header-text">
          <h1 className="admin-view-title">
            <Users2 size={20} />
            <span>スタッフ</span>
          </h1>
          <p className="admin-view-sub">
            運営側の <code>support</code> ロールユーザーと、テナントへの一時アクセス権を管理します。
          </p>
        </div>
        <div className="admin-view-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setCreateOpen(true)}
          >
            <Plus size={16} />
            <span>スタッフ追加</span>
          </button>
        </div>
      </header>

      <div className="admin-toolbar">
        <div className="admin-search">
          <Search size={14} />
          <input
            type="search"
            className="form-input"
            placeholder="名前・メール・IDで検索"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="admin-count">
          全 <strong>{rows.length}</strong> 名
          {search && filtered.length !== rows.length && (
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
              <th>区分</th>
              <th>メール</th>
              <th>有効な割り当て</th>
              <th>追加日</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((u) => (
              <tr
                key={u.id}
                className="admin-table-row"
                onClick={() => onOpenStaff(u.id)}
              >
                <td className="admin-table-name">{u.displayName}</td>
                <td>
                  <span
                    className={`staff-category-pill staff-category-${u.staffCategory ?? 'support'}`}
                  >
                    {u.staffCategory === 'sales' ? '営業' : 'サポート'}
                  </span>
                </td>
                <td className="mono">{u.email}</td>
                <td className="num">{u.activeAssignments}</td>
                <td>{formatDate(u.createdAt)}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="admin-table-empty">
                  {search
                    ? '一致するスタッフがありません'
                    : 'まだスタッフがいません。「スタッフ追加」で support ユーザーを作成してください。'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {createOpen && (
        <CreateStaffDialog
          onClose={() => setCreateOpen(false)}
          onCreated={(userId) => {
            setCreateOpen(false)
            setRefreshTick((v) => v + 1)
            onOpenStaff(userId)
          }}
        />
      )}
    </div>
  )
}
