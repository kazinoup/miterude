import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, LogOut, UserCog } from 'lucide-react'
import type { UserSession } from '../types'
import type { AppRole } from '../lib/authClaims'
import { toast } from '../lib/toast'
import { useAuth } from '../lib/AuthProvider'
import { signOut } from '../lib/authSession'

type Props = {
  session: UserSession
  /** 後方互換のため残置（コンテキスト切り替えは UserMenu からは廃止）。
   *  AdminApp 等が引き続き渡しているが UserMenu 内では使わない。 */
  onSwitchContext?: () => void
}

/**
 * サインイン中のユーザー情報 + プロフィール変更 + ログアウト のみ提供。
 * Phase 1.5a で「コンテキスト切り替え」「モックのログイン切り替え」は撤去
 * （正式なログイン画面 /login が出来たため）。
 */
export function UserMenu({ session }: Props) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const [popoverPos, setPopoverPos] = useState<{ left: number; bottom: number } | null>(
    null,
  )

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      const t = e.target as Node
      if (wrapRef.current?.contains(t)) return
      if (popoverRef.current?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  // ポップオーバーをサイドバーの overflow:hidden に縛られないよう、
  // トリガー位置を実測して fixed 配置する。
  useLayoutEffect(() => {
    if (!open) {
      setPopoverPos(null)
      return
    }
    function recompute() {
      const trig = triggerRef.current
      if (!trig) return
      const r = trig.getBoundingClientRect()
      setPopoverPos({
        left: r.left,
        bottom: window.innerHeight - r.top + 6,
      })
    }
    recompute()
    window.addEventListener('resize', recompute)
    window.addEventListener('scroll', recompute, true)
    return () => {
      window.removeEventListener('resize', recompute)
      window.removeEventListener('scroll', recompute, true)
    }
  }, [open])

  const auth = useAuth()
  const initials = (session.userName.trim()[0] ?? '?').toUpperCase()

  // 現在の権限ラベル（claim の app_role 由来）
  const currentRoleLabel = useMemo(
    () => (open ? roleLabelFromAppRole(auth.appRole) : null),
    [open, auth.appRole],
  )

  function handleProfile() {
    setOpen(false)
    toast('プロフィール変更画面は Clerk 統合時に提供します', 'info')
  }
  function handleLogout() {
    setOpen(false)
    // β-2d-3: Supabase Auth サインアウト → /login
    void signOut().finally(() => {
      window.location.href = '/login'
    })
  }

  return (
    <div className="user-menu" ref={wrapRef}>
      <button
        ref={triggerRef}
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

      {open && popoverPos && createPortal(
        <div
          ref={popoverRef}
          className="user-menu-popover is-portal"
          role="menu"
          style={{ left: popoverPos.left, bottom: popoverPos.bottom }}
        >
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
          <button type="button" className="user-menu-item" onClick={handleLogout}>
            <LogOut size={14} />
            <span>ログアウト</span>
          </button>
        </div>,
        document.body,
      )}
    </div>
  )
}

/** app_role → 権限ラベル（claim 由来）。
 *  営業(sales)の細分は claim に無いため support は「サポート」に集約。 */
function roleLabelFromAppRole(role: AppRole): string | null {
  switch (role) {
    case 'super_admin':
      return 'システム管理者'
    case 'support':
      return 'サポート'
    case 'editor':
      return '編集メンバー'
    case 'dashboard_confirmer':
      return '確認者'
    default:
      return null
  }
}
