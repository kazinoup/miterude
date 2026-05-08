/**
 * Phase A-2: コンテキスト選択画面
 *
 * ログイン中のユーザーが、自分が入る「コンテキスト」（スーパーアドミン or 各組織の
 * メンバーシップ）を選ぶ画面。ユーザーメニューの「コンテキストを切り替え」から起動。
 *
 * 将来 Phase D で Clerk 認証完了直後の遷移先としても再利用する想定。
 */
import { ShieldCheck, Building2, X, ChevronRight } from 'lucide-react'
import type { AuthSession, AppUser, Organization, TenantRole } from '../types'
import {
  loadAuthSession,
  loadOrganizationMembers,
  loadOrganizations,
  loadUsers,
  saveAuthSession,
} from '../admin/lib/adminStorage'

type Props = {
  /** 既存セッションがある場合の「キャンセル」ボタン用。null の場合は閉じるボタンを出さない */
  onCancel: (() => void) | null
}

type ContextChoice = {
  key: string
  kind: 'admin' | 'tenant'
  /** 組織カード時の Organization。admin カード時は null */
  organization: Organization | null
  /** 組織カード時のロール（編集メンバー / 確認者）。admin カード時は null */
  tenantRole: TenantRole | null
  session: AuthSession
}

function tenantRoleLabel(role: TenantRole): string {
  if (role === 'editor') return '編集メンバー'
  return '確認者（dashboard_confirmer）'
}

/** ログイン中ユーザーが入れる全コンテキストを組み立てる */
function buildChoicesForUser(user: AppUser): ContextChoice[] {
  const orgs = loadOrganizations()
  const members = loadOrganizationMembers()
  const choices: ContextChoice[] = []

  if (user.systemRole === 'super_admin') {
    choices.push({
      key: 'admin',
      kind: 'admin',
      organization: null,
      tenantRole: null,
      session: { kind: 'admin', userId: user.id },
    })
  }

  const memberships = Object.values(members).filter((m) => m.userId === user.id)
  for (const m of memberships) {
    const org = orgs[m.organizationId]
    if (!org) continue
    choices.push({
      key: `tenant-${org.id}`,
      kind: 'tenant',
      organization: org,
      tenantRole: m.role,
      session: { kind: 'tenant', userId: user.id, organizationId: org.id },
    })
  }
  return choices
}

export function ContextSelectView({ onCancel }: Props) {
  const session = loadAuthSession()
  const users = loadUsers()
  const currentUser = session ? users[session.userId] : null

  if (!currentUser) {
    // モック期は seed で必ずユーザーが入っているはずだが、念のためのフォールバック
    return (
      <div className="ctx-select-shell">
        <div className="ctx-select-card">
          <p>ログインユーザーが特定できませんでした。</p>
        </div>
      </div>
    )
  }

  const choices = buildChoicesForUser(currentUser)

  function handleSelect(s: AuthSession) {
    saveAuthSession(s)
    // セッション切替は影響範囲が広いのでリロードで反映（モックの簡略化、A-1 と同じ）
    window.location.reload()
  }

  // 現在アクティブなコンテキストを判別してカードに「現在ログイン中」マークを付ける
  const activeKey =
    session?.kind === 'admin'
      ? 'admin'
      : session?.kind === 'tenant'
        ? `tenant-${session.organizationId}`
        : null

  return (
    <div className="ctx-select-shell">
      <div className="ctx-select-card">
        {onCancel && (
          <button
            type="button"
            className="ctx-select-close"
            onClick={onCancel}
            aria-label="閉じる"
          >
            <X size={18} />
          </button>
        )}
        <div className="ctx-select-brand">ミテルデ</div>
        <h1 className="ctx-select-heading">アカウントを選んでください</h1>
        <p className="ctx-select-sub">
          {currentUser.displayName}（{currentUser.email}）として、どの権限で入りますか？
        </p>

        <div className="ctx-select-list">
          {choices.map((c) => {
            const isActive = activeKey === c.key
            return (
              <button
                key={c.key}
                type="button"
                className={`ctx-select-item ${isActive ? 'is-active' : ''}`}
                onClick={() => handleSelect(c.session)}
                disabled={isActive}
              >
                <span className="ctx-select-item-icon" aria-hidden="true">
                  {c.kind === 'admin' ? (
                    <ShieldCheck size={20} />
                  ) : (
                    <Building2 size={20} />
                  )}
                </span>
                <span className="ctx-select-item-text">
                  <span className="ctx-select-item-title">
                    {c.kind === 'admin'
                      ? 'スーパーアドミン（/admin）'
                      : c.organization!.name}
                  </span>
                  <span className="ctx-select-item-sub">
                    {c.kind === 'admin'
                      ? '全テナントの管理画面に入る'
                      : tenantRoleLabel(c.tenantRole!)}
                  </span>
                </span>
                {isActive ? (
                  <span className="ctx-select-item-badge">現在ログイン中</span>
                ) : (
                  <ChevronRight size={16} className="ctx-select-item-chev" />
                )}
              </button>
            )
          })}
          {choices.length === 0 && (
            <div className="ctx-select-empty">
              入れるコンテキストがありません。組織への招待を待つか、管理者にお問い合わせください。
            </div>
          )}
        </div>

        <div className="ctx-select-foot">
          Supabase 統合後は Clerk 認証直後にこの画面が表示されます
        </div>
      </div>
    </div>
  )
}
