/**
 * レポート定期配信の編集ダイアログ — Phase G
 *
 * 配信形式は当面リンク方式（メール本文にレポート閲覧用リンクを載せる）。
 * 添付配信は将来追加。ここでは「いつ・誰に・何を」だけ設定する。
 */
import { useEffect, useRef, useState } from 'react'
import { X, Trash2, FileBarChart2, Send } from 'lucide-react'
import type {
  NotificationGroupStore,
  ReportKind,
  ReportSchedule,
  SensorStore,
} from '../types'
import { NOTIFICATION_TIMING_LABELS } from '../types'
import { formatSensorLabel } from '../lib/sensorLabel'

type Props = {
  open: boolean
  initial: ReportSchedule | null
  notificationGroups: NotificationGroupStore
  sensors: SensorStore
  onClose: () => void
  onSubmit: (schedule: ReportSchedule) => void
  onDelete?: (id: string) => void
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'] as const

function nextScheduleId(): string {
  return `rs-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function ReportScheduleEditDialog({
  open,
  initial,
  notificationGroups,
  sensors,
  onClose,
  onSubmit,
  onDelete,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const [name, setName] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [reportKind, setReportKind] = useState<ReportKind>('weekly')
  const [targetSensorIds, setTargetSensorIds] = useState<string[]>([])
  const [notificationGroupId, setNotificationGroupId] = useState<string | null>(
    null,
  )
  const [deliveryTime, setDeliveryTime] = useState('09:00')
  const [weeklyDayOfWeek, setWeeklyDayOfWeek] = useState<number>(1)
  const [monthlyDayOfMonth, setMonthlyDayOfMonth] = useState<number>(1)

  useEffect(() => {
    if (!open) return
    if (initial) {
      setName(initial.name)
      setEnabled(initial.enabled)
      setReportKind(initial.reportKind)
      setTargetSensorIds([...initial.targetSensorIds])
      setNotificationGroupId(initial.notificationGroupId)
      setDeliveryTime(initial.deliveryTime)
      setWeeklyDayOfWeek(initial.weeklyDayOfWeek ?? 1)
      setMonthlyDayOfMonth(initial.monthlyDayOfMonth ?? 1)
    } else {
      setName('')
      setEnabled(true)
      setReportKind('weekly')
      setTargetSensorIds([])
      setNotificationGroupId(null)
      setDeliveryTime('09:00')
      setWeeklyDayOfWeek(1)
      setMonthlyDayOfMonth(1)
    }
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
      alert('表示名を入力してください。')
      return
    }
    const now = new Date()
    if (initial) {
      onSubmit({
        ...initial,
        name: trimmed,
        enabled,
        reportKind,
        targetSensorIds,
        notificationGroupId,
        deliveryTime,
        weeklyDayOfWeek: reportKind === 'weekly' ? weeklyDayOfWeek : undefined,
        monthlyDayOfMonth:
          reportKind === 'monthly' ? monthlyDayOfMonth : undefined,
        updatedAt: now,
      })
    } else {
      onSubmit({
        id: nextScheduleId(),
        name: trimmed,
        enabled,
        reportKind,
        targetSensorIds,
        notificationGroupId,
        deliveryTime,
        weeklyDayOfWeek: reportKind === 'weekly' ? weeklyDayOfWeek : undefined,
        monthlyDayOfMonth:
          reportKind === 'monthly' ? monthlyDayOfMonth : undefined,
        createdAt: now,
        updatedAt: now,
      })
    }
  }

  function handleDelete() {
    if (!initial || !onDelete) return
    if (!confirm(`定期配信「${initial.name}」を削除しますか？`)) return
    onDelete(initial.id)
  }

  function toggleSensor(id: string) {
    setTargetSensorIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }

  const sensorList = Object.values(sensors).sort((a, b) =>
    (a.name ?? a.id).localeCompare(b.name ?? b.id),
  )

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
          <h2>
            <FileBarChart2 size={16} className="head-icon" />
            {initial ? 'レポート定期配信を編集' : 'レポート定期配信を作成'}
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
          <div className="form-row">
            <label className="form-label" htmlFor="rs-name">
              表示名
            </label>
            <input
              id="rs-name"
              className="form-input"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例: 全センサーの週次レポート"
              maxLength={100}
              required
            />
          </div>

          <div className="form-row">
            <label className="check-row">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              <span>有効化（OFF にすると配信停止）</span>
            </label>
          </div>

          <div className="form-row">
            <span className="form-label">配信内容</span>
            <div className="seg-toggle">
              <button
                type="button"
                className={`seg-toggle-btn ${reportKind === 'weekly' ? 'is-active' : ''}`}
                onClick={() => setReportKind('weekly')}
              >
                週報
              </button>
              <button
                type="button"
                className={`seg-toggle-btn ${reportKind === 'monthly' ? 'is-active' : ''}`}
                onClick={() => setReportKind('monthly')}
              >
                月報
              </button>
            </div>
          </div>

          {/* 配信タイミング */}
          <div className="form-row">
            <span className="form-label">配信タイミング</span>
            <div className="schedule-time-row">
              {reportKind === 'weekly' ? (
                <>
                  <label className="inline-field">
                    <span>毎週</span>
                    <select
                      className="select"
                      value={weeklyDayOfWeek}
                      onChange={(e) =>
                        setWeeklyDayOfWeek(Number(e.target.value))
                      }
                    >
                      {WEEKDAYS.map((wd, i) => (
                        <option key={i} value={i}>
                          {wd}曜日
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              ) : (
                <label className="inline-field">
                  <span>毎月</span>
                  <select
                    className="select"
                    value={monthlyDayOfMonth}
                    onChange={(e) =>
                      setMonthlyDayOfMonth(Number(e.target.value))
                    }
                  >
                    {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                      <option key={d} value={d}>
                        {d}日
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="inline-field">
                <span>に</span>
                <input
                  type="time"
                  className="select"
                  value={deliveryTime}
                  onChange={(e) => setDeliveryTime(e.target.value)}
                  step={60}
                  required
                />
              </label>
            </div>
            <p className="muted in-panel small-hint">
              指定時刻にレポート閲覧用のリンクを配信します（添付ファイルは現状未対応）。
            </p>
          </div>

          {/* 配信先 */}
          <div className="form-row">
            <label className="form-label" htmlFor="rs-group">
              配信先（通知グループ）
              <Send size={11} className="inline-icon-muted" />
            </label>
            <select
              id="rs-group"
              className="select"
              value={notificationGroupId ?? ''}
              onChange={(e) => setNotificationGroupId(e.target.value || null)}
            >
              <option value="">未設定（配信されません）</option>
              {Object.values(notificationGroups)
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}（{NOTIFICATION_TIMING_LABELS[g.timing]}・{g.channels.length} 件）
                  </option>
                ))}
            </select>
            {notificationGroupId == null && (
              <p className="muted in-panel small-hint">
                通知グループを未設定にすると配信されません。「通知グループ」セクションで送信先を作成してください。
              </p>
            )}
          </div>

          {/* 対象センサー */}
          <div className="form-row">
            <span className="form-label">
              対象センサー
              <span className="muted">
                {' '}
                ({targetSensorIds.length === 0
                  ? '全センサー'
                  : `${targetSensorIds.length} 台選択中`})
              </span>
            </span>
            <div className="schedule-target-list">
              {sensorList.length === 0 ? (
                <p className="muted in-panel">登録済みのセンサーがありません。</p>
              ) : (
                <>
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={targetSensorIds.length === 0}
                      onChange={(e) => {
                        if (e.target.checked) setTargetSensorIds([])
                        else setTargetSensorIds(sensorList.map((s) => s.id))
                      }}
                    />
                    <span>全センサーを対象にする</span>
                  </label>
                  {targetSensorIds.length > 0 &&
                    sensorList.map((s) => (
                      <label key={s.id} className="check-row">
                        <input
                          type="checkbox"
                          checked={targetSensorIds.includes(s.id)}
                          onChange={() => toggleSensor(s.id)}
                        />
                        <span>{formatSensorLabel(s)}</span>
                      </label>
                    ))}
                </>
              )}
            </div>
          </div>
        </div>

        <footer className="app-dialog-foot">
          {initial && onDelete && (
            <button
              type="button"
              className="btn btn-ghost bulk-danger"
              onClick={handleDelete}
            >
              <Trash2 size={14} />
              <span>削除</span>
            </button>
          )}
          <div className="app-dialog-foot-spacer" />
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            キャンセル
          </button>
          <button type="submit" className="btn btn-primary">
            保存
          </button>
        </footer>
      </form>
    </dialog>
  )
}
