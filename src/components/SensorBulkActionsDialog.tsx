import { useEffect, useRef, useState } from 'react'
import { X, Tag, Folder, Tags, Trash2, Sliders, FileText } from 'lucide-react'
import type {
  SensorCategoryStore,
  SensorGroupStore,
  SensorThresholds,
  TempHumidityThresholds,
  ThresholdTemplateStore,
} from '../types'
import { normalizeTag } from '../lib/groups'
import {
  TempHumidityThresholdsEditor,
  emptyTempHumidityThresholds,
} from './ThresholdValuesEditor'

type Action =
  | { kind: 'tag-add'; tags: string[] }
  | { kind: 'tag-remove'; tags: string[] }
  | { kind: 'group-set'; groupId: string | null }
  | { kind: 'category-set'; categoryId: string | null }
  | { kind: 'threshold-set'; thresholds: SensorThresholds | undefined }

type Props = {
  open: boolean
  selectedCount: number
  groups: SensorGroupStore
  categories: SensorCategoryStore
  /** Phase 9.14: 適用候補にできる閾値テンプレート集 */
  thresholdTemplates: ThresholdTemplateStore
  /** 既存タグの候補（オートコンプリート） */
  existingTags: string[]
  onClose: () => void
  onApply: (action: Action) => void
}

type Mode =
  | 'tag-add'
  | 'tag-remove'
  | 'group-set'
  | 'category-set'
  | 'threshold-set'

export function SensorBulkActionsDialog({
  open,
  selectedCount,
  groups,
  categories,
  thresholdTemplates,
  existingTags,
  onClose,
  onApply,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const [mode, setMode] = useState<Mode>('tag-add')
  const [tagsInput, setTagsInput] = useState('')
  const [groupId, setGroupId] = useState<string>('')
  const [categoryId, setCategoryId] = useState<string>('')
  // Phase 9.14: 閾値一括変更
  const [thresholdSource, setThresholdSource] =
    useState<'template' | 'direct' | 'clear'>('template')
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('')
  const [directThresholds, setDirectThresholds] =
    useState<TempHumidityThresholds>(emptyTempHumidityThresholds())

  useEffect(() => {
    if (!open) return
    setMode('tag-add')
    setTagsInput('')
    setGroupId('')
    setCategoryId('')
    setThresholdSource('template')
    setSelectedTemplateId('')
    setDirectThresholds(emptyTempHumidityThresholds())
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
    } else if (mode === 'category-set') {
      onApply({ kind: 'category-set', categoryId: categoryId || null })
    } else {
      // threshold-set
      if (thresholdSource === 'clear') {
        onApply({ kind: 'threshold-set', thresholds: undefined })
        return
      }
      if (thresholdSource === 'template') {
        const t = templateList.find((x) => x.id === selectedTemplateId)
        if (!t) {
          alert('テンプレートを選択してください。')
          return
        }
        onApply({ kind: 'threshold-set', thresholds: t.thresholds })
        return
      }
      // direct
      onApply({ kind: 'threshold-set', thresholds: directThresholds })
    }
  }

  const groupList = Object.values(groups).sort((a, b) => a.name.localeCompare(b.name))
  const categoryList = Object.values(categories).sort((a, b) =>
    a.name.localeCompare(b.name),
  )
  const templateList = Object.values(thresholdTemplates).sort((a, b) =>
    a.name.localeCompare(b.name),
  )

  /** Phase: 2 ペインレイアウト用 — 左ナビ項目の定義 */
  const NAV_ITEMS: {
    mode: Mode
    label: string
    icon: React.ComponentType<{ size?: number }>
  }[] = [
    { mode: 'tag-add', label: 'タグ付与', icon: Tag },
    { mode: 'tag-remove', label: 'タグ削除', icon: Trash2 },
    { mode: 'group-set', label: 'グループ移動', icon: Folder },
    { mode: 'category-set', label: '区分変更', icon: Tags },
    { mode: 'threshold-set', label: '閾値一括変更', icon: Sliders },
  ]

  return (
    <dialog
      ref={ref}
      className="app-dialog app-dialog-bulk"
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

        <div className="app-dialog-body bulk-actions-2pane">
          {/* 左ペイン: 操作項目を縦並び */}
          <nav className="bulk-actions-nav" aria-label="操作">
            {NAV_ITEMS.map(({ mode: m, label, icon: Icon }) => (
              <button
                key={m}
                type="button"
                className={`bulk-actions-nav-item ${mode === m ? 'is-active' : ''}`}
                onClick={() => setMode(m)}
                aria-pressed={mode === m}
              >
                <Icon size={14} />
                <span>{label}</span>
              </button>
            ))}
          </nav>

          {/* 右ペイン: 選択中の操作の設定 */}
          <div className="bulk-actions-pane">
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

            {mode === 'threshold-set' && (
              <>
                <div className="form-row">
                  <span className="form-label">適用方法</span>
                  <div className="seg-toggle">
                    <button
                      type="button"
                      className={`seg-toggle-btn ${thresholdSource === 'template' ? 'is-active' : ''}`}
                      onClick={() => setThresholdSource('template')}
                    >
                      <FileText size={13} /> テンプレートから
                    </button>
                    <button
                      type="button"
                      className={`seg-toggle-btn ${thresholdSource === 'direct' ? 'is-active' : ''}`}
                      onClick={() => setThresholdSource('direct')}
                    >
                      <Sliders size={13} /> 直接入力
                    </button>
                    <button
                      type="button"
                      className={`seg-toggle-btn ${thresholdSource === 'clear' ? 'is-active' : ''}`}
                      onClick={() => setThresholdSource('clear')}
                    >
                      <Trash2 size={13} /> 閾値をクリア
                    </button>
                  </div>
                </div>

                {thresholdSource === 'template' && (
                  <div className="form-row">
                    <label className="form-label" htmlFor="bulk-threshold-template">
                      テンプレート
                    </label>
                    {templateList.length === 0 ? (
                      <p className="muted in-panel">
                        テンプレートがありません。「設定 → 閾値テンプレート」で作成してください。
                      </p>
                    ) : (
                      <select
                        id="bulk-threshold-template"
                        className="select"
                        value={selectedTemplateId}
                        onChange={(e) => setSelectedTemplateId(e.target.value)}
                      >
                        <option value="">— 選択してください —</option>
                        {templateList.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                            {t.description ? `（${t.description}）` : ''}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                )}

                {thresholdSource === 'direct' && (
                  <div className="form-row">
                    <span className="form-label">閾値の値</span>
                    <div className="bulk-threshold-direct">
                      <TempHumidityThresholdsEditor
                        value={directThresholds}
                        onChange={setDirectThresholds}
                      />
                    </div>
                  </div>
                )}

                {thresholdSource === 'clear' && (
                  <p className="muted in-panel">
                    選択中の <strong>{selectedCount}</strong> 台すべてから
                    閾値設定を取り除き、逸脱判定を無効化します。
                  </p>
                )}

                <p className="muted in-panel form-hint">
                  ※ 種別が一致するセンサー（温湿度センサー）にのみ適用されます。
                  それ以外のセンサーはスキップされます。
                </p>
              </>
            )}
          </div>
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
