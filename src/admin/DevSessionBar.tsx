/**
 * 開発用セッション切替バー — Phase A-1
 *
 * 画面上部に常時表示し、現在ログイン中のユーザー / テナント / セッション種別を確認 +
 * モックユーザー間を 1 クリックで切り替えできる。
 *
 * Phase A-2 で正式なコンテキスト選択画面を実装したら、このバーは
 * 開発時のデバッグ用途に縮小（dev サーバーのみ表示など）に切り替えていく。
 */
import { useState } from 'react'
import { ChevronDown, ShieldCheck, User as UserIcon } from 'lucide-react'
import {
  loadAuthSession,
  loadOrganizationMembers,
  loadOrganizations,
  loadUsers,
  saveAuthSession,
} from './lib/adminStorage'
import type { AppUser, AuthSession, Organization } from '../types'

function describe(session: AuthSession | null): string {
  if (!session) return '未ログイン'
  if (session.kind === 'admin') return 'スーパーアドミン (/admin)'
  if (session.kind === 'tenant') return `テナント: ${session.organizationId}`
  return `代行（${session.actingAsOrganizationId}）`
}

export function DevSessionBar() {
  const [open, setOpen] = useState(false)
  const session = loadAuthSession()
  const users = loadUsers()
  const orgs = loadOrganizations()
  const members = loadOrganizationMembers()

  const currentUser = session ? users[session.userId] : null
  const currentOrgId =
    session?.kind === 'tenant'
      ? session.organizationId
      : session?.kind === 'impersonation'
        ? session.actingAsOrganizationId
        : null
  const currentOrg = currentOrgId ? orgs[currentOrgId] : null

  /** 切り替え候補を組み立てる:
   *   - 各 user × 所属組織（顧客メンバー）
   *   - super_admin ユーザーには /admin 候補も追加 */
  const candidates: {
    label: string
    sub: string
    session: AuthSession
  }[] = []
  for (const u of Object.values(users)) {
    if (u.systemRole === 'super_admin') {
      candidates.push({
        label: `${u.displayName}（${u.email}）`,
        sub: 'スーパーアドミンとしてログイン',
        session: { kind: 'admin', userId: u.id },
      })
    }
    const userMems = Object.values(members).filter((m) => m.userId === u.id)
    for (const m of userMems) {
      const o = orgs[m.organizationId]
      if (!o) continue
      const roleLabel =
        m.role === 'editor' ? '編集メンバー' : '確認者(dashboard_confirmer)'
      candidates.push({
        label: `${u.displayName}（${u.email}）`,
        sub: `${o.name} ・ ${roleLabel}`,
        session: { kind: 'tenant', userId: u.id, organizationId: o.id },
      })
    }
  }

  function switchTo(s: AuthSession) {
    saveAuthSession(s)
    setOpen(false)
    // 状態が大きく変わるためリロード（モックの簡略化）
    window.location.reload()
  }

  return (
    <div className="dev-session-bar">
      <button
        type="button"
        className="dev-session-bar-current"
        onClick={() => setOpen((v) => !v)}
        title="ログインユーザー / テナントを切り替え（モック開発用）"
      >
        {session?.kind === 'admin' ? (
          <ShieldCheck size={13} />
        ) : (
          <UserIcon size={13} />
        )}
        <span className="dev-session-bar-text">
          <strong>{currentUser?.displayName ?? '未ログイン'}</strong>
          <span className="muted">
            {' / '}
            {currentOrg?.name ?? describe(session)}
            {currentUser?.systemRole && (
              <span className="dev-session-bar-role">
                [{currentUser.systemRole}]
              </span>
            )}
          </span>
        </span>
        <ChevronDown size={12} className={open ? 'is-open' : ''} />
      </button>

      {open && (
        <div className="dev-session-bar-menu" role="menu">
          <div className="dev-session-bar-menu-head">
            ログインを切り替え（モック）
          </div>
          {candidates.map((c, i) => (
            <button
              key={i}
              type="button"
              className="dev-session-bar-item"
              onClick={() => switchTo(c.session)}
            >
              <div className="dev-session-bar-item-label">{c.label}</div>
              <div className="dev-session-bar-item-sub muted">{c.sub}</div>
            </button>
          ))}
          <div className="dev-session-bar-foot">
            Supabase 統合後は通常のログイン画面に置き換えられます
          </div>
        </div>
      )}
    </div>
  )
}

/** 補助: AppUser / Organization の取得（DEV ツール用） */
export function getCurrentTenantInfo():
  | { user: AppUser | null; organization: Organization | null }
  | null {
  const session = loadAuthSession()
  if (!session) return null
  const users = loadUsers()
  const orgs = loadOrganizations()
  const user = users[session.userId] ?? null
  const orgId =
    session.kind === 'tenant'
      ? session.organizationId
      : session.kind === 'impersonation'
        ? session.actingAsOrganizationId
        : null
  return { user, organization: orgId ? orgs[orgId] ?? null : null }
}
