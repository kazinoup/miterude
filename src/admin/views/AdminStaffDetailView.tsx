/**
 * Phase A-5: スタッフ詳細画面（/admin/staff/{id} 相当）。
 *
 * - 基本情報（name / email / id / 追加日）
 * - 割り当て一覧（テナント / 理由 / 有効期限 / ステータス）
 * - 割り当て追加（AssignTenantDialog）
 * - 割り当て取消（revokedAt を立てる）
 * - 各「有効」割り当て行から impersonation 起動
 *
 * Phase A-5 ではスタッフ自体の削除は実装しない（操作履歴の整合性のため）。
 * 割り当ての取消は revokedAt を立てるだけで物理削除しない（監査追跡可能性）。
 */
import { useMemo, useState } from 'react'
import {
  ArrowLeft,
  Eye,
  Mail,
  Plus,
  ShieldOff,
  ShieldCheck,
} from 'lucide-react'
import {
  loadOrganizations,
  loadStaffAssignments,
  loadUsers,
  logStaffAction,
  saveStaffAssignments,
  upsertStaffAssignment,
} from '../lib/adminStorage'
import { startImpersonation } from '../lib/impersonation'
import { AssignTenantDialog } from '../components/AssignTenantDialog'
import { toast } from '../../lib/toast'
import type { StaffAssignment } from '../../types'

type Props = {
  staffUserId: string
  /** impersonation や監査ログ用: 操作する admin の userId */
  adminUserId: string
  onBack: () => void
}

type AssignmentRow = StaffAssignment & {
  organizationName: string
  organizationSlug: string
  status: 'active' | 'expired' | 'revoked'
}

function formatDate(d: Date | string | number | undefined): string {
  if (!d) return '—'
  const dt = new Date(d as string | number | Date)
  if (Number.isNaN(dt.getTime())) return '—'
  return `${dt.getFullYear()}/${String(dt.getMonth() + 1).padStart(2, '0')}/${String(dt.getDate()).padStart(2, '0')} ${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`
}

function statusOf(a: StaffAssignment, now = Date.now()): AssignmentRow['status'] {
  if (a.revokedAt) return 'revoked'
  if (a.expiresAt && new Date(a.expiresAt).getTime() <= now) return 'expired'
  return 'active'
}

function statusLabel(s: AssignmentRow['status']): string {
  if (s === 'active') return '有効'
  if (s === 'expired') return '期限切れ'
  return '取消済'
}

export function AdminStaffDetailView({
  staffUserId,
  adminUserId,
  onBack,
}: Props) {
  const [refreshTick, setRefreshTick] = useState(0)
  const [assignOpen, setAssignOpen] = useState(false)

  const staff = useMemo(() => {
    const users = loadUsers()
    return users[staffUserId] ?? null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staffUserId, refreshTick])

  const rows: AssignmentRow[] = useMemo(() => {
    const assignments = loadStaffAssignments()
    const orgs = loadOrganizations()
    return Object.values(assignments)
      .filter((a) => a.staffUserId === staffUserId)
      .map((a) => {
        const o = orgs[a.organizationId]
        return {
          ...a,
          organizationName: o?.name ?? '(削除済)',
          organizationSlug: o?.slug ?? '—',
          status: statusOf(a),
        }
      })
      .sort((a, b) => {
        // active を上に、次に expired、最後に revoked
        const order = { active: 0, expired: 1, revoked: 2 } as const
        if (order[a.status] !== order[b.status]) {
          return order[a.status] - order[b.status]
        }
        const at = new Date(a.grantedAt).getTime()
        const bt = new Date(b.grantedAt).getTime()
        return bt - at
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staffUserId, refreshTick])

  const activeOrgIds = useMemo(
    () => rows.filter((r) => r.status === 'active').map((r) => r.organizationId),
    [rows],
  )

  function handleRevoke(a: AssignmentRow) {
    if (!confirm(`割り当て「${a.organizationName}」を取り消しますか？`)) return
    const store = loadStaffAssignments()
    const updated: StaffAssignment = { ...a, revokedAt: new Date() }
    saveStaffAssignments(upsertStaffAssignment(store, updated))
    logStaffAction({
      staffUserId: adminUserId,
      organizationId: a.organizationId,
      action: 'assignment_revoked',
      targetTable: 'staff_assignments',
      targetId: a.id,
      metadata: { revokedFromStaffUserId: staffUserId },
    })
    toast('割り当てを取り消しました', 'info')
    setRefreshTick((v) => v + 1)
  }

  function handleStartImpersonation(a: AssignmentRow) {
    const reasonInput = prompt(
      `${a.organizationName} の顧客 UI を ${staff?.displayName} のスタッフセッションで開きます。\n\n対応理由を入力してください（監査ログに記録されます）`,
      a.notes ?? '',
    )
    if (!reasonInput || !reasonInput.trim()) return
    startImpersonation({
      staffUserId,
      organizationId: a.organizationId,
      reason: reasonInput.trim(),
    })
    // startImpersonation 内で reload するので、以降の処理は不要
  }

  if (!staff) {
    return (
      <div className="admin-view">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onBack}>
          <ArrowLeft size={14} />
          <span>スタッフ一覧へ戻る</span>
        </button>
        <div className="admin-placeholder">
          <h1>スタッフが見つかりません</h1>
        </div>
      </div>
    )
  }

  return (
    <div className="admin-view">
      <header className="admin-view-header">
        <div className="admin-view-header-text">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onBack}
          >
            <ArrowLeft size={14} />
            <span>スタッフ一覧へ戻る</span>
          </button>
          <h1 className="admin-view-title">{staff.displayName}</h1>
          <p className="admin-view-sub mono">{staff.id}</p>
        </div>
      </header>

      <section className="admin-section">
        <div className="admin-section-head">
          <h2>基本情報</h2>
        </div>
        <div className="admin-grid-form">
          <div className="form-row">
            <label className="form-label">名前</label>
            <div className="readonly-field">{staff.displayName}</div>
          </div>
          <div className="form-row">
            <label className="form-label">メール</label>
            <div className="readonly-field mono">
              <Mail size={11} className="inline-icon" /> {staff.email}
            </div>
          </div>
          <div className="form-row">
            <label className="form-label">ロール</label>
            <div className="readonly-field">
              <span className="role-pill">
                <ShieldCheck size={11} />
                {staff.systemRole ?? '—'}
              </span>
            </div>
          </div>
          <div className="form-row">
            <label className="form-label">追加日</label>
            <div className="readonly-field">{formatDate(staff.createdAt)}</div>
          </div>
        </div>
      </section>

      <section className="admin-section">
        <div className="admin-section-head">
          <h2>テナント割り当て（{rows.length} 件）</h2>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => setAssignOpen(true)}
          >
            <Plus size={14} />
            <span>割り当て追加</span>
          </button>
        </div>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>テナント</th>
                <th>ステータス</th>
                <th>理由</th>
                <th>有効期限</th>
                <th>付与日</th>
                <th aria-label="アクション" />
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td className="admin-table-name">
                    {a.organizationName}
                    <span className="admin-table-meta-pill mono">
                      {a.organizationSlug}
                    </span>
                  </td>
                  <td>
                    <span className={`asg-status asg-status-${a.status}`}>
                      {statusLabel(a.status)}
                    </span>
                  </td>
                  <td className="ellipsis-2">{a.notes ?? '—'}</td>
                  <td>
                    {a.expiresAt ? formatDate(a.expiresAt) : '無期限'}
                  </td>
                  <td>{formatDate(a.grantedAt)}</td>
                  <td className="actions-cell">
                    {a.status === 'active' && (
                      <>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => handleStartImpersonation(a)}
                          title="このテナントを顧客 UI で閲覧開始"
                        >
                          <Eye size={13} />
                          <span>閲覧開始</span>
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm asg-revoke"
                          onClick={() => handleRevoke(a)}
                          title="この割り当てを取り消す"
                        >
                          <ShieldOff size={13} />
                          <span>取消</span>
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="admin-table-empty">
                    まだ割り当てがありません。「割り当て追加」から付与してください。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {assignOpen && (
        <AssignTenantDialog
          staffUserId={staffUserId}
          grantedByUserId={adminUserId}
          alreadyAssignedOrgIds={activeOrgIds}
          onClose={() => setAssignOpen(false)}
          onCreated={() => {
            setAssignOpen(false)
            setRefreshTick((v) => v + 1)
          }}
        />
      )}
    </div>
  )
}
