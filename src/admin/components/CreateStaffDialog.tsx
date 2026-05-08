/**
 * Phase A-5: 新規 support スタッフ作成ダイアログ。
 *
 * - displayName / email を入力
 * - systemRole は 'support' 固定（super_admin は別途）
 * - email 重複チェック
 */
import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import {
  loadUsers,
  newId,
  saveUsers,
  upsertUser,
} from '../lib/adminStorage'
import { toast } from '../../lib/toast'
import type { AppUser } from '../../types'

type Props = {
  onClose: () => void
  onCreated: (userId: string) => void
}

export function CreateStaffDialog({ onClose, onCreated }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')

  useEffect(() => {
    const dlg = ref.current
    if (!dlg) return
    if (!dlg.open) dlg.showModal()
    return () => {
      if (dlg.open) dlg.close()
    }
  }, [])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmedName = displayName.trim()
    const trimmedEmail = email.trim().toLowerCase()
    if (!trimmedName) {
      alert('名前を入力してください。')
      return
    }
    if (!trimmedEmail || !trimmedEmail.includes('@')) {
      alert('有効なメールアドレスを入力してください。')
      return
    }

    const users = loadUsers()
    const dup = Object.values(users).find(
      (u) => u.email.toLowerCase() === trimmedEmail,
    )
    if (dup) {
      alert(
        `メールアドレス「${trimmedEmail}」は既に「${dup.displayName}」で使われています。`,
      )
      return
    }

    const id = newId('user')
    const u: AppUser = {
      id,
      email: trimmedEmail,
      displayName: trimmedName,
      systemRole: 'support',
      createdAt: new Date(),
    }
    saveUsers(upsertUser(users, u))
    toast(`スタッフ「${trimmedName}」を追加しました`, 'success')
    onCreated(id)
  }

  return (
    <dialog
      ref={ref}
      className="app-dialog"
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onClose={onClose}
    >
      <form className="app-dialog-form" onSubmit={handleSubmit}>
        <header className="app-dialog-head">
          <h2>スタッフ追加</h2>
          <button
            type="button"
            className="icon-btn"
            aria-label="閉じる"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </header>

        <div className="app-dialog-body">
          <div className="form-row">
            <label className="form-label" htmlFor="staff-name">
              名前
            </label>
            <input
              id="staff-name"
              className="form-input"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              autoFocus
              placeholder="例: 鈴木 サポート"
            />
          </div>

          <div className="form-row">
            <label className="form-label" htmlFor="staff-email">
              メールアドレス
            </label>
            <input
              id="staff-email"
              className="form-input mono"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="suzuki@example.com"
            />
            <p className="form-help">
              ロールは <code>support</code> 固定です。Clerk 統合後は招待メールでアカウントが発行されます。
            </p>
          </div>
        </div>

        <footer className="app-dialog-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            キャンセル
          </button>
          <button type="submit" className="btn btn-primary">
            追加
          </button>
        </footer>
      </form>
    </dialog>
  )
}
