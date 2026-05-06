import { useEffect, useRef } from 'react'
import { X, Settings2, RotateCcw, Maximize2, ListOrdered } from 'lucide-react'
import {
  SENSOR_COLUMN_DEFS,
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
  /** Phase B: ワイド表示モード（画面端まで広げる） */
  wideMode: boolean
  onWideModeChange: (v: boolean) => void
  /** ページネーションの 1 ページあたりの表示件数 */
  pageSize: PageSize
  onPageSizeChange: (n: PageSize) => void
  onClose: () => void
}

const GROUP_LABELS: Record<'identity' | 'classify' | 'status', string> = {
  identity: '基本情報',
  classify: '分類・管理',
  status: 'ステータス',
}

const GROUP_ORDER: ('identity' | 'classify' | 'status')[] = [
  'identity',
  'classify',
  'status',
]

export function SensorColumnSettingsDialog({
  open,
  visibility,
  onChange,
  wideMode,
  onWideModeChange,
  pageSize,
  onPageSizeChange,
  onClose,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dlg = ref.current
    if (!dlg) return
    if (open && !dlg.open) dlg.showModal()
    if (!open && dlg.open) dlg.close()
  }, [open])

  function toggle(key: SensorColumnKey) {
    onChange({ ...visibility, [key]: !visibility[key] })
  }

  function reset() {
    onChange(defaultColumnVisibility())
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
            一覧に表示する列を選択します。「名前」列は常に表示されます。
          </p>

          {/* Phase B: 表示領域 + ページサイズ */}
          <div className="column-settings-group">
            <h3 className="column-settings-group-title">表示領域・件数</h3>
            <ul className="column-settings-list">
              <li className="column-settings-item">
                <label className="column-settings-row">
                  <input
                    type="checkbox"
                    checked={wideMode}
                    onChange={(e) => onWideModeChange(e.target.checked)}
                  />
                  <span className="column-settings-row-text">
                    <span className="column-settings-row-label">
                      <Maximize2 size={12} className="inline-icon" /> ワイド表示
                    </span>
                    <span className="column-settings-row-hint muted">
                      画面の中央寄せを解除して、横幅いっぱいに広げます。列が多いときに有効です。
                    </span>
                  </span>
                </label>
              </li>
              <li className="column-settings-item">
                <div className="column-settings-row column-settings-row-control">
                  <span className="column-settings-row-text">
                    <span className="column-settings-row-label">
                      <ListOrdered size={12} className="inline-icon" /> 1 ページあたりの表示件数
                    </span>
                    <span className="column-settings-row-hint muted">
                      この件数を超えると、ページネーションで分割されます。
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

          <div className="column-settings-fixed">
            <span className="column-settings-fixed-label">名前</span>
            <span className="column-settings-fixed-note muted">常に表示</span>
          </div>

          {GROUP_ORDER.map((group) => {
            const items = SENSOR_COLUMN_DEFS.filter((d) => d.group === group)
            if (items.length === 0) return null
            return (
              <div key={group} className="column-settings-group">
                <h3 className="column-settings-group-title">
                  {GROUP_LABELS[group]}
                </h3>
                <ul className="column-settings-list">
                  {items.map((def) => (
                    <li key={def.key} className="column-settings-item">
                      <label className="column-settings-row">
                        <input
                          type="checkbox"
                          checked={visibility[def.key]}
                          onChange={() => toggle(def.key)}
                        />
                        <span className="column-settings-row-text">
                          <span className="column-settings-row-label">
                            {def.label}
                          </span>
                          {def.hint && (
                            <span className="column-settings-row-hint muted">
                              {def.hint}
                            </span>
                          )}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>

        <footer className="app-dialog-foot">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={reset}
            title="既定の表示設定に戻す"
          >
            <RotateCcw size={13} />
            <span>既定に戻す</span>
          </button>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            閉じる
          </button>
        </footer>
      </div>
    </dialog>
  )
}
