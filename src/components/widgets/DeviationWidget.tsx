import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  ChevronsUpDown,
  Maximize2,
  Minimize2,
} from 'lucide-react'
import type {
  DeviceStore,
  DeviationWidget as DeviationWidgetT,
  ReportThresholds,
  SensorStore,
} from '../../types'
import {
  collectYearMonths,
  extractDeviationSegments,
  inferStorageKind,
  type DeviationSegment,
} from '../../lib/report'

type Props = {
  widget: DeviationWidgetT
  devices: DeviceStore
  sensors: SensorStore
  thresholds: ReportThresholds
  effectiveSensorIds: string[]
  range: { start: Date; end: Date }
  periodLabel?: string
  onOpenSensor: (id: string) => void
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

function DirectionIcon({ direction }: { direction: DeviationSegment['direction'] }) {
  if (direction === 'above') return <ChevronUp size={12} />
  if (direction === 'below') return <ChevronDown size={12} />
  return <ChevronsUpDown size={12} />
}

type SensorBucket = {
  sensorId: string
  sensorName: string
  segments: DeviationSegment[]
  countByMetric: { temperature: number; humidity: number }
  /** 期間内で最も古い逸脱開始時刻 */
  earliestStart: Date
  /** 期間内で最新の逸脱終了時刻 */
  latestEnd: Date
}

export function DeviationWidget({
  widget: _widget,
  devices,
  sensors,
  thresholds,
  effectiveSensorIds,
  range,
  periodLabel,
  onOpenSensor,
}: Props) {
  // sensorId → 該当する逸脱セグメント配列に集約
  const buckets: SensorBucket[] = useMemo(() => {
    const map = new Map<string, SensorBucket>()
    for (const id of effectiveSensorIds) {
      const sensor = sensors[id]
      if (!sensor) continue
      const readings = devices[id] ?? []
      if (readings.length === 0) continue

      const months = collectYearMonths(readings)
      const lastYm = months[months.length - 1]
      const storageKind = lastYm ? inferStorageKind(readings, lastYm) : 'other'

      const allSegs: DeviationSegment[] = []
      for (const m of ['temperature', 'humidity'] as const) {
        const segs = extractDeviationSegments(readings, range, m, thresholds, storageKind)
        for (const s of segs) {
          allSegs.push({ ...s, sensorId: id })
        }
      }
      if (allSegs.length === 0) continue

      // セグメントを開始時刻の新しい順にソート
      allSegs.sort((a, b) => b.start.getTime() - a.start.getTime())

      const countByMetric = {
        temperature: allSegs.filter((s) => s.metric === 'temperature').length,
        humidity: allSegs.filter((s) => s.metric === 'humidity').length,
      }
      const earliestStart = new Date(
        Math.min(...allSegs.map((s) => s.start.getTime())),
      )
      const latestEnd = new Date(
        Math.max(...allSegs.map((s) => s.end.getTime())),
      )

      map.set(id, {
        sensorId: id,
        sensorName: sensor.id,
        segments: allSegs,
        countByMetric,
        earliestStart,
        latestEnd,
      })
    }
    // 件数の多い順、同数ならセンサー名で
    return Array.from(map.values()).sort((a, b) => {
      if (b.segments.length !== a.segments.length) {
        return b.segments.length - a.segments.length
      }
      return a.sensorName.localeCompare(b.sensorName)
    })
  }, [effectiveSensorIds, devices, sensors, thresholds, range])

  // 展開状態（センサー単位）
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  function toggle(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function expandAll() {
    setExpandedIds(new Set(buckets.map((b) => b.sensorId)))
  }

  function collapseAll() {
    setExpandedIds(new Set())
  }

  if (effectiveSensorIds.length === 0) {
    return (
      <p className="muted in-panel">
        対象センサーがありません。ダッシュボード設定でセンサーを追加してください。
      </p>
    )
  }

  if (buckets.length === 0) {
    return (
      <div className="deviation-empty">
        <CheckCircle2 size={18} />
        <span>
          {periodLabel ? `${periodLabel} の間、` : ''}
          逸脱はありませんでした。
        </span>
      </div>
    )
  }

  const totalSegments = buckets.reduce((n, b) => n + b.segments.length, 0)
  const allExpanded = buckets.every((b) => expandedIds.has(b.sensorId))

  return (
    <div className="deviation-widget">
      <div className="deviation-summary-bar">
        <span>
          <strong>{buckets.length}</strong> 台で計{' '}
          <strong className="cell-deviation">{totalSegments}</strong> 件の逸脱
        </span>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={allExpanded ? collapseAll : expandAll}
        >
          {allExpanded ? (
            <>
              <Minimize2 size={13} /> <span>すべて閉じる</span>
            </>
          ) : (
            <>
              <Maximize2 size={13} /> <span>すべて展開</span>
            </>
          )}
        </button>
      </div>

      <ul className="deviation-bucket-list">
        {buckets.map((b) => {
          const expanded = expandedIds.has(b.sensorId)
          const onlyOne = b.segments.length === 1
          // 1件しかない場合は内容をその場で簡潔に表示（展開不要）
          const showSegments = expanded || onlyOne

          return (
            <li key={b.sensorId} className="deviation-bucket">
              <button
                type="button"
                className={`deviation-bucket-head ${expanded ? 'is-expanded' : ''}`}
                onClick={() => (onlyOne ? onOpenSensor(b.sensorId) : toggle(b.sensorId))}
                aria-expanded={expanded}
              >
                <span className="deviation-bucket-toggle">
                  {onlyOne ? (
                    <ChevronRight size={14} />
                  ) : expanded ? (
                    <ChevronDown size={14} />
                  ) : (
                    <ChevronRight size={14} />
                  )}
                </span>
                <span className="deviation-bucket-name">
                  <AlertTriangle size={13} className="cell-deviation" />
                  <strong>{b.sensorName}</strong>
                </span>
                <span className="deviation-bucket-counts">
                  <span className="cell-deviation">{b.segments.length}</span> 件
                  {(b.countByMetric.temperature > 0 || b.countByMetric.humidity > 0) && (
                    <span className="muted">
                      （
                      {b.countByMetric.temperature > 0 &&
                        `温度 ${b.countByMetric.temperature}`}
                      {b.countByMetric.temperature > 0 &&
                        b.countByMetric.humidity > 0 &&
                        ' / '}
                      {b.countByMetric.humidity > 0 &&
                        `湿度 ${b.countByMetric.humidity}`}
                      ）
                    </span>
                  )}
                </span>
                <span className="deviation-bucket-range muted">
                  {fmtSlot(b.earliestStart)} 〜 {fmtSlot(b.latestEnd)}
                </span>
                <button
                  type="button"
                  className="link-btn deviation-bucket-open"
                  onClick={(e) => {
                    e.stopPropagation()
                    onOpenSensor(b.sensorId)
                  }}
                >
                  詳細
                </button>
              </button>

              {showSegments && (
                <ul className="deviation-segment-sublist">
                  {b.segments.map((s, i) => (
                    <li
                      key={`${s.metric}-${s.start.getTime()}-${i}`}
                      className="deviation-sub-row"
                    >
                      <span className="dev-sub-kind">
                        {metricLabel(s.metric)} {directionLabel(s.direction)}{' '}
                        <DirectionIcon direction={s.direction} />
                      </span>
                      <span className="dev-sub-time">
                        {fmtSlot(s.start)} 〜 {fmtSlot(s.end)}
                      </span>
                      <span className="dev-sub-meta">
                        {durationLabel(s.slotCount)}
                      </span>
                      <span className="dev-sub-extreme cell-deviation">
                        最
                        {s.direction === 'above'
                          ? '大'
                          : s.direction === 'below'
                            ? '小'
                            : '値'}{' '}
                        {s.extremeValue.toFixed(1)}
                        {metricUnit(s.metric)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          )
        })}
      </ul>

      <p className="muted in-panel deviation-foot-note">
        ※ 連続する逸脱は 1 件にまとめています。一度正常に戻ると別の件として記録されます。
      </p>
    </div>
  )
}
