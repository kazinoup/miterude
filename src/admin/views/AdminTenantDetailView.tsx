/**
 * Phase A-4: テナント詳細画面（/admin/tenants/{id} 相当）。
 *
 * - 基本情報（name / slug / plan / id / 作成日）の編集
 * - メンバー一覧（emails / 役割 / 招待・参加日）
 * - 「テナントとして開く」（super_admin の閲覧用ショートカット。impersonation
 *   ではなく、自分が super_admin であることを保ったまま activeOrgId として
 *   そのテナントを開く想定。Phase A-5 でスタッフ用 impersonation を別途追加）
 *
 * Phase A-4 では削除機能は含めない（破壊的なので慎重に A-5 以降で）。
 */
import { useMemo, useState } from 'react'
import { ArrowLeft, Mail, ShieldCheck, UserCog, Save } from 'lucide-react'
import {
  loadOrganizations,
  loadOrganizationMembers,
  loadUsers,
  saveOrganizations,
  upsertOrganization,
} from '../lib/adminStorage'
import { toast } from '../../lib/toast'
import type { Organization, TenantRole } from '../../types'

type Props = {
  tenantId: string
  onBack: () => void
}

function formatDate(d: Date | string | number | undefined): string {
  if (!d) return '—'
  const dt = typeof d === 'object' ? d : new Date(d)
  if (Number.isNaN(dt.getTime())) return '—'
  return `${dt.getFullYear()}/${String(dt.getMonth() + 1).padStart(2, '0')}/${String(dt.getDate()).padStart(2, '0')}`
}

function planLabel(plan: Organization['plan']): string {
  if (plan === 'demo') return 'デモ'
  if (plan === 'standard') return 'スタンダード'
  return 'エンタープライズ'
}

function tenantRoleLabel(role: TenantRole): string {
  if (role === 'editor') return '編集メンバー'
  return '確認者'
}

export function AdminTenantDetailView({ tenantId, onBack }: Props) {
  const [refreshTick, setRefreshTick] = useState(0)

  const org = useMemo(() => {
    const orgs = loadOrganizations()
    return orgs[tenantId] ?? null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, refreshTick])

  const memberRows = useMemo(() => {
    if (!org) return []
    const users = loadUsers()
    const members = loadOrganizationMembers()
    return Object.values(members)
      .filter((m) => m.organizationId === org.id)
      .map((m) => {
        const u = users[m.userId]
        return {
          memberId: m.id,
          userId: m.userId,
          displayName: u?.displayName ?? '(不明)',
          email: u?.email ?? '',
          systemRole: u?.systemRole ?? null,
          role: m.role,
          invitedAt: m.invitedAt,
          joinedAt: m.joinedAt,
        }
      })
      .sort((a, b) => a.displayName.localeCompare(b.displayName, 'ja'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org, refreshTick])

  // 編集中の値
  const [editName, setEditName] = useState(org?.name ?? '')
  const [editSlug, setEditSlug] = useState(org?.slug ?? '')
  const [editPlan, setEditPlan] = useState<Organization['plan']>(
    org?.plan ?? 'demo',
  )

  // org が変わったら入力欄を初期化
  useMemo(() => {
    if (org) {
      setEditName(org.name)
      setEditSlug(org.slug)
      setEditPlan(org.plan)
    }
  }, [org])

  if (!org) {
    return (
      <div className="admin-view">
        <button type="button" className="btn btn-ghost" onClick={onBack}>
          <ArrowLeft size={14} />
          <span>テナント一覧へ戻る</span>
        </button>
        <div className="admin-placeholder">
          <h1>テナントが見つかりません</h1>
          <p>削除されたか、ID が誤っている可能性があります。</p>
        </div>
      </div>
    )
  }

  const dirty =
    editName.trim() !== org.name ||
    editSlug.trim() !== org.slug ||
    editPlan !== org.plan

  function handleSave() {
    if (!org) return
    const trimmedName = editName.trim()
    const trimmedSlug = editSlug.trim()
    if (!trimmedName || !trimmedSlug) {
      alert('名前とスラグは必須です。')
      return
    }
    // slug 重複チェック（自分以外と衝突したら NG）
    const orgs = loadOrganizations()
    const dup = Object.values(orgs).find(
      (o) => o.id !== org.id && o.slug === trimmedSlug,
    )
    if (dup) {
      alert(`スラグ「${trimmedSlug}」は別テナント「${dup.name}」で使用中です。`)
      return
    }
    const next: Organization = {
      ...org,
      name: trimmedName,
      slug: trimmedSlug,
      plan: editPlan,
    }
    saveOrganizations(upsertOrganization(orgs, next))
    toast('テナント情報を更新しました', 'success')
    setRefreshTick((v) => v + 1)
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
            <span>テナント一覧へ戻る</span>
          </button>
          <h1 className="admin-view-title">{org.name}</h1>
          <p className="admin-view-sub mono">{org.id}</p>
        </div>
      </header>

      <section className="admin-section">
        <div className="admin-section-head">
          <h2>基本情報</h2>
          {dirty && (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={handleSave}
            >
              <Save size={14} />
              <span>変更を保存</span>
            </button>
          )}
        </div>
        <div className="admin-grid-form">
          <div className="form-row">
            <label className="form-label">名前</label>
            <input
              className="form-input"
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
            />
          </div>
          <div className="form-row">
            <label className="form-label">スラグ</label>
            <input
              className="form-input mono"
              type="text"
              value={editSlug}
              onChange={(e) => setEditSlug(e.target.value)}
            />
          </div>
          <div className="form-row">
            <label className="form-label">プラン</label>
            <select
              className="select"
              value={editPlan}
              onChange={(e) =>
                setEditPlan(e.target.value as Organization['plan'])
              }
            >
              <option value="demo">デモ</option>
              <option value="standard">スタンダード</option>
              <option value="enterprise">エンタープライズ</option>
            </select>
          </div>
          <div className="form-row">
            <label className="form-label">作成日</label>
            <div className="readonly-field">{formatDate(org.createdAt)}</div>
          </div>
        </div>
        <div className="admin-meta-row">
          <span className={`plan-pill plan-${org.plan}`}>
            現在のプラン: {planLabel(org.plan)}
          </span>
        </div>
      </section>

      <section className="admin-section">
        <div className="admin-section-head">
          <h2>メンバー（{memberRows.length} 名）</h2>
          <div className="admin-section-note">
            メンバー追加 / 編集は Phase A-5 のスタッフ管理画面で実装予定
          </div>
        </div>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>名前</th>
                <th>メール</th>
                <th>ロール</th>
                <th>招待日</th>
                <th>参加日</th>
              </tr>
            </thead>
            <tbody>
              {memberRows.map((m) => (
                <tr key={m.memberId}>
                  <td className="admin-table-name">
                    {m.displayName}
                    {m.systemRole === 'super_admin' && (
                      <span
                        className="admin-table-meta-pill"
                        title="このユーザーはシステム横断 super_admin です"
                      >
                        <ShieldCheck size={11} />
                        super_admin
                      </span>
                    )}
                  </td>
                  <td className="mono">
                    <Mail size={11} className="inline-icon" /> {m.email}
                  </td>
                  <td>
                    <span className="role-pill">
                      <UserCog size={11} />
                      {tenantRoleLabel(m.role)}
                    </span>
                  </td>
                  <td>{formatDate(m.invitedAt)}</td>
                  <td>{formatDate(m.joinedAt)}</td>
                </tr>
              ))}
              {memberRows.length === 0 && (
                <tr>
                  <td colSpan={5} className="admin-table-empty">
                    まだメンバーがいません。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
