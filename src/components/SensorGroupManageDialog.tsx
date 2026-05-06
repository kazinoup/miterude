import { useEffect, useRef, useState } from 'react'
import { X, Folder, Plus, Trash2, Pencil, Check } from 'lucide-react'
import type { SensorGroup, SensorGroupStore, SensorStore } from '../types'
import { createGroup } from '../lib/groups'

type Props = {
  open: boolean
  groups: SensorGroupStore
  sensors: SensorStore
  onClose: () => void
  onUpsert: (group: SensorGroup) => void
  onDelete: (id: string) => void
}

export function SensorGroupManageDialog({
  open,
  groups,
  sensors,
  onClose,
  onUpsert,
  onDelete,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')

  useEffect(() => {
    if (!open) return
    setNewName('')
    setEditingId(null)
    setEditName('')
  }, [open])

  useEffect(() => {
    const dlg = ref.current
    if (!dlg) return
    if (open && !dlg.open) dlg.showModal()
    if (!open && dlg.open) dlg.close()
  }, [open])

  const groupList = Object.values(groups).sort((a, b) => a.name.localeCompare(b.name))
  const counts = new Map<string, number>()
  for (const s of Object.values(sensors)) {
    if (s.groupId) counts.set(s.groupId, (counts.get(s.groupId) ?? 0) + 1)
  }

  function handleAdd(e?: React.FormEvent | React.MouseEvent) {
    e?.preventDefault()
    const trimmed = newName.trim()
    if (!trimmed) return
    onUpsert(createGroup({ name: trimmed }))
    setNewName('')
  }

  function startEdit(g: SensorGroup) {
    setEditingId(g.id)
    setEditName(g.name)
  }

  function commitEdit() {
    if (!editingId) return
    const cur = groups[editingId]
    if (!cur) return
    const trimmed = editName.trim()
    if (!trimmed) return
    onUpsert({ ...cur, name: trimmed })
    setEditingId(null)
    setEditName('')
  }

  function handleDelete(g: SensorGroup) {
    const used = counts.get(g.id) ?? 0
    if (used > 0) {
      if (
        !confirm(
          `「${g.name}」には ${used} 台のセンサーが所属しています。グループを削除すると、それらは「未分類」になります。続けますか？`,
        )
      )
        return
    } else {
      if (!confirm(`グループ「${g.name}」を削除しますか？`)) return
    }
    onDelete(g.id)
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
      <div className="app-dialog-form">
        <header className="app-dialog-head">
          <h2>
            <Folder size={16} className="head-icon" />
            グループ管理
          </h2>
          <button type="button" className="icon-btn" aria-label="閉じる" onClick={onClose}>
            <X size={16} />
          </button>
        </header>

        <div className="app-dialog-body">
          <div className="group-add-row">
            <input
              type="text"
              className="form-input"
              placeholder="新しいグループ名(例: 1F)"
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

          {groupList.length === 0 ? (
            <p className="muted in-panel">まだグループがありません。</p>
          ) : (
            <ul className="group-manage-list">
              {groupList.map((g) => {
                const used = counts.get(g.id) ?? 0
                const editing = editingId === g.id
                return (
                  <li key={g.id} className="group-manage-item">
                    {editing ? (
                      <input
                        type="text"
                        className="form-input"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => {
                          // IME 変換確定の Enter は無視。確定状態の Enter のみコミット
                          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                            e.preventDefault()
                            commitEdit()
                          } else if (e.key === 'Escape' && !e.nativeEvent.isComposing) {
                            setEditingId(null)
                          }
                        }}
                        autoFocus
                      />
                    ) : (
                      <span className="group-manage-name">{g.name}</span>
                    )}
                    <span className="muted">{used} 台</span>
                    {editing ? (
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label="保存"
                        onClick={commitEdit}
                      >
                        <Check size={14} />
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label="名前を編集"
                        onClick={() => startEdit(g)}
                      >
                        <Pencil size={14} />
                      </button>
                    )}
                    <button
                      type="button"
                      className="icon-btn icon-btn-danger"
                      aria-label="削除"
                      onClick={() => handleDelete(g)}
                    >
                      <Trash2 size={14} />
                    </button>
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
