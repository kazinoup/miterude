import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronDown,
  LogOut,
  UserCog,
  ShieldCheck,
  Building2,
  Repeat,
  Users,
} from 'lucide-react'
import type { AuthSession, UserSession } from '../types'
import { toast } from '../lib/toast'
import {
  loadAuthSession,
  loadOrganizationMembers,
  loadOrganizations,
  loadUsers,
  saveAuthSession,
} from '../admin/lib/adminStorage'

type Props = {
  session: UserSession
  /** Phase A-2: 「コンテキストを切り替え」クリック時の挙動（選択画面を開く） */
  onSwitchContext: () => void
}

/**
 * Clerk によるサインイン UI のモック。
 * Phase A-1 の間はポップオーバー内に「モックのログイン切り替え」を埋め込み、
 * Phase A-2（正式ログイン画面）導入時にこのセクションを取り除く。
 */
export function UserMenu({ session, onSwitchContext }: Props) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const initials = (session.userName.trim()[0] ?? '?').toUpperCase()

  // 現在の権限ラベル（super_admin / 編集メンバー / 確認者）
  const currentRoleLabel = useMemo(
    () => (open ? buildCurrentRoleLabel() : null),
    [open],
  )
  const candidates = useMemo(() => (open ? buildCandidates() : []), [open])

  function handleProfile() {
    setOpen(false)
    toast('プロフィール変更画面を開きます（Clerk）', 'info')
  }
  function handleLogout() {
    setOpen(false)
    toast('ログアウトしました（Clerk モック）', 'info')
  }

  function handleSwitch(s: AuthSession) {
    saveAuthSession(s)
    setOpen(false)
    window.location.reload()
  }

  return (
    <div className="user-menu" ref={wrapRef}>
      <button
        type="button"
        className={`user-menu-trigger ${open ? 'is-open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="user-avatar" aria-hidden="true">
          {initials}
        </span>
        <span className="user-text">
          <span className="user-name">{session.userName}</span>
          <span className="user-org">{session.organizationName}</span>
        </span>
        <ChevronDown size={14} className="user-chev" />
      </button>

      {open && (
        <div className="user-menu-popover" role="menu">
          <div className="user-menu-head">
            <div className="user-avatar user-avatar-xl" aria-hidden="true">
              {initials}
            </div>
            <div className="user-menu-name">{session.userName}</div>
            <div className="user-menu-email">{session.email}</div>
            <div className="user-menu-org">{session.organizationName}</div>
            {currentRoleLabel && (
              <div className="user-menu-role-pill">{currentRoleLabel}</div>
            )}
          </div>
          <div className="user-menu-divider" />
          <button type="button" className="user-menu-item" onClick={handleProfile}>
            <UserCog size={14} />
            <span>プロフィール変更</span>
          </button>
          <button
            type="button"
            className="user-menu-item"
            onClick={() => {
              setOpen(false)
              onSwitchContext()
            }}
          >
            <Users size={14} />
            <span>コンテキストを切り替え</span>
          </button>
          <button type="button" className="user-menu-item" onClick={handleLogout}>
            <LogOut size={14} />
            <span>ログアウト</span>
          </button>

          {/* Phase A-1: モックのログイン切り替え（Phase A-2 で削除） */}
          {candidates.length > 0 && (
            <>
              <div className="user-menu-divider" />
              <div className="user-menu-section-head">
                <Repeat size={11} />
                <span>ログインを切り替え（モック）</span>
              </div>
              <div className="user-menu-switch-list">
                {candidates.map((c, i) => (
                  <button
                    key={i}
                    type="button"
                    className="user-menu-switch-item"
                    onClick={() => handleSwitch(c.session)}
                  >
                    <span className="user-menu-switch-icon" aria-hidden="true">
                      {c.session.kind === 'admin' ? (
                        <ShieldCheck size={12} />
                      ) : (
                        <Building2 size={12} />
                      )}
                    </span>
                    <span className="user-menu-switch-text">
                      <span className="user-menu-switch-label">{c.label}</span>
                      <span className="user-menu-switch-sub">{c.sub}</span>
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}

          <div className="user-menu-foot">
            <small>認証は Clerk で連携</small>
          </div>
        </div>
      )}
    </div>
  )
}

/** 現在のログインに対する権限ラベルを返す（super_admin / 編集メンバー / 確認者） */
function buildCurrentRoleLabel(): string | null {
  const session = loadAuthSession()
  if (!session) return null
  const users = loadUsers()
  const u = users[session.userId]
  if (!u) return null
  if (u.systemRole === 'super_admin') return 'スーパーアドミン'
  if (session.kind === 'tenant') {
    const members = loadOrganizationMembers()
    const m = Object.values(members).find(
      (x) => x.userId === u.id && x.organizationId === session.organizationId,
    )
    if (m?.role === 'editor') return '編集メンバー'
    if (m?.role === 'dashboard_confirmer') return '確認者'
  }
  return null
}

/** モック切り替え候補（user × 所属組織 + super_admin の admin 候補） */
function buildCandidates(): {
  label: string
  sub: string
  session: AuthSession
}[] {
  const users = loadUsers()
  const orgs = loadOrganizations()
  const members = loadOrganizationMembers()

  const list: { label: string; sub: string; session: AuthSession }[] = []
  for (const u of Object.values(users)) {
    if (u.systemRole === 'super_admin') {
      list.push({
        label: u.displayName,
        sub: 'スーパーアドミン',
        session: { kind: 'admin', userId: u.id },
      })
    }
    const userMems = Object.values(members).filter((m) => m.userId === u.id)
    for (const m of userMems) {
      const o = orgs[m.organizationId]
      if (!o) continue
      const roleLabel = m.role === 'editor' ? '編集メンバー' : '確認者'
      list.push({
        label: u.displayName,
        sub: `${roleLabel} ・ ${o.name}`,
        session: { kind: 'tenant', userId: u.id, organizationId: o.id },
      })
    }
  }
  return list
}

/** 補助: AppUser / Organization の取得（DEV ツール用） */
export function getCurrentTenantInfo() {
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
