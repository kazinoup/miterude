import { useEffect, useRef, useState } from 'react'
import { X, Copy, RefreshCw, ShieldCheck, ShieldOff } from 'lucide-react'
import type {
  ManufacturerIntegration,
  SensorKind,
} from '../types'
import { SENSOR_KIND_DEFS } from '../types'
import { generateNewSecret, generateWebhookUrl } from '../lib/notify'
import { toast } from '../lib/toast'

type Props = {
  open: boolean
  initial: ManufacturerIntegration | null
  onClose: () => void
  onSubmit: (i: ManufacturerIntegration) => void
}

export function ManufacturerIntegrationDialog({
  open,
  initial,
  onClose,
  onSubmit,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const [enabled, setEnabled] = useState(false)
  const [secret, setSecret] = useState<string | undefined>(undefined)
  const [showSecret, setShowSecret] = useState(false)
  const [kinds, setKinds] = useState<SensorKind[]>([])

  useEffect(() => {
    if (!open || !initial) return
    setEnabled(initial.enabled)
    setSecret(initial.webhookSecret)
    setShowSecret(false)
    setKinds([...initial.sensorKinds])
  }, [open, initial])

  useEffect(() => {
    const dlg = ref.current
    if (!dlg) return
    if (open && !dlg.open) dlg.showModal()
    if (!open && dlg.open) dlg.close()
  }, [open])

  if (!initial) return null

  const webhookUrl = generateWebhookUrl(initial)

  function copy(text: string, label: string) {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard
        .writeText(text)
        .then(() => toast(`${label} をコピーしました`, 'success'))
        .catch(() => toast(`${label} のコピーに失敗しました`, 'error'))
    }
  }

  function regenerateSecret() {
    if (!initial) return
    if (
      secret &&
      !confirm('シークレットを再発行すると、以前の値は無効になります。続けますか？')
    ) {
      return
    }
    setSecret(generateNewSecret(initial))
  }

  function toggleKind(k: SensorKind) {
    setKinds((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!initial) return
    onSubmit({
      ...initial,
      enabled,
      webhookSecret: enabled ? secret ?? generateNewSecret(initial) : secret,
      sensorKinds: kinds,
    })
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
          <h2>{initial.manufacturer} 連携</h2>
          <button type="button" className="icon-btn" aria-label="閉じる" onClick={onClose}>
            <X size={16} />
          </button>
        </header>

        <div className="app-dialog-body">
          <div className="integration-status">
            <label className="check-row">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              <span>
                <strong>{initial.manufacturer}</strong> との連携を有効にする
              </span>
            </label>
            <span className={`badge ${enabled ? 'badge-online' : 'badge-offline'}`}>
              {enabled ? (
                <>
                  <ShieldCheck size={11} strokeWidth={2.2} />
                  連携中
                </>
              ) : (
                <>
                  <ShieldOff size={11} strokeWidth={2.2} />
                  停止中
                </>
              )}
            </span>
          </div>

          <div className="form-row">
            <label className="form-label">Webhook 受信 URL</label>
            <div className="readonly-field">
              <input
                type="text"
                className="form-input mono-input"
                value={webhookUrl}
                readOnly
              />
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => copy(webhookUrl, 'Webhook URL')}
              >
                <Copy size={13} />
                <span>コピー</span>
              </button>
            </div>
            <small className="muted">
              {initial.manufacturer} の管理画面でこの URL を Webhook 送信先に設定してください。
            </small>
          </div>

          <div className="form-row">
            <div className="form-label-row">
              <label className="form-label">Webhook シークレット</label>
              <div className="form-label-actions">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setShowSecret((v) => !v)}
                  disabled={!secret}
                >
                  {showSecret ? '隠す' : '表示'}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={regenerateSecret}
                >
                  <RefreshCw size={13} />
                  <span>再発行</span>
                </button>
              </div>
            </div>
            <div className="readonly-field">
              <input
                type={showSecret ? 'text' : 'password'}
                className="form-input mono-input"
                value={secret ?? ''}
                placeholder="（未発行）"
                readOnly
              />
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => secret && copy(secret, 'シークレット')}
                disabled={!secret}
              >
                <Copy size={13} />
                <span>コピー</span>
              </button>
            </div>
          </div>

          <div className="form-row">
            <label className="form-label">取り扱うセンサー種別</label>
            <div className="kind-grid">
              {(Object.keys(SENSOR_KIND_DEFS) as SensorKind[]).map((k) => {
                const def = SENSOR_KIND_DEFS[k]
                const checked = kinds.includes(k)
                return (
                  <label
                    key={k}
                    className={`kind-card ${checked ? 'is-checked' : ''} ${
                      !def.supported ? 'is-future' : ''
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleKind(k)}
                    />
                    <div className="kind-card-text">
                      <strong>{def.label}</strong>
                      <small>{def.description}</small>
                      {!def.supported && (
                        <span className="kind-future-tag">対応予定</span>
                      )}
                    </div>
                  </label>
                )
              })}
            </div>
          </div>
        </div>

        <footer className="app-dialog-foot">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            キャンセル
          </button>
          <button type="submit" className="btn btn-primary">
            保存
          </button>
        </footer>
      </form>
    </dialog>
  )
}
