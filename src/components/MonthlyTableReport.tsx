import { Fragment } from 'react'
import type { SensorThresholds, YearMonth } from '../types'
import {
  buildMonthlyGrid,
  cellIsDeviation,
  daysInMonth,
  formatCellValue,
  getThresholdForMetric,
  isMetricDeviationEnabled,
  summarizeMetric,
} from '../lib/report'
import type { SensorReading } from '../types'
import {
  formatBothThresholdLevels,
  formatPeriodLongJp,
  weekdayJp,
} from '../lib/jp'
import { ReportHeroLine } from './ReportHeroLine'

type Metric = 'temperature' | 'humidity'

type Props = {
  title: string
  metric: Metric
  deviceId: string
  /** 表示用ラベル。未指定なら deviceId にフォールバック。 */
  deviceLabel?: string
  ym: YearMonth
  readings: SensorReading[]
  thresholds: SensorThresholds | undefined
}

export function MonthlyTableReport({
  title,
  metric,
  deviceId,
  deviceLabel,
  ym,
  readings,
  thresholds,
}: Props) {
  const dim = daysInMonth(ym.year, ym.month)
  const grid = buildMonthlyGrid(readings, ym, metric)
  const summary = summarizeMetric(readings, ym, metric, thresholds)
  const decimals = metric === 'temperature' ? 1 : 1
  const showDeviationStats = isMetricDeviationEnabled(thresholds, metric)
  const m = getThresholdForMetric(thresholds, metric)

  return (
    <div className="report-page monthly-page report-numeric">
      <h1 className="monthly-title">{title}</h1>
      <ReportHeroLine ym={ym} deviceId={deviceId} deviceLabel={deviceLabel} />

      <div className="monthly-meta">
        <table className="meta-table">
          <tbody>
            <tr>
              <th>対象期間</th>
              <td>{formatPeriodLongJp(ym.year, ym.month, dim)}</td>
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
            {showDeviationStats && m ? (
              <>
                <th>基準</th>
                <td className="threshold-range-cell">
                  {formatBothThresholdLevels(
                    m.warn,
                    m.alert,
                    metric === 'temperature' ? '℃' : '%',
                  )}
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
        <table className={`monthly-grid ${metric}`}>
          <thead>
            <tr>
              <th className="corner">時刻</th>
              {Array.from({ length: dim }, (_, i) => {
                const day = i + 1
                const wd = weekdayJp(new Date(ym.year, ym.month - 1, day))
                return (
                  <th key={day} className="day-head">
                    {day}日
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
                    {Array.from({ length: dim }, (_, col) => {
                      const v = grid[rowA]?.[col] ?? null
                      const dev = cellIsDeviation(v, metric, thresholds)
                      const text = formatCellValue(v, decimals)
                      return (
                        <td key={col} className={dev ? 'cell-deviation' : ''}>
                          <span className="cell-num">{text}</span>
                        </td>
                      )
                    })}
                  </tr>
                  <tr className="monthly-hour-row monthly-hour-row-sub">
                    {Array.from({ length: dim }, (_, col) => {
                      const v = grid[rowB]?.[col] ?? null
                      const dev = cellIsDeviation(v, metric, thresholds)
                      const text = formatCellValue(v, decimals)
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
