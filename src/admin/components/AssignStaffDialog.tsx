/**
 * Phase J: テナント詳細から「このテナントを担当するサポートスタッフ」を割り当てるダイアログ。
 *
 * AssignTenantDialog の逆方向: あるテナントに対して staff を選び、StaffAssignment を作る。
 * - スタッフ選択（systemRole='support'）
 * - 理由 + 有効期限
 * - Supabase + localStorage に書き込み + 監査ログ
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import {
  loadStaffAssignments,
  loadUsers,
  logStaffAction,
  newId,
  saveStaffAssignments,
  upsertStaffAssignment,
} from '../lib/adminStorage'
import { toast } from '../../lib/toast'
import { upsertStaffAssignmentInSupabase } from '../../lib/supabaseQueries'
import { isSupabaseConfigured } from '../../lib/supabase'
import type { AppUser, Organization, StaffAssignment } from '../../types'

type Props = {
  org: Organization
  /** 監査ログ用: 割り当てを発行する側（admin）の userId */
  grantedByUserId: string
  /** 既に有効な割り当てを持つ staff の userId 群（重複防止） */
  alreadyAssignedStaffIds: string[]
  onClose: () => void
  onCreated: () => void
}

function defaultExpiryLocal(): string {
  // 既定: 翌日 23:59
  const d = new Date()
  d.setDate(d.getDate() + 1)
  d.setHours(23, 59, 0, 0)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function AssignStaffDialog({
  org,
  grantedByUserId,
  alreadyAssignedStaffIds,
  onClose,
  onCreated,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null)

  const candidates: AppUser[] = useMemo(() => {
    const users = loadUsers()
    return Object.values(users)
      .filter((u) => u.systemRole === 'support' && !alreadyAssignedStaffIds.includes(u.id))
      .sort((a, b) => a.displayName.localeCompare(b.displayName, 'ja'))
  }, [alreadyAssignedStaffIds])

  const [staffUserId, setStaffUserId] = useState<string>(candidates[0]?.id ?? '')
  const [reason, setReason] = useState('')
  const [expiry, setExpiry] = useState<string>(defaultExpiryLocal())
  const [noExpiry, setNoExpiry] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    const dlg = ref.current
    if (!dlg) return
    if (!dlg.open) dlg.showModal()
    // StrictMode 二重マウントの cleanup-close 回避のため明示 close はしない
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (submitting) return
    if (!staffUserId) {
      alert('割り当てるスタッフを選択してください。')
      return
    }
    if (!reason.trim()) {
      alert('理由を入力してください（監査ログに記録します）。')
      return
    }
    let expiresAt: Date | undefined
    if (!noExpiry) {
      if (!expiry) {
        alert('有効期限を入力してください。')
        return
      }
      const d = new Date(expiry)
      if (Number.isNaN(d.getTime())) {
        alert('有効期限の日付が不正です。')
        return
      }
      if (d.getTime() <= Date.now()) {
        alert('有効期限は未来の時刻を指定してください。')
        return
      }
      expiresAt = d
    }

    const a: StaffAssignment = {
      id: newId('asg'),
      staffUserId,
      organizationId: org.id,
      grantedByUserId,
      grantedAt: new Date(),
      expiresAt,
      notes: reason.trim(),
    }

    setSubmitting(true)
    try {
      if (isSupabaseConfigured()) {
        await upsertStaffAssignmentInSupabase(a)
      }
      const store = loadStaffAssignments()
      saveStaffAssignments(upsertStaffAssignment(store, a))
      logStaffAction({
        staffUserId: grantedByUserId,
        organizationId: org.id,
        action: 'assignment_granted',
        targetTable: 'staff_assignments',
        targetId: a.id,
        metadata: {
          toStaffUserId: staffUserId,
          reason: a.notes,
          expiresAt: expiresAt?.toISOString() ?? null,
        },
      })
      toast('サポート割り当てを追加しました', 'success')
      onCreated()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      toast(`サポート割り当ての保存に失敗: ${msg.slice(0, 100)}`, 'error')
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
          <h2>サポート割り当てを追加</h2>
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
            「{org.name}」を担当するサポートスタッフを選び、有効期限付きでテナントへのアクセス権を付与します。
          </p>

          <div className="form-row">
            <label className="form-label" htmlFor="assign-staff">
              スタッフ
            </label>
            {candidates.length === 0 ? (
              <p className="muted in-panel">
                割り当て可能な support スタッフがありません。「スタッフ」ページから追加してください。
              </p>
            ) : (
              <select
                id="assign-staff"
                className="select"
                value={staffUserId}
                onChange={(e) => setStaffUserId(e.target.value)}
              >
                {candidates.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.displayName} ({u.email})
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="form-row">
            <label className="form-label" htmlFor="assign-reason">
              理由
            </label>
            <textarea
              id="assign-reason"
              className="form-input"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="例: 12 月の障害対応サポート"
            />
            <p className="form-help">
              監査ログに残ります（顧客への説明可能性の確保）。
            </p>
          </div>

          <div className="form-row">
            <label className="form-label">有効期限</label>
            <label className="form-checkbox">
              <input
                type="checkbox"
                checked={noExpiry}
                onChange={(e) => setNoExpiry(e.target.checked)}
              />
              <span>無期限（手動で取り消すまで有効）</span>
            </label>
            {!noExpiry && (
              <input
                className="form-input mono"
                type="datetime-local"
                value={expiry}
                onChange={(e) => setExpiry(e.target.value)}
              />
            )}
          </div>
        </div>

        <footer className="app-dialog-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            キャンセル
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={submitting || candidates.length === 0}
          >
            {submitting ? '保存中...' : '割り当てる'}
          </button>
        </footer>
      </form>
    </dialog>
  )
}
