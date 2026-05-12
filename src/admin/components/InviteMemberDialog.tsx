/**
 * Phase J: テナントメンバー招待ダイアログ。
 *
 * - email / displayName / role を入力して「招待」（モックなのでメール送信は無し）
 * - email が既存ユーザーに一致するときは既存 user を再利用する
 * - 新規 user は users に INSERT、organization_members も INSERT
 * - 監査ログを 1 件残す
 */
import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import {
  loadOrganizationMembers,
  loadUsers,
  newId,
  saveOrganizationMembers,
  saveUsers,
  upsertOrganizationMember,
  upsertUser,
  logStaffAction,
} from '../lib/adminStorage'
import { toast } from '../../lib/toast'
import {
  upsertMemberInSupabase,
  upsertUserInSupabase,
} from '../../lib/supabaseQueries'
import { isSupabaseConfigured } from '../../lib/supabase'
import type {
  AppUser,
  Organization,
  OrganizationMember,
  TenantRole,
} from '../../types'

type Props = {
  org: Organization
  adminUserId: string
  onClose: () => void
  onCreated: () => void
}

export function InviteMemberDialog({ org, adminUserId, onClose, onCreated }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [role, setRole] = useState<TenantRole>('editor')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    const dlg = ref.current
    if (!dlg) return
    if (!dlg.open) dlg.showModal()
    // StrictMode の二重マウントで cleanup の dlg.close() が onClose を発火し
    // setOpen(false) させてしまう問題を避けるため、明示 close はしない。
    // 親が conditional rendering を false にすれば DOM ごと外れる。
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (submitting) return
    const trimmedEmail = email.trim().toLowerCase()
    const trimmedName = displayName.trim()
    if (!trimmedEmail || !trimmedEmail.includes('@')) {
      alert('有効なメールアドレスを入力してください。')
      return
    }
    if (!trimmedName) {
      alert('表示名を入力してください。')
      return
    }

    const usersStore = loadUsers()
    const membersStore = loadOrganizationMembers()

    // 既存ユーザーを email で探す
    let existing: AppUser | undefined = Object.values(usersStore).find(
      (u) => u.email.toLowerCase() === trimmedEmail,
    )
    // 既にこのテナントに居れば中止
    if (existing) {
      const dup = Object.values(membersStore).find(
        (m) => m.userId === existing!.id && m.organizationId === org.id,
      )
      if (dup) {
        alert('このユーザーは既にこのテナントのメンバーです。')
        return
      }
    }

    const user: AppUser =
      existing ?? {
        id: newId('user'),
        email: trimmedEmail,
        displayName: trimmedName,
        createdAt: new Date(),
      }

    // 表示名は招待時に編集することもあるので、既存ユーザーでも上書きする
    if (existing) user.displayName = trimmedName

    const member: OrganizationMember = {
      id: newId('mem'),
      organizationId: org.id,
      userId: user.id,
      role,
      invitedAt: new Date(),
    }

    setSubmitting(true)
    try {
      if (isSupabaseConfigured()) {
        await upsertUserInSupabase(user)
        await upsertMemberInSupabase(member)
      }
      saveUsers(upsertUser(usersStore, user))
      saveOrganizationMembers(upsertOrganizationMember(membersStore, member))
      logStaffAction({
        staffUserId: adminUserId,
        organizationId: org.id,
        action: 'member.invite',
        targetTable: 'organization_members',
        targetId: member.id,
        metadata: { email: user.email, displayName: user.displayName, role },
      })
      toast(`「${trimmedName}」をテナントに招待しました`, 'success')
      onCreated()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      toast(`メンバー招待に失敗: ${msg.slice(0, 100)}`, 'error')
    } finally {
      setSubmitting(false)
    }
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
          <h2>メンバーを招待</h2>
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
          <p className="muted in-panel">
            「{org.name}」にメンバーを追加します。モック環境では実際のメール送信は
            行いません。メールアドレスが既存ユーザーと一致する場合は再利用します。
          </p>

          <div className="form-row">
            <label className="form-label" htmlFor="invite-email">
              メールアドレス
            </label>
            <input
              id="invite-email"
              className="form-input mono"
              type="email"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="例: yamada@example.com"
            />
          </div>

          <div className="form-row">
            <label className="form-label" htmlFor="invite-name">
              表示名
            </label>
            <input
              id="invite-name"
              className="form-input"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="例: 山田 花子"
            />
          </div>

          <div className="form-row">
            <label className="form-label" htmlFor="invite-role">
              ロール
            </label>
            <select
              id="invite-role"
              className="select"
              value={role}
              onChange={(e) => setRole(e.target.value as TenantRole)}
            >
              <option value="editor">編集メンバー（テナント全機能を操作可）</option>
              <option value="dashboard_confirmer">
                確認者（ダッシュボード確認 + 運用メモ のみ）
              </option>
            </select>
          </div>
        </div>

        <footer className="app-dialog-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            キャンセル
          </button>
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? '保存中...' : '招待'}
          </button>
        </footer>
      </form>
    </dialog>
  )
}
