import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, Check, X } from 'lucide-react'

export type ComboOption = {
  value: string
  label: string
  count?: number
  /** オプション行に表示する小アイコン */
  icon?: ReactNode
}

type Props = {
  /** ラベル（"グループ" など） */
  label: string
  /** 選択肢 */
  options: ComboOption[]
  /** 選択中の値 */
  selected: string[]
  onChange: (next: string[]) => void
  /** true で単一選択 */
  singleSelect?: boolean
  /** 0件選択時の表示（"全て" など） */
  emptyText?: string
  /** トリガー左の小アイコン */
  leadingIcon?: ReactNode
  /** 該当オプションがゼロのとき非表示にする */
  hideIfEmpty?: boolean
  /** 任意の追加クラス */
  className?: string
}

/** マルチセレクト・コンボボックス（フィルタ用）
 *  - クリックでポップオーバー展開
 *  - 各行に [✓] と件数バッジ
 *  - 単一選択モード（singleSelect）にも対応
 */
export function MultiSelectCombo({
  label,
  options,
  selected,
  onChange,
  singleSelect,
  emptyText = '全て',
  leadingIcon,
  hideIfEmpty,
  className,
}: Props) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (hideIfEmpty && options.length === 0) return null

  function toggleValue(v: string) {
    if (singleSelect) {
      if (selected.includes(v)) {
        onChange([])
      } else {
        onChange([v])
      }
      setOpen(false)
    } else {
      const set = new Set(selected)
      if (set.has(v)) set.delete(v)
      else set.add(v)
      onChange(Array.from(set))
    }
  }

  function clearSelection() {
    onChange([])
  }

  const selectedLabels = selected
    .map((v) => options.find((o) => o.value === v)?.label)
    .filter((l): l is string => Boolean(l))

  let displayValue = ''
  if (selected.length === 0) {
    displayValue = emptyText
  } else if (singleSelect) {
    displayValue = selectedLabels[0] ?? emptyText
  } else if (selected.length <= 2) {
    displayValue = selectedLabels.join(', ')
  } else {
    displayValue = `${selected.length} 件選択中`
  }

  const isEmpty = selected.length === 0

  return (
    <div
      className={`combo-wrap ${open ? 'is-open' : ''} ${className ?? ''}`}
      ref={wrapRef}
    >
      <button
        type="button"
        className={`combo-trigger ${!isEmpty ? 'is-active' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        {leadingIcon && <span className="combo-icon">{leadingIcon}</span>}
        <span className="combo-label">{label}</span>
        <span className={`combo-value ${isEmpty ? 'is-empty' : ''}`}>
          {displayValue}
        </span>
        {!isEmpty && !singleSelect && (
          <span
            role="button"
            className="combo-clear"
            aria-label="選択解除"
            onClick={(e) => {
              e.stopPropagation()
              clearSelection()
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                e.stopPropagation()
                clearSelection()
              }
            }}
            tabIndex={0}
          >
            <X size={11} />
          </span>
        )}
        <ChevronDown size={13} className="combo-chev" />
      </button>

      {open && (
        <div className="combo-popover" role="listbox">
          {options.length === 0 ? (
            <p className="combo-empty muted">選択肢がありません。</p>
          ) : (
            options.map((o) => {
              const checked = selected.includes(o.value)
              return (
                <button
                  type="button"
                  key={o.value}
                  className={`combo-option ${checked ? 'is-checked' : ''}`}
                  onClick={() => toggleValue(o.value)}
                  role="option"
                  aria-selected={checked}
                >
                  {!singleSelect ? (
                    <span className={`combo-check ${checked ? 'is-checked' : ''}`}>
                      {checked && <Check size={12} strokeWidth={2.6} />}
                    </span>
                  ) : (
                    <span
                      className={`combo-radio ${checked ? 'is-checked' : ''}`}
                      aria-hidden="true"
                    />
                  )}
                  {o.icon && <span className="combo-option-icon">{o.icon}</span>}
                  <span className="combo-option-label">{o.label}</span>
                  {o.count != null && (
                    <span className="combo-option-count">{o.count}</span>
                  )}
                </button>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
