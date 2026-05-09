import { useMemo, useState } from 'react'
import {
  Search,
  X,
  Tag,
  Folder,
  Bookmark,
  Plus,
  Tags,
  Wifi,
  WifiOff,
  Router as RouterIcon,
  Trash2,
} from 'lucide-react'
import type {
  FilterConditions,
  GatewayStore,
  SavedFilter,
  SavedFilterStore,
  SensorCategoryStore,
  SensorGroupStore,
  SensorStore,
} from '../types'
import {
  collectAllTags,
  conditionsEqual,
  isEmptyConditions,
} from '../lib/groups'
import { CATEGORY_ICON_COMPONENTS } from '../lib/categories'
import { MultiSelectCombo, type ComboOption } from './MultiSelectCombo'
import { ConfirmDialog } from './ConfirmDialog'

type Props = {
  sensors: SensorStore
  groups: SensorGroupStore
  savedFilters: SavedFilterStore
  conditions: FilterConditions
  onChange: (next: FilterConditions) => void
  onSaveAsFilter?: () => void
  onApplySavedFilter?: (f: SavedFilter) => void
  onDeleteSavedFilter?: (id: string) => void
  /** Phase 9.9: ユーザー定義区分（あれば「区分」コンボを表示） */
  categories?: SensorCategoryStore
  gateways?: GatewayStore
  /** ゲートウェイの絞り込み欄を非表示にしたいビューで使う（例: アラート一覧） */
  hideGatewayFilter?: boolean
}

export function SensorFilterPanel({
  sensors,
  groups,
  savedFilters,
  conditions,
  onChange,
  onSaveAsFilter,
  onApplySavedFilter,
  onDeleteSavedFilter,
  categories,
  gateways,
  hideGatewayFilter = false,
}: Props) {
  const [pendingDelete, setPendingDelete] = useState<SavedFilter | null>(null)

  const groupList = useMemo(
    () => Object.values(groups).sort((a, b) => a.name.localeCompare(b.name)),
    [groups],
  )
  const savedList = useMemo(
    () => Object.values(savedFilters).sort((a, b) => a.name.localeCompare(b.name)),
    [savedFilters],
  )
  const allTags = useMemo(() => collectAllTags(sensors), [sensors])

  // ---------- 各コンボの選択肢 ----------

  const groupOptions: ComboOption[] = useMemo(() => {
    const opts: ComboOption[] = []
    const counts = new Map<string, number>()
    let unassigned = 0
    for (const s of Object.values(sensors)) {
      if (s.groupId) counts.set(s.groupId, (counts.get(s.groupId) ?? 0) + 1)
      else unassigned += 1
    }
    for (const g of groupList) {
      opts.push({
        value: g.id,
        label: g.name,
        count: counts.get(g.id) ?? 0,
      })
    }
    if (unassigned > 0) {
      opts.push({ value: '__none__', label: '未分類', count: unassigned })
    }
    return opts
  }, [groupList, sensors])

  const categoryOptions: ComboOption[] = useMemo(() => {
    if (!categories) return []
    const counts = new Map<string, number>()
    let unset = 0
    for (const s of Object.values(sensors)) {
      if (s.categoryId) counts.set(s.categoryId, (counts.get(s.categoryId) ?? 0) + 1)
      else unset += 1
    }
    const opts: ComboOption[] = Object.values(categories)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((c) => {
        const Icon = CATEGORY_ICON_COMPONENTS[c.icon]
        return {
          value: c.id,
          label: c.name,
          count: counts.get(c.id) ?? 0,
          icon: <Icon size={11} strokeWidth={2.2} />,
        }
      })
    if (unset > 0) {
      opts.push({ value: '__none__', label: '未設定', count: unset })
    }
    return opts
  }, [categories, sensors])

  const onlineCounts = useMemo(() => {
    let on = 0
    let off = 0
    for (const s of Object.values(sensors)) {
      if (s.online) on += 1
      else off += 1
    }
    return { online: on, offline: off }
  }, [sensors])

  const statusOptions: ComboOption[] = [
    {
      value: 'online',
      label: 'オンライン',
      count: onlineCounts.online,
      icon: <Wifi size={11} strokeWidth={2.2} />,
    },
    {
      value: 'offline',
      label: 'オフライン',
      count: onlineCounts.offline,
      icon: <WifiOff size={11} strokeWidth={2.2} />,
    },
  ]

  const gatewayOptions: ComboOption[] = useMemo(() => {
    if (!gateways) return []
    const counts = new Map<string, number>()
    for (const s of Object.values(sensors)) {
      if (s.gatewayId) counts.set(s.gatewayId, (counts.get(s.gatewayId) ?? 0) + 1)
    }
    return Object.values(gateways)
      .filter((g) => (counts.get(g.id) ?? 0) > 0)
      .sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id))
      .map((g) => ({
        value: g.id,
        label: g.name ?? g.id,
        count: counts.get(g.id) ?? 0,
      }))
  }, [gateways, sensors])

  const tagOptions: ComboOption[] = useMemo(
    () => allTags.map(({ tag, count }) => ({ value: tag, label: tag, count })),
    [allTags],
  )

  // ---------- onChange ヘルパ ----------

  function setGroupIds(ids: string[]) {
    onChange({ ...conditions, groupIds: ids.length === 0 ? undefined : ids })
  }
  function setCategoryIds(ids: string[]) {
    onChange({
      ...conditions,
      categoryIds: ids.length === 0 ? undefined : ids,
    })
  }
  function setStatus(ids: string[]) {
    const v = ids[0]
    onChange({
      ...conditions,
      onlineStatus: v === 'online' || v === 'offline' ? v : undefined,
    })
  }
  function setGateways(ids: string[]) {
    onChange({ ...conditions, gatewayIds: ids.length === 0 ? undefined : ids })
  }
  function setTags(ids: string[]) {
    onChange({ ...conditions, tagsAnd: ids.length === 0 ? undefined : ids })
  }

  function clearAll() {
    onChange({})
  }

  function handleConfirmDelete() {
    if (pendingDelete && onDeleteSavedFilter) {
      onDeleteSavedFilter(pendingDelete.id)
    }
    setPendingDelete(null)
  }

  const isEmpty = isEmptyConditions(conditions)

  return (
    <div className="filter-panel">
      {/* 保存フィルタ（あれば 1 行を消費） */}
      {savedList.length > 0 && (
        <div className="filter-row">
          <span className="filter-row-label">
            <Bookmark size={12} />
            保存
          </span>
          <div className="chip-row">
            {savedList.map((f) => {
              const active = conditionsEqual(conditions, f.conditions)
              return (
                <span key={f.id} className="filter-chip-wrap">
                  <button
                    type="button"
                    className={`filter-chip filter-chip-saved ${active ? 'is-active' : ''}`}
                    onClick={() => onApplySavedFilter?.(f)}
                    title={f.description ?? ''}
                  >
                    <Bookmark size={11} strokeWidth={2.4} />
                    {f.name}
                  </button>
                  {active && onDeleteSavedFilter && (
                    <button
                      type="button"
                      className="filter-chip-trash"
                      aria-label={`保存フィルタ「${f.name}」を削除`}
                      onClick={() => setPendingDelete(f)}
                      title="この保存フィルタを削除"
                    >
                      <Trash2 size={11} strokeWidth={2.2} />
                    </button>
                  )}
                </span>
              )
            })}
          </div>
        </div>
      )}

      {/* テキスト検索 + 区分 / 状態 / グループ / ゲートウェイ / タグ を 1 行に集約。
       *  画面が狭ければ自然に折り返す。件数表示はページネーション側に集約した */}
      <div className="filter-row filter-row-compact">
        <div className="filter-search">
          <Search size={14} />
          <input
            type="text"
            value={conditions.search ?? ''}
            onChange={(e) =>
              onChange({ ...conditions, search: e.target.value || undefined })
            }
            placeholder="名前 / デバイス番号 / シリアル / モデル / メーカー / タグで検索"
            className="filter-search-input"
          />
          {conditions.search && (
            <button
              type="button"
              className="icon-btn filter-search-clear"
              aria-label="検索クリア"
              onClick={() => onChange({ ...conditions, search: undefined })}
            >
              <X size={12} />
            </button>
          )}
        </div>

        {categoryOptions.length > 0 && (
          <MultiSelectCombo
            label="区分"
            leadingIcon={<Tags size={12} />}
            options={categoryOptions}
            selected={conditions.categoryIds ?? []}
            onChange={setCategoryIds}
          />
        )}

        <MultiSelectCombo
          label="状態"
          leadingIcon={<Wifi size={12} />}
          options={statusOptions}
          selected={conditions.onlineStatus ? [conditions.onlineStatus] : []}
          onChange={setStatus}
          singleSelect
        />

        <MultiSelectCombo
          label="グループ"
          leadingIcon={<Folder size={12} />}
          options={groupOptions}
          selected={conditions.groupIds ?? []}
          onChange={setGroupIds}
          hideIfEmpty
        />

        {!hideGatewayFilter && (
          <MultiSelectCombo
            label="ゲートウェイ"
            leadingIcon={<RouterIcon size={12} />}
            options={gatewayOptions}
            selected={conditions.gatewayIds ?? []}
            onChange={setGateways}
            hideIfEmpty
          />
        )}

        <MultiSelectCombo
          label="タグ"
          leadingIcon={<Tag size={12} />}
          options={tagOptions}
          selected={conditions.tagsAnd ?? []}
          onChange={setTags}
          hideIfEmpty
        />
      </div>

      {!isEmpty && (
        <div className="filter-actions">
          <button type="button" className="link-btn" onClick={clearAll}>
            <X size={12} /> 条件をクリア
          </button>
          {onSaveAsFilter && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={onSaveAsFilter}
            >
              <Plus size={13} />
              <span>この条件を保存</span>
            </button>
          )}
        </div>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="保存フィルタを削除"
        message={
          <>
            保存フィルタ「<strong>{pendingDelete?.name}</strong>」を削除します。
            <br />
            元に戻すことはできません。
          </>
        }
        confirmLabel="削除する"
        cancelLabel="キャンセル"
        variant="danger"
        onConfirm={handleConfirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  )
}
