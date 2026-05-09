/**
 * 除外時間帯 / 除外日のエディタ部品（コンパクト版）。
 *
 * 設計方針:
 *   - 各カードはデフォルトで折り畳まれ、ヘッダ 1 行だけを表示する
 *     （除外日が年々増える運用でも一覧性を保つ）。
 *   - ヘッダ内に「有効化チェック / 名称入力 / サマリ / 展開ボタン / 削除」を
 *     横並びで詰める。
 *   - 展開時は時間帯と曜日を 1 行にまとめ、抑制対象も 1 行で並べる。
 *   - 新規追加された項目は自動展開（ユーザがすぐ編集できるよう）。
 *
 *  - SensorAlertSettings（センサー個別の除外設定）
 *  - ThresholdTemplateEditDialog（テンプレートに含める除外設定）
 * の両方から共通利用するため、ここに切り出している。
 */
import { useState } from 'react'
import { CalendarOff, ChevronDown, ChevronRight, Clock, Plus, Trash2 } from 'lucide-react'
import type {
  AlertExclusionDate,
  AlertExclusionTarget,
  AlertExclusionWindow,
  DayOfWeek,
} from '../types'
import {
  ALERT_EXCLUSION_TARGET_LABELS,
  DAY_OF_WEEK_LABELS,
  DAY_OF_WEEK_LIST,
  defaultExclusionDate,
  defaultExclusionWindow,
  describeExclusionDate,
  describeExclusionWindow,
  toMinuteOfDay,
} from '../lib/alertExclusion'

const TARGET_KEYS: AlertExclusionTarget[] = ['deviation', 'offline', 'battery']
const TARGET_SHORT_LABELS: Record<AlertExclusionTarget, string> = {
  deviation: '逸脱',
  offline: 'オフライン',
  battery: 'バッテリー',
}

/* ---------- 時間帯エディタ ---------- */

export function ExclusionWindowsEditor({
  windows,
  onChange,
  showHeader = true,
}: {
  windows: AlertExclusionWindow[]
  onChange: (next: AlertExclusionWindow[]) => void
  showHeader?: boolean
}) {
  // 新規追加した直後だけ自動展開する。既存項目は折り畳み開始。
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  function addWindow() {
    const id = `aex-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    const w = defaultExclusionWindow(id)
    setExpandedIds((s) => new Set(s).add(id))
    onChange([...windows, w])
  }
  function updateAt(idx: number, patch: Partial<AlertExclusionWindow>) {
    onChange(windows.map((w, i) => (i === idx ? { ...w, ...patch } : w)))
  }
  function removeAt(idx: number) {
    const removed = windows[idx]
    onChange(windows.filter((_, i) => i !== idx))
    if (removed) {
      setExpandedIds((s) => {
        const next = new Set(s)
        next.delete(removed.id)
        return next
      })
    }
  }
  function toggleExpand(id: string) {
    setExpandedIds((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="exclusion-block">
      {showHeader && (
        <div className="exclusion-block-head">
          <span className="exclusion-block-title">
            <Clock size={14} className="inline-icon" />
            時間帯（毎日 / 曜日指定）
          </span>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={addWindow}
          >
            <Plus size={13} />
            <span>追加</span>
          </button>
        </div>
      )}
      {windows.length === 0 ? (
        <div className="exclusion-empty exclusion-empty-compact">
          時間帯の指定はありません。営業時間外などがあれば追加してください。
        </div>
      ) : (
        <ul className="exclusion-list-compact">
          {windows.map((w, i) => (
            <li key={w.id}>
              <ExclusionWindowEditor
                value={w}
                expanded={expandedIds.has(w.id)}
                onToggleExpand={() => toggleExpand(w.id)}
                onChange={(patch) => updateAt(i, patch)}
                onRemove={() => removeAt(i)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function ExclusionWindowEditor({
  value,
  expanded,
  onToggleExpand,
  onChange,
  onRemove,
}: {
  value: AlertExclusionWindow
  expanded: boolean
  onToggleExpand: () => void
  onChange: (patch: Partial<AlertExclusionWindow>) => void
  onRemove: () => void
}) {
  const startMin = toMinuteOfDay(value.startTime)
  const endMin = toMinuteOfDay(value.endTime)
  const sameTimes = startMin != null && endMin != null && startMin === endMin
  const summary = describeExclusionWindow(value)
  const targetsLabel = value.targets.length === 0
    ? '全種別'
    : value.targets.map((t) => TARGET_SHORT_LABELS[t]).join('・')

  function toggleDow(d: DayOfWeek) {
    const has = value.daysOfWeek.includes(d)
    const next = has
      ? value.daysOfWeek.filter((x) => x !== d)
      : [...value.daysOfWeek, d]
    onChange({ daysOfWeek: next })
  }
  function toggleTarget(t: AlertExclusionTarget) {
    const has = value.targets.includes(t)
    const next = has
      ? value.targets.filter((x) => x !== t)
      : [...value.targets, t]
    onChange({ targets: next })
  }
  const setEveryday = () => onChange({ daysOfWeek: [] })
  const setWeekdays = () => onChange({ daysOfWeek: [1, 2, 3, 4, 5] })
  const setWeekends = () => onChange({ daysOfWeek: [0, 6] })

  return (
    <div
      className={`exclusion-card-compact ${value.enabled ? '' : 'is-disabled'} ${expanded ? 'is-expanded' : ''}`}
    >
      <div className="exclusion-row-header">
        <input
          type="checkbox"
          className="exclusion-row-enable"
          checked={value.enabled}
          onChange={(e) => onChange({ enabled: e.target.checked })}
          aria-label="この除外時間を有効にする"
        />
        <input
          type="text"
          className="form-input exclusion-row-name"
          value={value.label ?? ''}
          placeholder="名称（例: 営業時間外）"
          onChange={(e) => onChange({ label: e.target.value })}
          disabled={!value.enabled}
          aria-label="名称"
        />
        <span className="exclusion-row-summary">{summary}</span>
        <span className="exclusion-row-targets" title={`抑制対象: ${targetsLabel}`}>
          {targetsLabel}
        </span>
        <button
          type="button"
          className="icon-btn exclusion-row-toggle"
          onClick={onToggleExpand}
          aria-expanded={expanded}
          aria-label={expanded ? '折り畳む' : '展開'}
          title={expanded ? '折り畳む' : '展開して編集'}
        >
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <button
          type="button"
          className="icon-btn exclusion-row-remove"
          aria-label="この除外時間を削除"
          onClick={onRemove}
          title="削除"
        >
          <Trash2 size={14} />
        </button>
      </div>

      {expanded && (
        <div className="exclusion-row-body">
          <div className="exclusion-edit-line">
            <span className="exclusion-edit-label">時間帯</span>
            <input
              type="time"
              className="form-input exclusion-time-input"
              value={value.startTime}
              onChange={(e) => onChange({ startTime: e.target.value })}
              disabled={!value.enabled}
            />
            <span className="exclusion-time-sep">〜</span>
            <input
              type="time"
              className="form-input exclusion-time-input"
              value={value.endTime}
              onChange={(e) => onChange({ endTime: e.target.value })}
              disabled={!value.enabled}
            />
            {startMin != null && endMin != null && startMin > endMin && (
              <span className="exclusion-hint">日跨ぎ</span>
            )}
            <span className="exclusion-edit-sep" aria-hidden>|</span>
            <span className="exclusion-edit-label">適用曜日</span>
            <button
              type="button"
              className={`chip-toggle ${value.daysOfWeek.length === 0 ? 'is-active' : ''}`}
              onClick={setEveryday}
              disabled={!value.enabled}
            >
              毎日
            </button>
            <button
              type="button"
              className={`chip-toggle ${
                value.daysOfWeek.length === 5 &&
                [1, 2, 3, 4, 5].every((d) =>
                  value.daysOfWeek.includes(d as DayOfWeek),
                )
                  ? 'is-active'
                  : ''
              }`}
              onClick={setWeekdays}
              disabled={!value.enabled}
            >
              平日
            </button>
            <button
              type="button"
              className={`chip-toggle ${
                value.daysOfWeek.length === 2 &&
                [0, 6].every((d) =>
                  value.daysOfWeek.includes(d as DayOfWeek),
                )
                  ? 'is-active'
                  : ''
              }`}
              onClick={setWeekends}
              disabled={!value.enabled}
            >
              土日
            </button>
            {DAY_OF_WEEK_LIST.map((d) => (
              <label key={d} className="exclusion-dow-mini">
                <input
                  type="checkbox"
                  checked={value.daysOfWeek.includes(d)}
                  onChange={() => toggleDow(d)}
                  disabled={!value.enabled}
                />
                <span>{DAY_OF_WEEK_LABELS[d]}</span>
              </label>
            ))}
          </div>

          <div className="exclusion-edit-line">
            <span className="exclusion-edit-label">抑制するアラート</span>
            {TARGET_KEYS.map((t) => (
              <label key={t} className="exclusion-target-check">
                <input
                  type="checkbox"
                  checked={value.targets.includes(t)}
                  onChange={() => toggleTarget(t)}
                  disabled={!value.enabled}
                />
                <span>{ALERT_EXCLUSION_TARGET_LABELS[t]}</span>
              </label>
            ))}
            {sameTimes && (
              <span className="exclusion-warn">
                開始と終了が同じ。範囲を 1 分以上に。
              </span>
            )}
            {value.targets.length === 0 && !sameTimes && (
              <span className="exclusion-warn">
                抑制対象が選ばれていません
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/* ---------- 除外日エディタ ---------- */

export function ExclusionDatesEditor({
  dates,
  onChange,
  showHeader = true,
}: {
  dates: AlertExclusionDate[]
  onChange: (next: AlertExclusionDate[]) => void
  showHeader?: boolean
}) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  function addDate() {
    const id = `aexd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    const d = defaultExclusionDate(id)
    setExpandedIds((s) => new Set(s).add(id))
    onChange([...dates, d])
  }
  function updateAt(idx: number, patch: Partial<AlertExclusionDate>) {
    onChange(dates.map((d, i) => (i === idx ? { ...d, ...patch } : d)))
  }
  function removeAt(idx: number) {
    const removed = dates[idx]
    onChange(dates.filter((_, i) => i !== idx))
    if (removed) {
      setExpandedIds((s) => {
        const next = new Set(s)
        next.delete(removed.id)
        return next
      })
    }
  }
  function toggleExpand(id: string) {
    setExpandedIds((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="exclusion-block">
      {showHeader && (
        <div className="exclusion-block-head">
          <span className="exclusion-block-title">
            <CalendarOff size={14} className="inline-icon" />
            日付（連休・修理期間など）
          </span>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={addDate}
          >
            <Plus size={13} />
            <span>追加</span>
          </button>
        </div>
      )}
      {dates.length === 0 ? (
        <div className="exclusion-empty exclusion-empty-compact">
          日付の指定はありません。連休や修理期間があれば追加してください。
        </div>
      ) : (
        <ul className="exclusion-list-compact">
          {dates.map((d, i) => (
            <li key={d.id}>
              <ExclusionDateEditor
                value={d}
                expanded={expandedIds.has(d.id)}
                onToggleExpand={() => toggleExpand(d.id)}
                onChange={(patch) => updateAt(i, patch)}
                onRemove={() => removeAt(i)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function ExclusionDateEditor({
  value,
  expanded,
  onToggleExpand,
  onChange,
  onRemove,
}: {
  value: AlertExclusionDate
  expanded: boolean
  onToggleExpand: () => void
  onChange: (patch: Partial<AlertExclusionDate>) => void
  onRemove: () => void
}) {
  const summary = describeExclusionDate(value)
  const invalid =
    !!value.startDate &&
    !!value.endDate &&
    value.endDate < value.startDate
  const targetsLabel = value.targets.length === 0
    ? '全種別'
    : value.targets.map((t) => TARGET_SHORT_LABELS[t]).join('・')

  function toggleTarget(t: AlertExclusionTarget) {
    const has = value.targets.includes(t)
    const next = has
      ? value.targets.filter((x) => x !== t)
      : [...value.targets, t]
    onChange({ targets: next })
  }

  return (
    <div
      className={`exclusion-card-compact ${value.enabled ? '' : 'is-disabled'} ${expanded ? 'is-expanded' : ''}`}
    >
      <div className="exclusion-row-header">
        <input
          type="checkbox"
          className="exclusion-row-enable"
          checked={value.enabled}
          onChange={(e) => onChange({ enabled: e.target.checked })}
          aria-label="この除外日を有効にする"
        />
        <input
          type="text"
          className="form-input exclusion-row-name"
          value={value.label ?? ''}
          placeholder="名称（例: 年末年始）"
          onChange={(e) => onChange({ label: e.target.value })}
          disabled={!value.enabled}
          aria-label="名称"
        />
        <span className="exclusion-row-summary">{summary}</span>
        <span className="exclusion-row-targets" title={`抑制対象: ${targetsLabel}`}>
          {targetsLabel}
        </span>
        <button
          type="button"
          className="icon-btn exclusion-row-toggle"
          onClick={onToggleExpand}
          aria-expanded={expanded}
          aria-label={expanded ? '折り畳む' : '展開'}
          title={expanded ? '折り畳む' : '展開して編集'}
        >
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <button
          type="button"
          className="icon-btn exclusion-row-remove"
          aria-label="この除外日を削除"
          onClick={onRemove}
          title="削除"
        >
          <Trash2 size={14} />
        </button>
      </div>

      {expanded && (
        <div className="exclusion-row-body">
          <div className="exclusion-edit-line">
            <span className="exclusion-edit-label">日付範囲</span>
            <input
              type="date"
              className="form-input exclusion-date-input"
              value={value.startDate}
              onChange={(e) => onChange({ startDate: e.target.value })}
              disabled={!value.enabled}
            />
            <span className="exclusion-time-sep">〜</span>
            <input
              type="date"
              className="form-input exclusion-date-input"
              value={value.endDate}
              onChange={(e) => onChange({ endDate: e.target.value })}
              disabled={!value.enabled}
            />
            {invalid && (
              <span className="exclusion-warn">
                終了日は開始日と同じか、それ以降を指定してください。
              </span>
            )}
            <span className="exclusion-edit-sep" aria-hidden>|</span>
            <span className="exclusion-edit-label">抑制するアラート</span>
            {TARGET_KEYS.map((t) => (
              <label key={t} className="exclusion-target-check">
                <input
                  type="checkbox"
                  checked={value.targets.includes(t)}
                  onChange={() => toggleTarget(t)}
                  disabled={!value.enabled}
                />
                <span>{ALERT_EXCLUSION_TARGET_LABELS[t]}</span>
              </label>
            ))}
            {value.targets.length === 0 && !invalid && (
              <span className="exclusion-warn">
                抑制対象が選ばれていません
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
