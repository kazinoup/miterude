import { useSyncExternalStore } from 'react'
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react'
import { dismissToast, getToasts, subscribe, type ToastKind } from '../lib/toast'

function iconFor(kind: ToastKind) {
  if (kind === 'success') return <CheckCircle2 size={16} />
  if (kind === 'error') return <AlertCircle size={16} />
  return <Info size={16} />
}

export function ToastContainer() {
  const items = useSyncExternalStore(subscribe, getToasts, getToasts)

  if (items.length === 0) return null

  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`}>
          <span className="toast-icon">{iconFor(t.kind)}</span>
          <span className="toast-msg">{t.message}</span>
          <button
            type="button"
            className="toast-close"
            aria-label="閉じる"
            onClick={() => dismissToast(t.id)}
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}
