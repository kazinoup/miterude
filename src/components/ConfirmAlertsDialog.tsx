/**
 * アラート確認ダイアログ — Phase 1.9
 *
 * 1 件 / 複数件のアラートに対して、確認コメントを入力して「確認」する。
 * 確認後は alert_logs.confirm_comment / confirmed_by / confirmed_at に書き込まれる。
 */
import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, X } from 'lucide-react'

type Props = {
  open: boolean
  targetCount: number
  /** 「井上 太郎」など、confirmed_by として記録する表示名 */
  confirmerName: string
  busy?: boolean
  onClose: () => void
  onSubmit: (comment: string) => void
}

export function ConfirmAlertsDialog({
  open,
  targetCount,
  confirmerName,
  busy,
  onClose,
  onSubmit,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const [comment, setComment] = useState('')

  useEffect(() => {
    if (!open) return
    setComment('')
  }, [open])

  useEffect(() => {
    const dlg = ref.current
    if (!dlg) return
    if (open && !dlg.open) dlg.showModal()
    if (!open && dlg.open) dlg.close()
  }, [open])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    onSubmit(comment.trim())
  }

  return (
    <dialog
      ref={ref}
      className="app-dialog app-dialog-sm"
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onClose={onClose}
    >
      <form className="app-dialog-form" onSubmit={handleSubmit}>
        <header className="app-dialog-head">
          <h2>
            <CheckCircle2 size={16} className="inline-icon" />
            {targetCount === 1
              ? 'アラートを確認'
              : `${targetCount} 件のアラートを確認`}
          </h2>
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
          <p className="muted">
            {confirmerName} さんとして確認します。コメント（対応内容や原因など）を任意で残せます。
          </p>
          <div className="form-row">
            <label className="form-label" htmlFor="alert-confirm-comment">
              確認コメント（任意・最大 500 文字）
            </label>
            <textarea
              id="alert-confirm-comment"
              className="form-input form-textarea"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="例: 一時的なドア開放を確認。在庫に影響なし。"
              maxLength={500}
              rows={4}
              autoFocus
            />
          </div>
        </div>

        <footer className="app-dialog-foot">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
            disabled={busy}
          >
            キャンセル
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            <CheckCircle2 size={14} />
            <span>{busy ? '確認中…' : '確認する'}</span>
          </button>
        </footer>
      </form>
    </dialog>
  )
}
