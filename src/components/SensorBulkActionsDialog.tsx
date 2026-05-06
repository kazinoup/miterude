import { useEffect, useRef, useState } from 'react'
import { X, Tag, Folder, Tags, Trash2 } from 'lucide-react'
import type { SensorCategoryStore, SensorGroupStore } from '../types'
import { normalizeTag } from '../lib/groups'

type Action =
  | { kind: 'tag-add'; tags: string[] }
  | { kind: 'tag-remove'; tags: string[] }
  | { kind: 'group-set'; groupId: string | null }
  | { kind: 'category-set'; categoryId: string | null }

type Props = {
  open: boolean
  selectedCount: number
  groups: SensorGroupStore
  categories: SensorCategoryStore
  /** 既存タグの候補（オートコンプリート） */
  existingTags: string[]
  onClose: () => void
  onApply: (action: Action) => void
}

type Mode = 'tag-add' | 'tag-remove' | 'group-set' | 'category-set'

export function SensorBulkActionsDialog({
  open,
  selectedCount,
  groups,
  categories,
  existingTags,
  onClose,
  onApply,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const [mode, setMode] = useState<Mode>('tag-add')
  const [tagsInput, setTagsInput] = useState('')
  const [groupId, setGroupId] = useState<string>('')
  const [categoryId, setCategoryId] = useState<string>('')

  useEffect(() => {
    if (!open) return
    setMode('tag-add')
    setTagsInput('')
    setGroupId('')
    setCategoryId('')
  }, [open])

  useEffect(() => {
    const dlg = ref.current
    if (!dlg) return
    if (open && !dlg.open) dlg.showModal()
    if (!open && dlg.open) dlg.close()
  }, [open])

  function parseTags(input: string): string[] {
    return input
      .split(/[,\s、]+/g)
      .map(normalizeTag)
      .filter(Boolean)
  }

  function handleApply() {
    if (mode === 'tag-add' || mode === 'tag-remove') {
      const tags = parseTags(tagsInput)
      if (tags.length === 0) {
        alert('タグを入力してください。')
        return
      }
      onApply({ kind: mode, tags })
    } else if (mode === 'group-set') {
      onApply({ kind: 'group-set', groupId: groupId || null })
    } else {
      onApply({ kind: 'category-set', categoryId: categoryId || null })
    }
  }

  const groupList = Object.values(groups).sort((a, b) => a.name.localeCompare(b.name))
  const categoryList = Object.values(categories).sort((a, b) =>
    a.name.localeCompare(b.name),
  )

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
      <div className="app-dialog-form">
        <header className="app-dialog-head">
          <h2>選択した {selectedCount} 台に一括操作</h2>
          <button type="button" className="icon-btn" aria-label="閉じる" onClick={onClose}>
            <X size={16} />
          </button>
        </header>

        <div className="app-dialog-body">
          <div className="form-row">
            <label className="form-label">操作</label>
            <div className="seg-toggle">
              <button
                type="button"
                className={`seg-toggle-btn ${mode === 'tag-add' ? 'is-active' : ''}`}
                onClick={() => setMode('tag-add')}
              >
                <Tag size={13} /> タグ付与
              </button>
              <button
                type="button"
                className={`seg-toggle-btn ${mode === 'tag-remove' ? 'is-active' : ''}`}
                onClick={() => setMode('tag-remove')}
              >
                <Trash2 size={13} /> タグ削除
              </button>
              <button
                type="button"
                className={`seg-toggle-btn ${mode === 'group-set' ? 'is-active' : ''}`}
                onClick={() => setMode('group-set')}
              >
                <Folder size={13} /> グループ移動
              </button>
              <button
                type="button"
                className={`seg-toggle-btn ${mode === 'category-set' ? 'is-active' : ''}`}
                onClick={() => setMode('category-set')}
              >
                <Tags size={13} /> 区分変更
              </button>
            </div>
          </div>

          {(mode === 'tag-add' || mode === 'tag-remove') && (
            <div className="form-row">
              <label className="form-label" htmlFor="bulk-tags">
                タグ（複数可。スペース・カンマ区切り）
              </label>
              <input
                id="bulk-tags"
                type="text"
                className="form-input"
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
                placeholder="例: 冷凍 重要 肉"
                autoFocus
                list="bulk-tag-suggest"
              />
              <datalist id="bulk-tag-suggest">
                {existingTags.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
              {existingTags.length > 0 && (
                <p className="form-hint muted">
                  既存タグ: {existingTags.slice(0, 12).join(', ')}
                  {existingTags.length > 12 ? ' …' : ''}
                </p>
              )}
            </div>
          )}

          {mode === 'group-set' && (
            <div className="form-row">
              <label className="form-label" htmlFor="bulk-group">
                所属グループ
              </label>
              <select
                id="bulk-group"
                className="select"
                value={groupId}
                onChange={(e) => setGroupId(e.target.value)}
                autoFocus
              >
                <option value="">未分類（グループから外す）</option>
                {groupList.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {mode === 'category-set' && (
            <div className="form-row">
              <label className="form-label" htmlFor="bulk-category">
                区分
              </label>
              <select
                id="bulk-category"
                className="select"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                autoFocus
              >
                <option value="">未設定（区分を外す）</option>
                {categoryList.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <footer className="app-dialog-foot">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            キャンセル
          </button>
          <button type="button" className="btn btn-primary" onClick={handleApply}>
            適用
          </button>
        </footer>
      </div>
    </dialog>
  )
}
