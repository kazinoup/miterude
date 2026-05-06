import { useEffect, useRef, useState } from 'react'
import { X, Plus, Trash2, Mail, MessageSquare, Webhook } from 'lucide-react'
import type {
  NotificationChannel,
  NotificationChannelKind,
  NotificationGroup,
  NotificationTiming,
} from '../types'
import { NOTIFICATION_TIMING_SHORT_LABELS } from '../types'
import { createChannel, createNotificationGroup } from '../lib/notify'

type Props = {
  open: boolean
  initial: NotificationGroup | null
  onClose: () => void
  onSubmit: (group: NotificationGroup) => void
  onDelete?: (id: string) => void
}

const TIMINGS: NotificationTiming[] = [
  'immediate',
  'batch-1h',
  'batch-6h',
  'batch-12h',
  'batch-24h',
]

const CHANNEL_KIND_LABEL: Record<NotificationChannelKind, string> = {
  email: 'メール',
  slack: 'Slack',
  webhook: 'Webhook',
}

function ChannelIcon({ kind }: { kind: NotificationChannelKind }) {
  if (kind === 'email') return <Mail size={14} />
  if (kind === 'slack') return <MessageSquare size={14} />
  return <Webhook size={14} />
}

function placeholderFor(kind: NotificationChannelKind): string {
  if (kind === 'email') return 'name@example.com'
  if (kind === 'slack') return 'https://hooks.slack.com/services/...'
  return 'https://example.com/webhook'
}

export function NotificationGroupEditDialog({
  open,
  initial,
  onClose,
  onSubmit,
  onDelete,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [timing, setTiming] = useState<NotificationTiming>('immediate')
  const [channels, setChannels] = useState<NotificationChannel[]>([])

  useEffect(() => {
    if (!open) return
    if (initial) {
      setName(initial.name)
      setDescription(initial.description ?? '')
      setTiming(initial.timing)
      setChannels(initial.channels.map((c) => ({ ...c })))
    } else {
      setName('')
      setDescription('')
      setTiming('immediate')
      setChannels([createChannel('email')])
    }
  }, [open, initial])

  useEffect(() => {
    const dlg = ref.current
    if (!dlg) return
    if (open && !dlg.open) dlg.showModal()
    if (!open && dlg.open) dlg.close()
  }, [open])

  function addChannel(kind: NotificationChannelKind) {
    setChannels((prev) => [...prev, createChannel(kind)])
  }

  function updateChannel(id: string, patch: Partial<NotificationChannel>) {
    setChannels((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  }

  function removeChannel(id: string) {
    setChannels((prev) => prev.filter((c) => c.id !== id))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      alert('グループ名を入力してください。')
      return
    }
    const cleanedChannels = channels
      .map((c) => ({ ...c, target: c.target.trim() }))
      .filter((c) => c.target.length > 0)

    if (initial) {
      onSubmit({
        ...initial,
        name: trimmed,
        description: description.trim() || undefined,
        timing,
        channels: cleanedChannels,
      })
    } else {
      onSubmit(
        createNotificationGroup({
          name: trimmed,
          description: description.trim() || undefined,
          timing,
          channels: cleanedChannels,
        }),
      )
    }
  }

  function handleDelete() {
    if (!initial || !onDelete) return
    if (!confirm(`通知グループ「${initial.name}」を削除しますか？`)) return
    onDelete(initial.id)
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
          <h2>{initial ? '通知グループを編集' : '通知グループを作成'}</h2>
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
            <label className="form-label" htmlFor="ng-name">
              グループ名
            </label>
            <input
              id="ng-name"
              type="text"
              className="form-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例: 即時通知（運用チーム）"
              maxLength={60}
              required
              autoFocus
            />
          </div>

          <div className="form-row">
            <label className="form-label" htmlFor="ng-desc">
              説明（任意）
            </label>
            <textarea
              id="ng-desc"
              className="form-input form-textarea"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="このグループの用途のメモ"
              maxLength={200}
              rows={2}
            />
          </div>

          <div className="form-row">
            <label className="form-label">送信タイミング</label>
            <p className="form-hint muted">
              即時通知以外を選んだ場合、指定された時間にまとめて通知します。
            </p>
            <div className="timing-list">
              {TIMINGS.map((t) => (
                <label key={t} className="radio-card">
                  <input
                    type="radio"
                    name="timing"
                    value={t}
                    checked={timing === t}
                    onChange={() => setTiming(t)}
                  />
                  <span className="radio-card-text">{NOTIFICATION_TIMING_SHORT_LABELS[t]}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="form-row">
            <div className="form-label-row">
              <label className="form-label">送信先</label>
              <div className="form-label-actions">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => addChannel('email')}
                >
                  <Mail size={13} />
                  <span>メール追加</span>
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => addChannel('slack')}
                >
                  <MessageSquare size={13} />
                  <span>Slack 追加</span>
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => addChannel('webhook')}
                >
                  <Webhook size={13} />
                  <span>Webhook 追加</span>
                </button>
              </div>
            </div>

            {channels.length === 0 ? (
              <p className="muted">送信先を 1 件以上追加してください。</p>
            ) : (
              <ul className="channel-list">
                {channels.map((c) => (
                  <li key={c.id} className="channel-row">
                    <span className="channel-kind-label">
                      <ChannelIcon kind={c.kind} />
                      {CHANNEL_KIND_LABEL[c.kind]}
                    </span>
                    <input
                      type={c.kind === 'email' ? 'email' : 'url'}
                      className="form-input"
                      value={c.target}
                      onChange={(e) => updateChannel(c.id, { target: e.target.value })}
                      placeholder={placeholderFor(c.kind)}
                    />
                    <button
                      type="button"
                      className="icon-btn icon-btn-danger"
                      aria-label="削除"
                      onClick={() => removeChannel(c.id)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <footer className="app-dialog-foot dialog-foot-split">
          <div>
            {initial && onDelete && (
              <button
                type="button"
                className="btn btn-ghost btn-sm dialog-delete-btn"
                onClick={handleDelete}
              >
                <Trash2 size={14} />
                <span>このグループを削除</span>
              </button>
            )}
          </div>
          <div className="dialog-foot-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              キャンセル
            </button>
            <button type="submit" className="btn btn-primary">
              <Plus size={14} />
              <span>{initial ? '保存' : '作成'}</span>
            </button>
          </div>
        </footer>
      </form>
    </dialog>
  )
}
