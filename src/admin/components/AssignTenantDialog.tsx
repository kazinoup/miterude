/**
 * Phase A-5: スタッフへテナントを割り当てるダイアログ。
 *
 * - テナント選択 / 理由（必須）/ 有効期限（既定: 翌日 00:00）
 * - StaffAssignment を localStorage に追加
 * - 監査ログ（assignment_granted）を記録
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import {
  loadOrganizations,
  loadStaffAssignments,
  logStaffAction,
  newId,
  saveStaffAssignments,
  upsertStaffAssignment,
} from '../lib/adminStorage'
import { toast } from '../../lib/toast'
import type { StaffAssignment } from '../../types'

type Props = {
  staffUserId: string
  /** 監査ログ用: 割り当てを発行する側（admin）の userId */
  grantedByUserId: string
  /** 既に割り当て済の orgId（重複追加を抑止） */
  alreadyAssignedOrgIds: string[]
  onClose: () => void
  onCreated: () => void
}

function defaultExpiryLocal(): string {
  // 既定: 翌日 23:59 に丸める（datetime-local の value 形式）
  const d = new Date()
  d.setDate(d.getDate() + 1)
  d.setHours(23, 59, 0, 0)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function AssignTenantDialog({
  staffUserId,
  grantedByUserId,
  alreadyAssignedOrgIds,
  onClose,
  onCreated,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null)

  const candidates = useMemo(() => {
    const orgs = loadOrganizations()
    return Object.values(orgs)
      .filter((o) => !alreadyAssignedOrgIds.includes(o.id))
      .sort((a, b) => a.name.localeCompare(b.name, 'ja'))
  }, [alreadyAssignedOrgIds])

  const [orgId, setOrgId] = useState<string>(candidates[0]?.id ?? '')
  const [reason, setReason] = useState('')
  const [expiry, setExpiry] = useState(defaultExpiryLocal())
  const [noExpiry, setNoExpiry] = useState(false)

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
    if (!orgId) {
      alert('割り当てるテナントを選択してください。')
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
      organizationId: orgId,
      grantedByUserId,
      grantedAt: new Date(),
      expiresAt,
      notes: reason.trim(),
    }
    const store = loadStaffAssignments()
    saveStaffAssignments(upsertStaffAssignment(store, a))
    logStaffAction({
      staffUserId: grantedByUserId,
      organizationId: orgId,
      action: 'assignment_granted',
      targetTable: 'staff_assignments',
      targetId: a.id,
      metadata: {
        toStaffUserId: staffUserId,
        reason: a.notes,
        expiresAt: expiresAt?.toISOString() ?? null,
      },
    })
    toast('割り当てを追加しました', 'success')
    onCreated()
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
          <h2>テナントへ割り当て</h2>
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
            <label className="form-label" htmlFor="assign-org">
              テナント
            </label>
            {candidates.length === 0 ? (
              <div className="readonly-field">
                すべてのテナントに割り当て済です。
              </div>
            ) : (
              <select
                id="assign-org"
                className="select"
                value={orgId}
                onChange={(e) => setOrgId(e.target.value)}
              >
                {candidates.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}（{o.slug}）
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
              placeholder="例: ダッシュボード表示の問い合わせ対応 (#1234)"
            />
            <p className="form-help">
              監査ログに記録されます。具体的な対応内容を残してください。
            </p>
          </div>

          <div className="form-row">
            <label className="form-label" htmlFor="assign-expiry">
              有効期限
            </label>
            <input
              id="assign-expiry"
              className="form-input"
              type="datetime-local"
              value={expiry}
              onChange={(e) => setExpiry(e.target.value)}
              disabled={noExpiry}
            />
            <label className="form-checkbox">
              <input
                type="checkbox"
                checked={noExpiry}
                onChange={(e) => setNoExpiry(e.target.checked)}
              />
              <span>無期限（推奨しない）</span>
            </label>
          </div>
        </div>

        <footer className="app-dialog-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            キャンセル
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={candidates.length === 0}
          >
            追加
          </button>
        </footer>
      </form>
    </dialog>
  )
}
