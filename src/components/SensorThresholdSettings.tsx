/**
 * センサー個別の逸脱判定（閾値）設定 — Phase 9.14 でテンプレート適用を追加。
 *
 * - 危険・注意のチェックボックスは独立。下限・上限もそれぞれ任意。
 * - 入力ごとにリアルタイム保存。
 * - 「テンプレートから読み込み」で既存テンプレートの値をスナップショットコピー。
 */
import { useRef, useState } from 'react'
import { ChevronDown, FileDown, Sliders, Trash2 } from 'lucide-react'
import type {
  Sensor,
  TempHumidityThresholds,
  ThresholdMetric,
  ThresholdTemplate,
  ThresholdTemplateStore,
} from '../types'
import {
  TempHumidityThresholdsEditor,
  emptyTempHumidityThresholds,
} from './ThresholdValuesEditor'
import {
  cloneThresholds,
  isTemplateApplicableToKind,
} from '../lib/thresholdTemplates'

type Props = {
  sensor: Sensor
  /** 閾値が変わるたびに呼ばれる（リアルタイム保存）。
   *  全てのレベルが空ならば undefined を渡す。 */
  onChange: (next: TempHumidityThresholds | undefined) => void
  /** Phase 9.14: 適用候補にできる閾値テンプレート集 */
  templates: ThresholdTemplateStore
}

/** ThresholdMetric が「ユーザの編集意図」（チェック ON）を持つか */
function hasUserIntent(m: ThresholdMetric): boolean {
  return m.alert.enabled || m.warn.enabled
}

function buildPayload(
  v: TempHumidityThresholds,
): TempHumidityThresholds | undefined {
  if (!hasUserIntent(v.temperature) && !hasUserIntent(v.humidity)) return undefined
  return v
}

export function SensorThresholdSettings({ sensor, onChange, templates }: Props) {
  const isTempHumidity =
    sensor.kind === 'temperature-humidity' || sensor.kind === undefined

  if (!isTempHumidity) {
    return (
      <div className="threshold-settings threshold-settings-unsupported">
        <Sliders size={14} className="head-icon" />
        <span className="muted">
          このセンサー種別 (<code>{sensor.kind}</code>) の閾値設定はまだ未対応です。
        </span>
      </div>
    )
  }

  const existing: TempHumidityThresholds | null =
    sensor.thresholds?.kind === 'temperature-humidity'
      ? sensor.thresholds
      : null
  const value: TempHumidityThresholds = existing ?? emptyTempHumidityThresholds()

  function handleEditorChange(next: TempHumidityThresholds) {
    onChange(buildPayload(next))
  }

  function applyTemplate(t: ThresholdTemplate) {
    if (t.thresholds.kind !== 'temperature-humidity') return
    // スナップショット適用: テンプレの値を deep clone してから保存
    const snapshot = cloneThresholds(t.thresholds) as TempHumidityThresholds
    onChange(buildPayload(snapshot))
  }

  function clearAll() {
    onChange(undefined)
  }

  const applicableTemplates = Object.values(templates).filter((t) =>
    isTemplateApplicableToKind(t, sensor.kind),
  )

  return (
    <div className="threshold-settings">
      {/* 上部ツールバー: テンプレート適用 / クリア */}
      <div className="threshold-settings-toolbar">
        <TemplatePickerButton
          templates={applicableTemplates}
          onPick={applyTemplate}
        />
      </div>

      <TempHumidityThresholdsEditor
        value={value}
        onChange={handleEditorChange}
      />

      {(hasUserIntent(value.temperature) || hasUserIntent(value.humidity)) && (
        <footer className="threshold-settings-foot">
          <button
            type="button"
            className="btn btn-ghost btn-sm threshold-clear"
            onClick={clearAll}
            title="このセンサーの閾値をすべて取り除く（逸脱判定を無効化）"
          >
            <Trash2 size={13} />
            <span>閾値をすべてクリア</span>
          </button>
        </footer>
      )}
    </div>
  )
}

/** テンプレ一覧をドロップダウン風に出すボタン */
function TemplatePickerButton({
  templates,
  onPick,
}: {
  templates: ThresholdTemplate[]
  onPick: (t: ThresholdTemplate) => void
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  // クリック外で閉じる
  function onWrapBlur(e: React.FocusEvent) {
    if (!wrapRef.current?.contains(e.relatedTarget as Node)) setOpen(false)
  }

  if (templates.length === 0) {
    return (
      <span className="muted threshold-template-empty">
        利用可能な閾値テンプレートがありません。「設定 → 閾値テンプレート」で作成できます。
      </span>
    )
  }

  return (
    <div className="threshold-template-wrap" ref={wrapRef} onBlur={onWrapBlur}>
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <FileDown size={14} />
        <span>テンプレートから読み込み</span>
        <ChevronDown size={13} />
      </button>
      {open && (
        <div className="threshold-template-popover" role="listbox">
          {templates
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((t) => (
              <button
                key={t.id}
                type="button"
                role="option"
                aria-selected={false}
                className="threshold-template-option"
                onClick={() => {
                  onPick(t)
                  setOpen(false)
                }}
              >
                <span className="threshold-template-name">{t.name}</span>
                {t.description && (
                  <span className="threshold-template-desc muted">
                    {t.description}
                  </span>
                )}
              </button>
            ))}
        </div>
      )}
    </div>
  )
}
