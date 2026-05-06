import { useEffect, useRef, useState } from 'react'
import { X, Trash2, CalendarDays, CheckSquare } from 'lucide-react'
import type {
  Dashboard,
  DashboardDefaultPeriod,
  SavedFilter,
  SavedFilterStore,
  SensorCategoryStore,
  SensorGroupStore,
  SensorStore,
} from '../types'
import { SensorPicker } from './SensorPicker'
import { SaveFilterDialog } from './SaveFilterDialog'

type Props = {
  open: boolean
  initial: Dashboard | null
  /** 既存ダッシュボード数（最後の1個は削除不可） */
  totalCount: number
  sensors: SensorStore
  groups: SensorGroupStore
  categories?: SensorCategoryStore
  savedFilters: SavedFilterStore
  onClose: () => void
  onSubmit: (patch: {
    name: string
    description: string
    targetSensorIds: string[]
    defaultPeriod: DashboardDefaultPeriod
  }) => void
  onDelete?: () => void
  onUpsertSavedFilter?: (f: SavedFilter) => void
}

const PERIOD_OPTIONS: { value: DashboardDefaultPeriod['type']; label: string }[] = [
  { value: 'day', label: '1 日' },
  { value: 'week', label: '1 週間' },
  { value: 'month', label: '1 ヶ月' },
]

export function DashboardEditDialog({
  open,
  initial,
  totalCount,
  sensors,
  groups,
  categories,
  savedFilters,
  onClose,
  onSubmit,
  onDelete,
  onUpsertSavedFilter,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [targetSensorIds, setTargetSensorIds] = useState<string[]>([])
  const [periodType, setPeriodType] = useState<DashboardDefaultPeriod['type']>('day')
  const [saveFilterOpen, setSaveFilterOpen] = useState(false)
  const [pickerConditionsForSave, setPickerConditionsForSave] = useState<
    Parameters<typeof SaveFilterDialog>[0]['conditions']
  >({})

  const allSensorIds = Object.keys(sensors).sort()

  useEffect(() => {
    if (!open) return
    setName(initial?.name ?? '')
    setDescription(initial?.description ?? '')
    setTargetSensorIds(initial?.targetSensorIds ?? [...allSensorIds])
    setPeriodType(initial?.defaultPeriod.type ?? 'day')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial])

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
      alert('ダッシュボード名を入力してください。')
      return
    }
    if (targetSensorIds.length === 0) {
      alert('対象センサーを 1 台以上選択してください。')
      return
    }
    onSubmit({
      name: trimmed,
      description: description.trim(),
      targetSensorIds,
      defaultPeriod: { type: periodType },
    })
  }

  function handleDelete() {
    if (!initial || !onDelete) return
    if (totalCount <= 1) {
      alert('最後のダッシュボードは削除できません。')
      return
    }
    if (!confirm(`ダッシュボード「${initial.name}」を削除しますか？`)) return
    onDelete()
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
          <h2>{initial ? 'ダッシュボードを編集' : 'ダッシュボードを作成'}</h2>
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
            <label className="form-label" htmlFor="dash-name">
              名前
            </label>
            <input
              id="dash-name"
              type="text"
              className="form-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例: 1F 加工エリア"
              maxLength={50}
              autoFocus
              required
            />
          </div>

          <div className="form-row">
            <label className="form-label" htmlFor="dash-desc">
              説明（任意）
            </label>
            <textarea
              id="dash-desc"
              className="form-input form-textarea"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="どのような目的のダッシュボードか、メモを残せます。"
              maxLength={200}
              rows={2}
            />
          </div>

          <div className="form-row">
            <label className="form-label">
              <CalendarDays size={13} className="row-leading-icon" />
              既定の対象期間
            </label>
            <p className="form-hint muted">
              ウィジェットはこの期間を共通で参照します。「前回確認からの期間」モードに切り替えれば、確認チェックインからの差分も表示できます。
            </p>
            <div className="seg-toggle">
              {PERIOD_OPTIONS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  className={`seg-toggle-btn ${periodType === p.value ? 'is-active' : ''}`}
                  onClick={() => setPeriodType(p.value)}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="form-row">
            <label className="form-label">
              <CheckSquare size={13} className="row-leading-icon" />
              対象センサー
            </label>
            <p className="form-hint muted">
              ここで選んだセンサーが、各ウィジェットでの選択肢の母集合になります。
              グループ・タグ・保存フィルタから一気に追加できます。
            </p>
            <SensorPicker
              candidateSensors={sensors}
              selected={targetSensorIds}
              onChange={setTargetSensorIds}
              groups={groups}
              categories={categories}
              savedFilters={savedFilters}
              onSaveAsFilter={
                onUpsertSavedFilter
                  ? (cond) => {
                      setPickerConditionsForSave(cond)
                      setSaveFilterOpen(true)
                    }
                  : undefined
              }
            />
          </div>
        </div>

        <SaveFilterDialog
          open={saveFilterOpen}
          conditions={pickerConditionsForSave}
          onClose={() => setSaveFilterOpen(false)}
          onSubmit={(f) => {
            onUpsertSavedFilter?.(f)
            setSaveFilterOpen(false)
          }}
        />

        <footer className="app-dialog-foot dialog-foot-split">
          <div>
            {initial && onDelete && (
              <button
                type="button"
                className="btn btn-ghost btn-sm dialog-delete-btn"
                onClick={handleDelete}
                disabled={totalCount <= 1}
                title={
                  totalCount <= 1 ? '最後のダッシュボードは削除できません' : '削除'
                }
              >
                <Trash2 size={14} />
                <span>削除</span>
              </button>
            )}
          </div>
          <div className="dialog-foot-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              キャンセル
            </button>
            <button type="submit" className="btn btn-primary">
              {initial ? '保存' : '作成'}
            </button>
          </div>
        </footer>
      </form>
    </dialog>
  )
}
