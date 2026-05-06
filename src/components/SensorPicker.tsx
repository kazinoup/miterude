import { useMemo, useState } from 'react'
import { CheckSquare, Square, Plus, Minus } from 'lucide-react'
import type {
  FilterConditions,
  SavedFilter,
  SavedFilterStore,
  SensorCategoryStore,
  SensorGroupStore,
  SensorStore,
} from '../types'
import { isEmptyConditions, sensorMatches } from '../lib/groups'
import { CATEGORY_ICON_COMPONENTS } from '../lib/categories'
import { SensorFilterPanel } from './SensorFilterPanel'

type Props = {
  /** 選択肢の母集合となるセンサー（ダッシュボード picker は全センサー、widget picker はダッシュボード対象のみ） */
  candidateSensors: SensorStore
  selected: string[]
  onChange: (next: string[]) => void
  groups: SensorGroupStore
  categories?: SensorCategoryStore
  savedFilters: SavedFilterStore
  /** 保存リクエスト時に現在の conditions を受け取る */
  onSaveAsFilter?: (conditions: FilterConditions) => void
  emptyText?: string
  /** 保存フィルタを使えるか（一部 dialog では非表示にする） */
  hideSavedFilters?: boolean
}

export function SensorPicker({
  candidateSensors,
  selected,
  onChange,
  groups,
  categories,
  savedFilters,
  onSaveAsFilter,
  emptyText = 'センサーがありません。',
  hideSavedFilters,
}: Props) {
  const [conditions, setConditions] = useState<FilterConditions>({})

  const candidateList = useMemo(
    () => Object.values(candidateSensors).sort((a, b) => a.id.localeCompare(b.id)),
    [candidateSensors],
  )

  // 候補センサーから条件にマッチするものを抽出
  const filteredList = useMemo(() => {
    if (isEmptyConditions(conditions)) return candidateList
    const allowedGroupSet =
      conditions.groupIds && conditions.groupIds.length > 0
        ? new Set(conditions.groupIds)
        : null
    return candidateList.filter((s) => {
      if (conditions.search) {
        const needle = conditions.search.trim().toLowerCase()
        const haystack = [
          s.id,
          s.deviceNumber,
          s.serialNumber,
          s.model,
          s.manufacturer,
          ...(s.tags ?? []),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        if (!haystack.includes(needle)) return false
      }
      if (allowedGroupSet) {
        if (allowedGroupSet.has('__none__')) {
          if (s.groupId && !allowedGroupSet.has(s.groupId)) return false
        } else {
          if (!s.groupId || !allowedGroupSet.has(s.groupId)) return false
        }
      }
      if (
        !sensorMatches(s, {
          ...conditions,
          search: undefined,
          groupIds: undefined,
        })
      ) {
        return false
      }
      return true
    })
  }, [candidateList, conditions])

  const selectedSet = useMemo(() => new Set(selected), [selected])

  function toggleOne(id: string) {
    if (selectedSet.has(id)) {
      onChange(selected.filter((x) => x !== id))
    } else {
      onChange([...selected, id])
    }
  }

  function addAllFiltered() {
    const next = new Set(selected)
    for (const s of filteredList) next.add(s.id)
    onChange(Array.from(next))
  }

  function removeAllFiltered() {
    const filteredSet = new Set(filteredList.map((s) => s.id))
    onChange(selected.filter((id) => !filteredSet.has(id)))
  }

  function applySavedFilter(f: SavedFilter) {
    setConditions(f.conditions)
  }

  // 表示中の選択件数
  const filteredSelectedCount = filteredList.reduce(
    (n, s) => (selectedSet.has(s.id) ? n + 1 : n),
    0,
  )
  const allFilteredSelected =
    filteredList.length > 0 && filteredSelectedCount === filteredList.length

  return (
    <div className="sensor-picker">
      <SensorFilterPanel
        sensors={candidateSensors}
        groups={groups}
        categories={categories}
        savedFilters={hideSavedFilters ? {} : savedFilters}
        conditions={conditions}
        onChange={setConditions}
        onSaveAsFilter={
          !hideSavedFilters && onSaveAsFilter && !isEmptyConditions(conditions)
            ? () => onSaveAsFilter(conditions)
            : undefined
        }
        onApplySavedFilter={applySavedFilter}
      />

      <div className="sensor-picker-actions">
        <span className="muted">
          選択中: <strong>{selected.length}</strong> /{' '}
          {Object.keys(candidateSensors).length} 台
          {filteredList.length !== candidateList.length && (
            <> ・ 表示中の選択 {filteredSelectedCount} / {filteredList.length}</>
          )}
        </span>
        <div className="sensor-picker-quick">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={addAllFiltered}
            disabled={filteredList.length === 0 || allFilteredSelected}
            title="表示中のすべてを選択に追加"
          >
            <Plus size={13} />
            <span>表示中をすべて追加</span>
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={removeAllFiltered}
            disabled={filteredSelectedCount === 0}
            title="表示中の選択を解除"
          >
            <Minus size={13} />
            <span>表示中を解除</span>
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => onChange([])}
            disabled={selected.length === 0}
          >
            すべて解除
          </button>
        </div>
      </div>

      <div className="sensor-picker-list">
        {filteredList.length === 0 ? (
          <p className="muted in-panel">
            {Object.keys(candidateSensors).length === 0
              ? emptyText
              : '条件にマッチするセンサーがありません。'}
          </p>
        ) : (
          filteredList.map((s) => {
            const checked = selectedSet.has(s.id)
            const cat = s.categoryId && categories ? categories[s.categoryId] : undefined
            const CatIcon = cat ? CATEGORY_ICON_COMPONENTS[cat.icon] : null
            return (
              <button
                key={s.id}
                type="button"
                className={`sensor-picker-row ${checked ? 'is-checked' : ''}`}
                onClick={() => toggleOne(s.id)}
              >
                {checked ? (
                  <CheckSquare size={15} strokeWidth={2.2} />
                ) : (
                  <Square size={15} strokeWidth={2.2} />
                )}
                {CatIcon && (
                  <span
                    className="sensor-picker-cat"
                    title={cat?.name}
                    aria-hidden="true"
                  >
                    <CatIcon size={12} strokeWidth={2.2} />
                  </span>
                )}
                <span className="sensor-picker-name">{s.id}</span>
                <span className="sensor-picker-sub">
                  {s.deviceNumber}
                  {s.groupId && groups[s.groupId] && (
                    <> ・ {groups[s.groupId].name}</>
                  )}
                </span>
                <span className="sensor-picker-tags">
                  {(s.tags ?? []).slice(0, 3).map((t) => (
                    <span key={t} className="cell-tag-pill">
                      {t}
                    </span>
                  ))}
                  {(s.tags ?? []).length > 3 && (
                    <span className="cell-tag-more">
                      +{(s.tags ?? []).length - 3}
                    </span>
                  )}
                </span>
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}
