/**
 * ゲートウェイ一覧の列表示・並び順設定ダイアログ — Phase
 *
 * SensorColumnSettingsDialog を簡略化したもの:
 *  - ゲートウェイは件数が少ないのでページサイズの設定は持たない
 *  - 「名前」は固定（左端）。それ以外の列を表示／非表示・並び順で管理
 *  - ドラッグ＆ドロップで並び替え（センサー側と同じパターン）
 */
import { useEffect, useRef, useState } from 'react'
import {
  X,
  Settings2,
  RotateCcw,
  GripVertical,
} from 'lucide-react'
import {
  GATEWAY_COLUMN_DEFS,
  defaultColumnOrder,
  defaultColumnVisibility,
  type GatewayColumnKey,
  type GatewayColumnVisibility,
} from '../lib/gatewayColumns'

type Props = {
  open: boolean
  visibility: GatewayColumnVisibility
  onChange: (next: GatewayColumnVisibility) => void
  order: GatewayColumnKey[]
  onOrderChange: (next: GatewayColumnKey[]) => void
  onClose: () => void
}

const DEFS_MAP: Record<GatewayColumnKey, (typeof GATEWAY_COLUMN_DEFS)[number]> =
  Object.fromEntries(GATEWAY_COLUMN_DEFS.map((d) => [d.key, d])) as Record<
    GatewayColumnKey,
    (typeof GATEWAY_COLUMN_DEFS)[number]
  >

export function GatewayColumnSettingsDialog({
  open,
  visibility,
  onChange,
  order,
  onOrderChange,
  onClose,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const [draggingKey, setDraggingKey] = useState<GatewayColumnKey | null>(null)
  const [dropTarget, setDropTarget] = useState<{
    key: GatewayColumnKey
    position: 'before' | 'after'
  } | null>(null)

  useEffect(() => {
    const dlg = ref.current
    if (!dlg) return
    if (open && !dlg.open) dlg.showModal()
    if (!open && dlg.open) dlg.close()
  }, [open])

  useEffect(() => {
    if (!open) {
      setDraggingKey(null)
      setDropTarget(null)
    }
  }, [open])

  function toggle(key: GatewayColumnKey) {
    onChange({ ...visibility, [key]: !visibility[key] })
  }

  function resetVisibility() {
    onChange(defaultColumnVisibility())
  }

  function resetOrder() {
    onOrderChange(defaultColumnOrder())
  }

  function moveColumn(
    from: GatewayColumnKey,
    to: GatewayColumnKey,
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
