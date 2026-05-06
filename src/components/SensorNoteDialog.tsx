import { useEffect, useRef, useState } from 'react'
import { X, Pencil } from 'lucide-react'
import type {
  Sensor,
  SensorNote,
  SensorNoteCategory,
  UserSession,
} from '../types'
import { SENSOR_NOTE_CATEGORY_LABELS } from '../types'
import { createSensorNote } from '../lib/records'

type Props = {
  open: boolean
  sensor: Sensor
  session: UserSession
  onClose: () => void
  onSubmit: (note: SensorNote) => void
}

const CATEGORIES: SensorNoteCategory[] = [
  'install',
  'move',
  'calibration',
  'maintenance',
  'config',
  'incident',
  'other',
]

export function SensorNoteDialog({
  open,
  sensor,
  session,
  onClose,
  onSubmit,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const [category, setCategory] = useState<SensorNoteCategory>('maintenance')
  const [body, setBody] = useState('')

  useEffect(() => {
    if (!open) return
    setCategory('maintenance')
    setBody('')
  }, [open])

  useEffect(() => {
    const dlg = ref.current
    if (!dlg) return
    if (open && !dlg.open) dlg.showModal()
    if (!open && dlg.open) dlg.close()
  }, [open])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = body.trim()
    if (!trimmed) {
      alert('メモ内容を入力してください。')
      return
    }
    const note = createSensorNote({
      sensor,
      user: session,
      body: trimmed,
      category,
    })
    onSubmit(note)
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
            <Pencil size={16} className="head-icon" />
            運用メモを追加
          </h2>
          <button type="button" className="icon-btn" aria-label="閉じる" onClick={onClose}>
            <X size={16} />
          </button>
        </header>

        <div className="app-dialog-body">
          <div className="checkin-meta">
            <div>
              <span className="checkin-meta-label">対象センサー</span>
              <strong>{sensor.id}</strong>
            </div>
            <div>
              <span className="checkin-meta-label">記録者</span>
              <strong>{session.userName}</strong>
            </div>
          </div>

          <div className="form-row">
            <label className="form-label">カテゴリ</label>
            <div className="note-category-grid">
              {CATEGORIES.map((c) => (
                <label key={c} className="radio-card">
                  <input
                    type="radio"
                    name="note-category"
                    value={c}
                    checked={category === c}
                    onChange={() => setCategory(c)}
                  />
                  <span className="radio-card-text">
                    {SENSOR_NOTE_CATEGORY_LABELS[c]}
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="form-row">
            <label className="form-label" htmlFor="note-body">
              メモ内容
            </label>
            <textarea
              id="note-body"
              className="form-input form-textarea"
              rows={4}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="例: 3F 冷蔵庫から 2F 冷蔵庫へ移設。設置位置は奥側の壁面中央。"
              maxLength={500}
              autoFocus
              required
            />
          </div>
        </div>

        <footer className="app-dialog-foot">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            キャンセル
          </button>
          <button type="submit" className="btn btn-primary">
            記録する
          </button>
        </footer>
      </form>
    </dialog>
  )
}
