/**
 * 温湿度の閾値（TempHumidityThresholds）を編集するための共有エディタ。
 *
 * SensorThresholdSettings（センサー個別の閾値設定）と
 * ThresholdTemplateManageDialog（テンプレート編集）の両方から使われる。
 *
 * UI 規約:
 * - 危険・注意の有効化は独立したチェックボックス
 * - 各レベルの下限・上限はそれぞれ任意（片方だけ／両方／空 すべて可）
 * - 入力ごとに onChange で上位に通知（リアルタイム保存／編集）
 */
import {
  AlertOctagon,
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpToLine,
  Droplets,
  Info,
  Thermometer,
} from 'lucide-react'
import type {
  TempHumidityThresholds,
  ThresholdLevel,
  ThresholdMetric,
} from '../types'

type Props = {
  value: TempHumidityThresholds
  onChange: (next: TempHumidityThresholds) => void
}

/** 数値文字列を number に変換（空欄なら undefined） */
function parseNumOrUndef(v: string): number | undefined {
  const t = v.trim()
  if (t === '') return undefined
  const n = Number(t)
  return Number.isFinite(n) ? n : undefined
}

export function TempHumidityThresholdsEditor({ value, onChange }: Props) {
  function patchTemperature(next: ThresholdMetric) {
    onChange({ ...value, temperature: next })
  }
  function patchHumidity(next: ThresholdMetric) {
    onChange({ ...value, humidity: next })
  }

  return (
    <div className="threshold-values-editor">
      <p className="threshold-help">
        <Info size={12} className="threshold-help-icon" />
        <span className="threshold-help-line">
          <ArrowDownToLine size={11} strokeWidth={2.4} className="threshold-arrow-down" />
          下限値を下回るか、
          <ArrowUpToLine size={11} strokeWidth={2.4} className="threshold-arrow-up" />
          上限値を上回ると発動します。片方だけ設定すれば、その方向だけの閾値として動作します。
        </span>
      </p>
      {/* 温度・湿度を横 2 カラムで並べる（縦区切りつき）。
          画面幅が狭い場合は CSS で自動的に縦積みに戻る。 */}
      <div className="threshold-metrics-grid">
        <ThresholdMetricEditor
          title="温度"
          icon={<Thermometer size={14} />}
          unit="℃"
          metric={value.temperature}
          onChange={patchTemperature}
        />
        <ThresholdMetricEditor
          title="湿度"
          icon={<Droplets size={14} />}
          unit="%"
          metric={value.humidity}
          onChange={patchHumidity}
        />
      </div>
    </div>
  )
}

/** 1 つの計測指標（温度 or 湿度）の編集 UI。
 *  外部からも使えるよう export。 */
export function ThresholdMetricEditor({
  title,
  icon,
  unit,
  metric,
  onChange,
}: {
  title: string
  icon: React.ReactNode
  unit: string
  metric: ThresholdMetric
  onChange: (next: ThresholdMetric) => void
}) {
  function patchAlert(patch: Partial<ThresholdLevel>) {
    onChange({ ...metric, alert: { ...metric.alert, ...patch } })
  }
  function patchWarn(patch: Partial<ThresholdLevel>) {
    onChange({ ...metric, warn: { ...metric.warn, ...patch } })
  }

  return (
    <fieldset className="threshold-metric">
      <legend className="threshold-metric-legend">
        <span className="threshold-metric-title">
          {icon}
          <span>
            {title}（{unit}）
          </span>
        </span>
      </legend>

      <ThresholdLevelEditor
        kind="alert"
        title="危険"
        unit={unit}
        level={metric.alert}
        onChange={patchAlert}
      />
      <ThresholdLevelEditor
        kind="warn"
        title="注意"
        unit={unit}
        level={metric.warn}
        onChange={patchWarn}
      />

      <ValidationHint metric={metric} />
    </fieldset>
  )
}

function ThresholdLevelEditor({
  kind,
  title,
  unit,
  level,
  onChange,
}: {
  kind: 'alert' | 'warn'
  title: string
  unit: string
  level: ThresholdLevel
  onChange: (patch: Partial<ThresholdLevel>) => void
}) {
  const Icon = kind === 'alert' ? AlertOctagon : AlertTriangle
  const noteClass = kind === 'alert' ? 'threshold-icon-alert' : 'threshold-icon-warn'

  return (
    <div
      className={`threshold-row threshold-row-${kind} ${level.enabled ? 'is-on' : 'is-off'}`}
      title={
        kind === 'alert'
          ? '範囲外で赤（危険）'
          : '範囲外でオレンジ（注意）'
      }
    >
      <label className="threshold-row-toggle">
        <input
          type="checkbox"
          checked={level.enabled}
          onChange={(e) => onChange({ enabled: e.target.checked })}
        />
        <span className="threshold-row-label">
          <Icon size={12} className={noteClass} />
          {title}
        </span>
      </label>

      <div className="threshold-row-inputs" aria-hidden={!level.enabled}>
        <label
          className="threshold-input-pair"
          title="この値を下回ると発動します。設定しなければ下限の判定はしません。"
        >
          <ArrowDownToLine
            size={11}
            strokeWidth={2.4}
            className="threshold-arrow-down"
            aria-hidden="true"
          />
          <span className="threshold-input-pair-label">下限</span>
          <input
            type="number"
            step="0.1"
            value={level.min ?? ''}
            disabled={!level.enabled}
            onChange={(e) => onChange({ min: parseNumOrUndef(e.target.value) })}
            placeholder="—"
          />
          <span className="threshold-input-unit">{unit}</span>
        </label>
        <label
          className="threshold-input-pair"
          title="この値を上回ると発動します。設定しなければ上限の判定はしません。"
        >
          <ArrowUpToLine
            size={11}
            strokeWidth={2.4}
            className="threshold-arrow-up"
            aria-hidden="true"
          />
          <span className="threshold-input-pair-label">上限</span>
          <input
            type="number"
            step="0.1"
            value={level.max ?? ''}
            disabled={!level.enabled}
            onChange={(e) => onChange({ max: parseNumOrUndef(e.target.value) })}
            placeholder="—"
          />
          <span className="threshold-input-unit">{unit}</span>
        </label>
      </div>
    </div>
  )
}

function ValidationHint({ metric }: { metric: ThresholdMetric }) {
  const issues: string[] = []

  function checkLevel(name: string, l: ThresholdLevel) {
    if (!l.enabled) return
    if (l.min != null && l.max != null && l.min > l.max) {
      issues.push(`${name}: 下限が上限より大きい値になっています`)
    }
  }
  checkLevel('危険', metric.alert)
  checkLevel('注意', metric.warn)

  if (
    metric.alert.enabled &&
    metric.warn.enabled &&
    metric.alert.min != null &&
    metric.warn.min != null &&
    metric.warn.min < metric.alert.min
  ) {
    issues.push('注意の下限は、危険の下限より大きい値にしてください')
  }
  if (
    metric.alert.enabled &&
    metric.warn.enabled &&
    metric.alert.max != null &&
    metric.warn.max != null &&
    metric.warn.max > metric.alert.max
  ) {
    issues.push('注意の上限は、危険の上限より小さい値にしてください')
  }

  if (issues.length === 0) return null
  return (
    <ul className="threshold-validation">
      {issues.map((m, i) => (
        <li key={i}>{m}</li>
      ))}
    </ul>
  )
}

/** 「OFF/OFF」の温湿度閾値（テンプレ作成・センサー初期化の出発点） */
export function emptyTempHumidityThresholds(): TempHumidityThresholds {
  return {
    kind: 'temperature-humidity',
    temperature: {
      alert: { enabled: false },
      warn: { enabled: false },
    },
    humidity: {
      alert: { enabled: false },
      warn: { enabled: false },
    },
  }
}
