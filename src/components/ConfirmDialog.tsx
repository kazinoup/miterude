import { useEffect, useRef } from 'react'
import { AlertTriangle, X } from 'lucide-react'

type Variant = 'default' | 'danger'

type Props = {
  open: boolean
  title: string
  message: React.ReactNode
  confirmLabel?: string
  cancelLabel?: string
  variant?: Variant
  onConfirm: () => void
  onCancel: () => void
}

/** 共通の確認モーダル（破壊的操作用）。
 *  ブラウザ標準の confirm() の代替。
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = '実行',
  cancelLabel = 'キャンセル',
  variant = 'default',
  onConfirm,
  onCancel,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dlg = ref.current
    if (!dlg) return
    if (open && !dlg.open) dlg.showModal()
    if (!open && dlg.open) dlg.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      className="app-dialog app-dialog-sm"
      onCancel={(e) => {
        e.preventDefault()
        onCancel()
      }}
      onClose={onCancel}
    >
      <div className="app-dialog-form">
        <header className="app-dialog-head">
          <h2>
            {variant === 'danger' && (
              <AlertTriangle size={16} className="head-icon cell-deviation" />
            )}
            {title}
          </h2>
          <button
            type="button"
            className="icon-btn"
            aria-label="閉じる"
            onClick={onCancel}
          >
            <X size={16} />
          </button>
        </header>

        <div className="app-dialog-body">
          <div className="confirm-message">{message}</div>
        </div>

        <footer className="app-dialog-foot">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`btn ${variant === 'danger' ? 'btn-danger' : 'btn-primary'}`}
            onClick={onConfirm}
            autoFocus
          >
            {confirmLabel}
          </button>
        </footer>
      </div>
    </dialog>
  )
}
