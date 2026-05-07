import { useEffect, useRef, useState } from 'react'
import {
  X,
  Settings2,
  RotateCcw,
  ListOrdered,
  GripVertical,
} from 'lucide-react'
import {
  SENSOR_COLUMN_DEFS,
  defaultColumnOrder,
  defaultColumnVisibility,
  type SensorColumnKey,
  type SensorColumnVisibility,
} from '../lib/sensorColumns'

const PAGE_SIZE_OPTIONS = [25, 50, 100, 200] as const
export type PageSize = (typeof PAGE_SIZE_OPTIONS)[number]

type Props = {
  open: boolean
  visibility: SensorColumnVisibility
  onChange: (next: SensorColumnVisibility) => void
  /** ページネーションの 1 ページあたりの表示件数 */
  pageSize: PageSize
  onPageSizeChange: (n: PageSize) => void
  /** Phase 9.13: 列の並び順 */
  order: SensorColumnKey[]
  onOrderChange: (next: SensorColumnKey[]) => void
  onClose: () => void
}

/** key → ColumnDef のルックアップ（順序情報は def 側ではなく order 配列で管理） */
const DEFS_MAP: Record<SensorColumnKey, (typeof SENSOR_COLUMN_DEFS)[number]> =
  Object.fromEntries(SENSOR_COLUMN_DEFS.map((d) => [d.key, d])) as Record<
    SensorColumnKey,
    (typeof SENSOR_COLUMN_DEFS)[number]
  >

export function SensorColumnSettingsDialog({
  open,
  visibility,
  onChange,
  pageSize,
  onPageSizeChange,
  order,
  onOrderChange,
  onClose,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const [draggingKey, setDraggingKey] = useState<SensorColumnKey | null>(null)
  const [dropTarget, setDropTarget] = useState<{
    key: SensorColumnKey
    position: 'before' | 'after'
  } | null>(null)

  useEffect(() => {
    const dlg = ref.current
    if (!dlg) return
    if (open && !dlg.open) dlg.showModal()
    if (!open && dlg.open) dlg.close()
  }, [open])

  // ダイアログを閉じたらドラッグ状態をリセット
  useEffect(() => {
    if (!open) {
      setDraggingKey(null)
      setDropTarget(null)
    }
  }, [open])

  function toggle(key: SensorColumnKey) {
    onChange({ ...visibility, [key]: !visibility[key] })
  }

  function resetVisibility() {
    onChange(defaultColumnVisibility())
  }

  function resetOrder() {
    onOrderChange(defaultColumnOrder())
  }

  function moveColumn(
    from: SensorColumnKey,
    to: SensorColumnKey,
    position: 'before' | 'after',
  ) {
    if (from === to) return
    const without = order.filter((k) => k !== from)
    const targetIdx = without.indexOf(to)
    if (targetIdx === -1) return
    const insertIdx = position === 'after' ? targetIdx + 1 : targetIdx
    const next = [
      ...without.slice(0, insertIdx),
      from,
      ...without.slice(insertIdx),
    ]
    onOrderChange(next)
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
            <Settings2 size={16} className="head-icon" />
            列の表示設定
          </h2>
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
          <p className="muted in-panel">
            一覧に表示する列の選択と並び順を変更できます。「名前」列は常に左端に固定されます。
          </p>

          {/* 表示領域 + ページサイズ（並び替え対象外） */}
          <div className="column-settings-group">
            <h3 className="column-settings-group-title">表示件数</h3>
            <ul className="column-settings-list">
              <li className="column-settings-item">
                <div className="column-settings-row column-settings-row-control">
                  <span className="column-settings-row-text">
                    <span className="column-settings-row-label">
                      <ListOrdered size={12} className="inline-icon" /> 1 ページあたりの表示件数
                    </span>
                  </span>
                  <select
                    className="select select-sm"
                    value={pageSize}
                    onChange={(e) =>
                      onPageSizeChange(Number(e.target.value) as PageSize)
                    }
                    aria-label="1 ページあたりの表示件数"
                  >
                    {PAGE_SIZE_OPTIONS.map((n) => (
                      <option key={n} value={n}>
                        {n} 件
                      </option>
                    ))}
                  </select>
                </div>
              </li>
            </ul>
          </div>

          {/* 列の表示・非表示 + 並び替え */}
          <div className="column-settings-group">
            <div className="column-settings-group-head">
              <h3 className="column-settings-group-title">列の表示と並び順</h3>
              <button
                type="button"
                className="link-btn column-settings-reset"
                onClick={resetOrder}
                title="既定の並び順に戻す"
              >
                <RotateCcw size={11} />
                <span>並び順をリセット</span>
              </button>
            </div>

            {/* 名前は常に左端に固定 */}
            <div className="column-settings-fixed">
              <span className="column-settings-fixed-grip" aria-hidden="true">
                <GripVertical size={14} />
              </span>
              <span className="column-settings-fixed-label">名前</span>
              <span className="column-settings-fixed-note muted">
                常に左端に固定
              </span>
            </div>

            <ul
              className="column-settings-list column-settings-list-draggable"
              onDragOver={(e) => {
                // リスト全体での dragover を許可（dropEffect の維持）
                if (draggingKey) e.preventDefault()
              }}
              onDrop={(e) => {
                e.preventDefault()
                if (draggingKey && dropTarget) {
                  moveColumn(draggingKey, dropTarget.key, dropTarget.position)
                }
                setDraggingKey(null)
                setDropTarget(null)
              }}
            >
              {order.map((key) => {
                const def = DEFS_MAP[key]
                if (!def) return null
                const isDragging = draggingKey === key
                const isHover = dropTarget?.key === key
                const dropClass = isHover
                  ? dropTarget!.position === 'before'
                    ? 'is-drop-before'
                    : 'is-drop-after'
                  : ''

                return (
                  <li
                    key={key}
                    className={`column-settings-item column-settings-item-draggable ${
                      isDragging ? 'is-dragging' : ''
                    } ${dropClass}`}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = 'move'
                      e.dataTransfer.setData('text/plain', key)
                      setDraggingKey(key)
                    }}
                    onDragEnd={() => {
                      setDraggingKey(null)
                      setDropTarget(null)
                    }}
                    onDragOver={(e) => {
                      if (!draggingKey || draggingKey === key) return
                      e.preventDefault()
                      e.dataTransfer.dropEffect = 'move'
                      const rect = (
                        e.currentTarget as HTMLElement
                      ).getBoundingClientRect()
                      const isAfter = e.clientY > rect.top + rect.height / 2
                      setDropTarget({
                        key,
                        position: isAfter ? 'after' : 'before',
                      })
                    }}
                    onDragLeave={(e) => {
                      const related = e.relatedTarget as Node | null
                      if (
                        related &&
                        e.currentTarget.contains(related)
                      ) {
                        return
                      }
                      if (dropTarget?.key === key) setDropTarget(null)
                    }}
                  >
                    <span
                      className="column-settings-grip"
                      aria-hidden="true"
                      title="ドラッグして並び替え"
                    >
                      <GripVertical size={14} />
                    </span>
                    <label className="column-settings-row column-settings-row-compact">
                      <input
                        type="checkbox"
                        checked={visibility[def.key]}
                        onChange={() => toggle(def.key)}
                      />
                      <span className="column-settings-row-label">
                        {def.label}
                      </span>
                    </label>
                  </li>
                )
              })}
            </ul>
          </div>
        </div>

        <footer className="app-dialog-foot">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={resetVisibility}
            title="表示・非表示の設定を既定に戻す"
          >
            <RotateCcw size={13} />
            <span>表示設定を既定に戻す</span>
          </button>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            閉じる
          </button>
        </footer>
      </div>
    </dialog>
  )
}
