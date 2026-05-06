import { useEffect, useRef, useState } from 'react'
import { ChevronDown, LogOut, UserCog, Building2, Mail } from 'lucide-react'
import type { UserSession } from '../types'
import { toast } from '../lib/toast'

type Props = {
  session: UserSession
}

/** Clerk によるサインイン UI のモック。実装は不要のため、開閉と通知のみ。 */
export function UserMenu({ session }: Props) {
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

  function handleProfile() {
    setOpen(false)
    toast('プロフィール変更画面を開きます（Clerk）', 'info')
  }
  function handleLogout() {
    setOpen(false)
    toast('ログアウトしました（Clerk モック）', 'info')
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
            <div className="user-avatar user-avatar-lg" aria-hidden="true">
              {initials}
            </div>
            <div className="user-menu-meta">
              <span className="user-menu-name">{session.userName}</span>
              <span className="user-menu-email">
                <Mail size={11} />
                {session.email}
              </span>
              <span className="user-menu-org">
                <Building2 size={11} />
                {session.organizationName}
              </span>
            </div>
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
          <div className="user-menu-foot">
            <small>認証は Clerk で連携</small>
          </div>
        </div>
      )}
    </div>
  )
}
