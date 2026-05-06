import { Fragment } from 'react'
import type {
  MissingDisplay,
  ReportThresholds,
  SensorReading,
  StorageKind,
} from '../types'
import {
  activeTempRange,
  buildWeeklyGrid,
  cellIsDeviation,
  formatCellValue,
  isMetricDeviationEnabled,
  summarizeRange,
} from '../lib/report'
import { weekdayJp, formatHumRange, formatTempRange } from '../lib/jp'

type Metric = 'temperature' | 'humidity'

type Props = {
  title: string
  metric: Metric
  deviceId: string
  weekStart: Date
  readings: SensorReading[]
  thresholds: ReportThresholds
  storageKind: StorageKind
  missingDisplay: MissingDisplay
}

function formatPeriodWeekJp(weekStart: Date): string {
  const end = new Date(weekStart)
  end.setDate(end.getDate() + 6)
  const sm = weekStart.getMonth() + 1
  const em = end.getMonth() + 1
  if (weekStart.getMonth() === end.getMonth()) {
    return `${weekStart.getFullYear()}年${sm}月${weekStart.getDate()}日 〜 ${end.getDate()}日`
  }
  if (weekStart.getFullYear() === end.getFullYear()) {
    return `${weekStart.getFullYear()}年${sm}月${weekStart.getDate()}日 〜 ${em}月${end.getDate()}日`
  }
  return `${weekStart.getFullYear()}年${sm}月${weekStart.getDate()}日 〜 ${end.getFullYear()}年${em}月${end.getDate()}日`
}

export function WeeklyTableReport({
  title,
  metric,
  deviceId,
  weekStart,
  readings,
  thresholds,
  storageKind,
  missingDisplay,
}: Props) {
  const range = {
    start: weekStart,
    end: (() => {
      const e = new Date(weekStart)
      e.setDate(e.getDate() + 7)
      return e
    })(),
  }

  const grid = buildWeeklyGrid(readings, weekStart, metric)
  const summary = summarizeRange(readings, range, metric, thresholds, storageKind)
  const decimals = 1
  const tempR = activeTempRange(storageKind, thresholds)
  const showDeviationStats = isMetricDeviationEnabled(metric, thresholds, storageKind)

  // 週報用ヘッダ表記（「【2024年10月14日 〜 20日】CK01」）
  const heroPeriodLabel = formatPeriodWeekJp(weekStart)

  return (
    <div className="report-page monthly-page report-numeric weekly-page">
      <h1 className="monthly-title">{title}</h1>
      <div className="report-hero-wrap">
        <p className="report-hero-line">
          <span className="report-hero-ym">【{heroPeriodLabel}】</span>
          <span className="report-hero-device">{deviceId}</span>
        </p>
      </div>

      <div className="monthly-meta">
        <table className="meta-table">
          <tbody>
            <tr>
              <th>対象期間</th>
              <td>{formatPeriodWeekJp(weekStart)}</td>
            </tr>
          </tbody>
        </table>
        <table className="stamp-row" aria-hidden="true">
          <tbody>
            <tr>
              <td className="stamp">確認</td>
              <td className="stamp">確認</td>
              <td className="stamp">確認</td>
            </tr>
          </tbody>
        </table>
      </div>

      <table className="stats-row">
        <tbody>
          <tr>
            <th>計測項目</th>
            <td>{metric === 'temperature' ? '温度' : '湿度'}</td>
            <th>計測回数</th>
            <td>{summary.count}</td>
            {showDeviationStats ? (
              <>
                <th>基準</th>
                <td>
                  {metric === 'temperature'
                    ? formatTempRange(tempR.min, tempR.max)
                    : formatHumRange(thresholds.humMin, thresholds.humMax)}
                </td>
                <th>逸脱回数</th>
                <td className={summary.deviationCount > 0 ? 'deviation' : ''}>
                  {summary.deviationCount}
                </td>
              </>
            ) : null}
            <th>平均</th>
            <td>
              {summary.avg != null
                ? metric === 'temperature'
                  ? `${summary.avg.toFixed(1)}℃`
                  : `${summary.avg.toFixed(1)}%`
                : '-'}
            </td>
            <th>最小</th>
            <td>
              {summary.min != null
                ? metric === 'temperature'
                  ? `${summary.min.toFixed(1)}℃`
                  : `${summary.min.toFixed(1)}%`
                : '-'}
            </td>
            <th>最大</th>
            <td>
              {summary.max != null
                ? metric === 'temperature'
                  ? `${summary.max.toFixed(1)}℃`
                  : `${summary.max.toFixed(1)}%`
                : '-'}
            </td>
          </tr>
        </tbody>
      </table>

      <div className="monthly-table-scroll">
        <table className={`monthly-grid weekly-grid ${metric}`}>
          <thead>
            <tr>
              <th className="corner">時刻</th>
              {Array.from({ length: 7 }, (_, i) => {
                const d = new Date(weekStart)
                d.setDate(d.getDate() + i)
                const wd = weekdayJp(d)
                return (
                  <th key={i} className="day-head">
                    {d.getMonth() + 1}/{d.getDate()}
                    <span className="wd">({wd})</span>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 24 }, (_, hour) => {
              const rowA = hour * 2
              const rowB = hour * 2 + 1
              return (
                <Fragment key={hour}>
                  <tr className="monthly-hour-row">
                    <th rowSpan={2} className="row-head-hour">
                      {hour}時
                    </th>
                    {Array.from({ length: 7 }, (_, col) => {
                      const v = grid[rowA]?.[col] ?? null
                      const dev = cellIsDeviation(v, metric, thresholds, storageKind)
                      const text = formatCellValue(v, missingDisplay, decimals)
                      return (
                        <td key={col} className={dev ? 'cell-deviation' : ''}>
                          <span className="cell-num">{text}</span>
                        </td>
                      )
                    })}
                  </tr>
                  <tr className="monthly-hour-row monthly-hour-row-sub">
                    {Array.from({ length: 7 }, (_, col) => {
                      const v = grid[rowB]?.[col] ?? null
                      const dev = cellIsDeviation(v, metric, thresholds, storageKind)
                      const text = formatCellValue(v, missingDisplay, decimals)
                      return (
                        <td key={col} className={dev ? 'cell-deviation' : ''}>
                          <span className="cell-num">{text}</span>
                        </td>
                      )
                    })}
                  </tr>
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      <table className="remarks">
        <tbody>
          <tr>
            <th className="remarks-label">備考</th>
            <td className="remarks-body-cell">
              <div className="remarks-write-area" aria-label="備考（手書き用）" />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}
