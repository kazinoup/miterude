import { useEffect, useRef, useState } from 'react'
import { X, Bookmark } from 'lucide-react'
import type { FilterConditions, SavedFilter } from '../types'
import { createSavedFilter } from '../lib/groups'

type Props = {
  open: boolean
  conditions: FilterConditions
  onClose: () => void
  onSubmit: (filter: SavedFilter) => void
}

export function SaveFilterDialog({ open, conditions, onClose, onSubmit }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  useEffect(() => {
    if (!open) return
    setName('')
    setDescription('')
  }, [open])

  useEffect(() => {
    const dlg = ref.current
    if (!dlg) return
    if (open && !dlg.open) dlg.showModal()
    if (!open && dlg.open) dlg.close()
  }, [open])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      alert('フィルタ名を入力してください。')
      return
    }
    onSubmit(
      createSavedFilter({
        name: trimmed,
        description: description.trim(),
        conditions,
      }),
    )
  }

  // 条件のサマリ生成
  const summary: string[] = []
  if (conditions.search) summary.push(`検索: "${conditions.search}"`)
  if (conditions.groupIds?.length) summary.push(`グループ: ${conditions.groupIds.length} 件`)
  if (conditions.tagsAnd?.length) summary.push(`タグ(AND): ${conditions.tagsAnd.join(', ')}`)
  if (conditions.tagsOr?.length) summary.push(`タグ(OR): ${conditions.tagsOr.join(', ')}`)

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
            <Bookmark size={16} className="head-icon" />
            この条件をフィルタとして保存
          </h2>
          <button type="button" className="icon-btn" aria-label="閉じる" onClick={onClose}>
            <X size={16} />
          </button>
        </header>
        <div className="app-dialog-body">
          <div className="form-row">
            <label className="form-label" htmlFor="flt-name">
              名前
            </label>
            <input
              id="flt-name"
              type="text"
              className="form-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例: 3F の冷凍庫"
              maxLength={50}
              autoFocus
              required
            />
          </div>
          <div className="form-row">
            <label className="form-label" htmlFor="flt-desc">
              説明（任意）
            </label>
            <textarea
              id="flt-desc"
              className="form-input form-textarea"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={200}
              rows={2}
            />
          </div>
          {summary.length > 0 && (
            <div className="form-row">
              <span className="form-label">保存される条件</span>
              <ul className="filter-summary">
                {summary.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <footer className="app-dialog-foot">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            キャンセル
          </button>
          <button type="submit" className="btn btn-primary">
            <Bookmark size={14} />
            <span>保存</span>
          </button>
        </footer>
      </form>
    </dialog>
  )
}
