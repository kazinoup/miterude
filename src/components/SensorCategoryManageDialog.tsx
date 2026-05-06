import { useEffect, useRef, useState } from 'react'
import { X, Tags, Plus, Trash2, Pencil, Check } from 'lucide-react'
import type {
  CategoryIconKey,
  SensorCategory,
  SensorCategoryStore,
  SensorStore,
} from '../types'
import { CATEGORY_ICON_KEYS } from '../types'
import {
  CATEGORY_ICON_COMPONENTS,
  CATEGORY_ICON_LABELS,
  createCategory,
} from '../lib/categories'

type Props = {
  open: boolean
  categories: SensorCategoryStore
  sensors: SensorStore
  onClose: () => void
  onUpsert: (cat: SensorCategory) => void
  onDelete: (id: string) => void
}

function CategoryIcon({
  iconKey,
  size = 14,
}: {
  iconKey: CategoryIconKey
  size?: number
}) {
  const Cmp = CATEGORY_ICON_COMPONENTS[iconKey]
  return <Cmp size={size} strokeWidth={2.2} />
}

function IconPicker({
  value,
  onChange,
}: {
  value: CategoryIconKey
  onChange: (next: CategoryIconKey) => void
}) {
  return (
    <div className="icon-picker" role="radiogroup" aria-label="アイコンを選択">
      {CATEGORY_ICON_KEYS.map((key) => (
        <button
          key={key}
          type="button"
          className={`icon-picker-btn ${value === key ? 'is-active' : ''}`}
          aria-pressed={value === key}
          aria-label={CATEGORY_ICON_LABELS[key]}
          title={CATEGORY_ICON_LABELS[key]}
          onClick={() => onChange(key)}
        >
          <CategoryIcon iconKey={key} size={16} />
        </button>
      ))}
    </div>
  )
}

export function SensorCategoryManageDialog({
  open,
  categories,
  sensors,
  onClose,
  onUpsert,
  onDelete,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const [newName, setNewName] = useState('')
  const [newIcon, setNewIcon] = useState<CategoryIconKey>('tag')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editIcon, setEditIcon] = useState<CategoryIconKey>('tag')

  useEffect(() => {
    if (!open) return
    setNewName('')
    setNewIcon('tag')
    setEditingId(null)
    setEditName('')
    setEditIcon('tag')
  }, [open])

  useEffect(() => {
    const dlg = ref.current
    if (!dlg) return
    if (open && !dlg.open) dlg.showModal()
    if (!open && dlg.open) dlg.close()
  }, [open])

  const list = Object.values(categories).sort((a, b) =>
    a.name.localeCompare(b.name),
  )
  const counts = new Map<string, number>()
  for (const s of Object.values(sensors)) {
    if (s.categoryId) counts.set(s.categoryId, (counts.get(s.categoryId) ?? 0) + 1)
  }

  function handleAdd(e?: React.FormEvent | React.MouseEvent) {
    e?.preventDefault()
    const trimmed = newName.trim()
    if (!trimmed) return
    onUpsert(createCategory({ name: trimmed, icon: newIcon }))
    setNewName('')
    setNewIcon('tag')
  }

  function startEdit(c: SensorCategory) {
    setEditingId(c.id)
    setEditName(c.name)
    setEditIcon(c.icon)
  }

  function commitEdit() {
    if (!editingId) return
    const cur = categories[editingId]
    if (!cur) return
    const trimmed = editName.trim()
    if (!trimmed) return
    onUpsert({ ...cur, name: trimmed, icon: editIcon })
    setEditingId(null)
    setEditName('')
    setEditIcon('tag')
  }

  function handleDelete(c: SensorCategory) {
    const used = counts.get(c.id) ?? 0
    if (used > 0) {
      if (
        !confirm(
          `「${c.name}」には ${used} 台のセンサーが所属しています。区分を削除すると、それらは「未設定」になります。続けますか？`,
        )
      )
        return
    } else {
      if (!confirm(`区分「${c.name}」を削除しますか？`)) return
    }
    onDelete(c.id)
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
      <div className="app-dialog-form">
        <header className="app-dialog-head">
          <h2>
            <Tags size={16} className="head-icon" />
            区分管理
          </h2>
          <button type="button" className="icon-btn" aria-label="閉じる" onClick={onClose}>
            <X size={16} />
          </button>
        </header>

        <div className="app-dialog-body">
          <p className="muted in-panel">
            区分は「センサー 1 台 = 1 区分」のユーザー定義の分類軸です。
            アイコンを選んでおくとダッシュボードや一覧での見分けがつきやすくなります。
          </p>

          <div className="category-add-block">
            <div className="category-add-row">
              <input
                type="text"
                className="form-input"
                placeholder="新しい区分名（例: 食材庫 / ワインセラー）"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                    e.preventDefault()
                    handleAdd()
                  }
                }}
                maxLength={40}
              />
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={handleAdd}
                disabled={!newName.trim()}
              >
                <Plus size={14} />
                <span>追加</span>
              </button>
            </div>
            <div className="category-add-icons">
              <span className="classify-label">アイコン</span>
              <IconPicker value={newIcon} onChange={setNewIcon} />
            </div>
          </div>

          {list.length === 0 ? (
            <p className="muted in-panel">まだ区分がありません。</p>
          ) : (
            <ul className="category-manage-list">
              {list.map((c) => {
                const used = counts.get(c.id) ?? 0
                const editing = editingId === c.id
                return (
                  <li key={c.id} className="category-manage-item">
                    {editing ? (
                      <>
                        <div className="category-edit-main">
                          <input
                            type="text"
                            className="form-input"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                                e.preventDefault()
                                commitEdit()
                              } else if (
                                e.key === 'Escape' &&
                                !e.nativeEvent.isComposing
                              ) {
                                setEditingId(null)
                              }
                            }}
                            autoFocus
                          />
                          <IconPicker value={editIcon} onChange={setEditIcon} />
                        </div>
                        <span className="muted">{used} 台</span>
                        <button
                          type="button"
                          className="icon-btn"
                          aria-label="保存"
                          onClick={commitEdit}
                        >
                          <Check size={14} />
                        </button>
                        <button
                          type="button"
                          className="icon-btn icon-btn-danger"
                          aria-label="削除"
                          onClick={() => handleDelete(c)}
                        >
                          <Trash2 size={14} />
                        </button>
                      </>
                    ) : (
                      <>
                        <span className="category-manage-icon">
                          <CategoryIcon iconKey={c.icon} size={14} />
                        </span>
                        <span className="category-manage-name">{c.name}</span>
                        <span className="muted">{used} 台</span>
                        <button
                          type="button"
                          className="icon-btn"
                          aria-label="編集"
                          onClick={() => startEdit(c)}
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          type="button"
                          className="icon-btn icon-btn-danger"
                          aria-label="削除"
                          onClick={() => handleDelete(c)}
                        >
                          <Trash2 size={14} />
                        </button>
                      </>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <footer className="app-dialog-foot">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            閉じる
          </button>
        </footer>
      </div>
    </dialog>
  )
}
