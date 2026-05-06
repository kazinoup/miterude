import { useEffect, useMemo, useRef, useState } from 'react'
import {
  X,
  ClipboardCheck,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
} from 'lucide-react'
import type {
  CheckinSegmentComment,
  CheckinSensorComment,
  Dashboard,
  DashboardCheckin,
  DashboardCheckinStatus,
  DeviceStore,
  ReportThresholds,
  SensorStore,
  UserSession,
} from '../types'
import {
  collectDashboardSensorIds,
  countOnline,
  createCheckin,
  detectDeviationsForRange,
  type SensorDeviationGroup,
} from '../lib/records'
import type { DeviationSegment } from '../lib/report'

type Props = {
  open: boolean
  dashboard: Dashboard | null
  devices: DeviceStore
  sensors: SensorStore
  thresholds: ReportThresholds
  session: UserSession
  /** ダッシュボードで現在表示している期間 */
  range: { start: Date; end: Date }
  /** 期間ラベル（例: "直近 1 日"、"前回確認 (24h前) からの差分"） */
  periodLabel: string
  onClose: () => void
  onSubmit: (checkin: DashboardCheckin) => void
}

function fmtSlot(d: Date): string {
  return d.toLocaleString('ja-JP', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function durationLabel(slotCount: number): string {
  if (slotCount === 1) return '30 分'
  const totalMin = slotCount * 30
  if (totalMin < 60) return `${totalMin} 分`
  const hours = Math.floor(totalMin / 60)
  const mins = totalMin % 60
  if (mins === 0) return `${hours} 時間`
  return `${hours} 時間 ${mins} 分`
}

function metricLabel(metric: 'temperature' | 'humidity'): string {
  return metric === 'temperature' ? '温度' : '湿度'
}

function metricUnit(metric: 'temperature' | 'humidity'): string {
  return metric === 'temperature' ? '℃' : '%'
}

function directionLabel(d: DeviationSegment['direction']): string {
  if (d === 'above') return '上限超え'
  if (d === 'below') return '下限割れ'
  return '上下動'
}

function segmentKey(sensorId: string, s: DeviationSegment): string {
  return `${sensorId}|${s.metric}|${s.start.getTime()}`
}

export function DashboardConfirmDialog({
  open,
  dashboard,
  devices,
  sensors,
  thresholds,
  session,
  range,
  periodLabel,
  onClose,
  onSubmit,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const [status, setStatus] = useState<DashboardCheckinStatus>('no-issue')
  const [overallComment, setOverallComment] = useState('')
  /** センサー単位のメモ */
  const [sensorMemos, setSensorMemos] = useState<Record<string, string>>({})
  /** 個別セグメントのメモ（key = `sensorId|metric|startMs`） */
  const [segmentMemos, setSegmentMemos] = useState<Record<string, string>>({})
  const [expandedSensors, setExpandedSensors] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!open) return
    setStatus('no-issue')
    setOverallComment('')
    setSensorMemos({})
    setSegmentMemos({})
    setExpandedSensors(new Set())
  }, [open, dashboard])

  useEffect(() => {
    const dlg = ref.current
    if (!dlg) return
    if (open && !dlg.open) dlg.showModal()
    if (!open && dlg.open) dlg.close()
  }, [open])

  const dashboardSensorIds = useMemo(
    () => (dashboard ? collectDashboardSensorIds(dashboard) : []),
    [dashboard],
  )

  const deviations: SensorDeviationGroup[] = useMemo(() => {
    if (!dashboard) return []
    return detectDeviationsForRange(
      dashboardSensorIds,
      devices,
      sensors,
      thresholds,
      range,
    )
  }, [dashboard, dashboardSensorIds, devices, sensors, thresholds, range])

  const onlineCount = useMemo(
    () => countOnline(dashboardSensorIds, sensors),
    [dashboardSensorIds, sensors],
  )

  function toggleExpand(sensorId: string) {
    setExpandedSensors((prev) => {
      const next = new Set(prev)
      if (next.has(sensorId)) next.delete(sensorId)
      else next.add(sensorId)
      return next
    })
  }

  function expandAll() {
    setExpandedSensors(new Set(deviations.map((d) => d.sensorId)))
  }

  function collapseAll() {
    setExpandedSensors(new Set())
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!dashboard) return

    const sensorComments: CheckinSensorComment[] = deviations.map((d) => {
      const segComments: CheckinSegmentComment[] = d.segments.map((s) => ({
        metric: s.metric,
        direction: s.direction,
        start: s.start,
        end: s.end,
        slotCount: s.slotCount,
        extremeValue: s.extremeValue,
        memo: (segmentMemos[segmentKey(d.sensorId, s)] ?? '').trim(),
      }))
      return {
        sensorId: d.sensorId,
        sensorName: d.sensorName,
        deviationKinds: d.deviationKinds,
        detectedTemp: d.detectedTemp,
        detectedHum: d.detectedHum,
        comment: (sensorMemos[d.sensorId] ?? '').trim(),
        segmentComments: segComments,
      }
    })

    // lookbackHours は範囲から逆算（時間単位）
    const lookbackHours = Math.max(
      1,
      Math.round((range.end.getTime() - range.start.getTime()) / (60 * 60 * 1000)),
    )

    const checkin = createCheckin({
      dashboard,
      user: session,
      comment: overallComment,
      sensorComments,
      snapshot: {
        sensorCount: dashboardSensorIds.length,
        onlineCount,
        deviationSensorCount: deviations.length,
        lookbackHours,
        periodLabel,
        rangeStart: range.start,
        rangeEnd: range.end,
      },
    })

    onSubmit({ ...checkin, status })
  }

  if (!dashboard) return null

  const hasDeviations = deviations.length > 0
  const allExpanded = hasDeviations && deviations.every((d) => expandedSensors.has(d.sensorId))

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
            <ClipboardCheck size={18} className="head-icon" />
            確認を記録
          </h2>
          <button type="button" className="icon-btn" aria-label="閉じる" onClick={onClose}>
            <X size={16} />
          </button>
        </header>

        <div className="app-dialog-body">
          {/* メタ情報 */}
          <div className="checkin-meta">
            <div>
              <span className="checkin-meta-label">対象</span>
              <strong>{dashboard.name}</strong>
            </div>
            <div>
              <span className="checkin-meta-label">確認者</span>
              <strong>{session.userName}</strong>
            </div>
            <div>
              <span className="checkin-meta-label">対象期間</span>
              <strong>{periodLabel}</strong>
            </div>
            <div>
              <span className="checkin-meta-label">センサー</span>
              <strong>
                {dashboardSensorIds.length} 台 ／ オンライン {onlineCount}
              </strong>
            </div>
          </div>

          {/* 異常の有無 */}
          <div className="form-row">
            <label className="form-label">異常の有無</label>
            <div className="status-toggle">
              <label
                className={`status-card ${status === 'no-issue' ? 'is-active is-no-issue' : ''}`}
              >
                <input
                  type="radio"
                  name="checkin-status"
                  checked={status === 'no-issue'}
                  onChange={() => setStatus('no-issue')}
                />
                <CheckCircle2 size={16} />
                <span>異常なし</span>
              </label>
              <label
                className={`status-card ${status === 'has-issue' ? 'is-active is-has-issue' : ''}`}
              >
                <input
                  type="radio"
                  name="checkin-status"
                  checked={status === 'has-issue'}
                  onChange={() => setStatus('has-issue')}
                />
                <AlertTriangle size={16} />
                <span>異常あり</span>
              </label>
            </div>
          </div>

          {/* 全体メモ */}
          <div className="form-row">
            <label className="form-label" htmlFor="checkin-overall">
              全体メモ（任意）
            </label>
            <textarea
              id="checkin-overall"
              className="form-input form-textarea"
              placeholder="例: 異常なし、定例点検済み、清掃中で扉開放のため一時的な上昇あり、など"
              rows={2}
              value={overallComment}
              onChange={(e) => setOverallComment(e.target.value)}
              maxLength={500}
            />
          </div>

          {/* 逸脱センサー */}
          <div className="form-row">
            <div className="form-label-row">
              <label className="form-label">
                <AlertTriangle size={13} className="row-leading-icon" />
                期間内の逸脱センサー
                <span className="form-label-meta">
                  {deviations.length === 0
                    ? '（該当なし）'
                    : `${deviations.length} 台 / 計 ${deviations.reduce(
                        (n, d) => n + d.segments.length,
                        0,
                      )} 件`}
                </span>
              </label>
              {hasDeviations && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={allExpanded ? collapseAll : expandAll}
                >
                  {allExpanded ? (
                    <>
                      <ChevronsDownUp size={13} />
                      <span>すべて閉じる</span>
                    </>
                  ) : (
                    <>
                      <ChevronsUpDown size={13} />
                      <span>すべて展開</span>
                    </>
                  )}
                </button>
              )}
            </div>

            {!hasDeviations ? (
              <div className="checkin-empty">
                <CheckCircle2 size={18} />
                <span>確認時点では逸脱はありませんでした。</span>
              </div>
            ) : (
              <ul className="checkin-deviation-list">
                {deviations.map((d) => {
                  const expanded = expandedSensors.has(d.sensorId)
                  return (
                    <li key={d.sensorId} className="checkin-deviation-item">
                      <button
                        type="button"
                        className="checkin-deviation-head"
                        onClick={() => toggleExpand(d.sensorId)}
                        aria-expanded={expanded}
                      >
                        {expanded ? (
                          <ChevronDown size={14} />
                        ) : (
                          <ChevronRight size={14} />
                        )}
                        <span className="checkin-deviation-name">
                          <AlertTriangle size={13} className="cell-deviation" />
                          <strong>{d.sensorName}</strong>
                        </span>
                        <span className="checkin-deviation-counts muted">
                          逸脱 <strong className="cell-deviation">{d.segments.length}</strong> 件
                          {(d.countByMetric.temperature > 0 || d.countByMetric.humidity > 0) && (
                            <>
                              （
                              {d.countByMetric.temperature > 0 &&
                                `温度 ${d.countByMetric.temperature}`}
                              {d.countByMetric.temperature > 0 &&
                                d.countByMetric.humidity > 0 &&
                                ' / '}
                              {d.countByMetric.humidity > 0 &&
                                `湿度 ${d.countByMetric.humidity}`}
                              ）
                            </>
                          )}
                        </span>
                      </button>

                      {/* センサー単位のメモ（常に見える） */}
                      <div className="checkin-sensor-memo">
                        <textarea
                          className="form-input form-textarea"
                          placeholder="状況・対策メモ（例: 清掃中で扉開放、12:30 配送出庫など）"
                          rows={2}
                          value={sensorMemos[d.sensorId] ?? ''}
                          onChange={(e) =>
                            setSensorMemos((prev) => ({
                              ...prev,
                              [d.sensorId]: e.target.value,
                            }))
                          }
                          maxLength={300}
                        />
                        {!expanded && d.segments.length > 1 && (
                          <button
                            type="button"
                            className="link-btn"
                            onClick={() => toggleExpand(d.sensorId)}
                          >
                            個別の時間帯ごとに記録する（{d.segments.length} 件）
                          </button>
                        )}
                      </div>

                      {/* 展開時：セグメント単位のメモ */}
                      {expanded && (
                        <ul className="checkin-segment-list">
                          {d.segments.map((s) => {
                            const key = segmentKey(d.sensorId, s)
                            return (
                              <li key={key} className="checkin-segment-item">
                                <header className="checkin-segment-head">
                                  <span className="checkin-segment-kind">
                                    {metricLabel(s.metric)}{' '}
                                    {directionLabel(s.direction)}
                                  </span>
                                  <span className="checkin-segment-time">
                                    {fmtSlot(s.start)} 〜 {fmtSlot(s.end)}
                                  </span>
                                  <span className="muted">
                                    {durationLabel(s.slotCount)}
                                  </span>
                                  <span className="cell-deviation">
                                    最
                                    {s.direction === 'above'
                                      ? '大'
                                      : s.direction === 'below'
                                        ? '小'
                                        : '値'}{' '}
                                    {s.extremeValue.toFixed(1)}
                                    {metricUnit(s.metric)}
                                  </span>
                                </header>
                                <textarea
                                  className="form-input form-textarea checkin-segment-memo"
                                  placeholder="この時間帯の状況メモ（任意）"
                                  rows={1}
                                  value={segmentMemos[key] ?? ''}
                                  onChange={(e) =>
                                    setSegmentMemos((prev) => ({
                                      ...prev,
                                      [key]: e.target.value,
                                    }))
                                  }
                                  maxLength={200}
                                />
                              </li>
                            )
                          })}
                        </ul>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>

        <footer className="app-dialog-foot">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            キャンセル
          </button>
          <button type="submit" className="btn btn-primary">
            <ClipboardCheck size={14} />
            <span>確認を記録</span>
          </button>
        </footer>
      </form>
    </dialog>
  )
}
