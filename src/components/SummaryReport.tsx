import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { SensorReading, SensorThresholds, YearMonth } from '../types'
import { formatPeriodLongJp, formatThresholdRange } from '../lib/jp'
import {
  daysInMonth,
  filterReadingsForMonth,
  getThresholdForMetric,
  isMetricDeviationEnabled,
  summarizeMetric,
} from '../lib/report'
import { ReportHeroLine } from './ReportHeroLine'

const CHART_H_SCREEN = 260
const xAxisTimeProps = {
  dataKey: 'ts' as const,
  type: 'number' as const,
  domain: ['dataMin', 'dataMax'] as [string, string],
  tick: { fontSize: 10 },
  tickFormatter: (ts: number) =>
    new Date(ts).toLocaleString('ja-JP', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }),
  minTickGap: 28,
}

type Props = {
  deviceId: string
  /** 表示用ラベル（name / deviceNumber など）。未指定なら deviceId にフォールバック。 */
  deviceLabel?: string
  ym: YearMonth
  readings: SensorReading[]
  thresholds: SensorThresholds | undefined
}

export function SummaryReport({
  deviceId,
  deviceLabel,
  ym,
  readings,
  thresholds,
}: Props) {
  const monthReadings = filterReadingsForMonth(readings, ym)
  const lastDay = daysInMonth(ym.year, ym.month)
  const tempSum = summarizeMetric(readings, ym, 'temperature', thresholds)
  const humSum = summarizeMetric(readings, ym, 'humidity', thresholds)

  const chartData = monthReadings.map((r) => ({
    ts: r.measuredAt.getTime(),
    温度: r.temperature,
    湿度: r.humidity,
  }))

  const now = new Date()
  const outputDate = now.toLocaleDateString('ja-JP')
  const tempT = getThresholdForMetric(thresholds, 'temperature')
  const humT = getThresholdForMetric(thresholds, 'humidity')
  const useT = isMetricDeviationEnabled(thresholds, 'temperature')
  const useH = isMetricDeviationEnabled(thresholds, 'humidity')
  const showDeviationRows = useT || useH

  return (
    <div className="report-page summary-page">
      <header className="summary-header">
        <h1 className="report-title">温湿度 月間レポート</h1>
        <ReportHeroLine ym={ym} deviceId={deviceId} deviceLabel={deviceLabel} />
        <p className="meta meta-sub">
          対象期間: {formatPeriodLongJp(ym.year, ym.month, lastDay)} / 出力日: {outputDate}
        </p>
      </header>

      <div className="summary-layout summary-layout-vertical">
        <div className="summary-charts-column">
          <div className="chart-wrap chart-wrap-temp">
          <p className="chart-block-title">温度</p>
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={CHART_H_SCREEN}>
              <LineChart data={chartData} margin={{ top: 12, right: 22, left: 18, bottom: 36 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis {...xAxisTimeProps} />
                <YAxis
                  tick={{ fontSize: 10 }}
                  tickFormatter={(v) => `${v}`}
                  width={48}
                  domain={['auto', 'auto']}
                  label={{
                    value: '温度（℃）',
                    angle: -90,
                    position: 'insideLeft',
                    offset: 8,
                    style: { fill: '#1a6fb5', fontSize: 11, fontWeight: 600 },
                  }}
                />
                <Tooltip
                  labelFormatter={(ts) => new Date(ts as number).toLocaleString('ja-JP')}
                  formatter={(value, name) => {
                    const n = typeof value === 'number' ? value : Number(value)
                    const label = name === '温度' ? `${n.toFixed(1)} ℃` : `${n.toFixed(1)} %`
                    return [label, String(name)]
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="温度"
                  name="温度"
                  stroke="#1a6fb5"
                  dot={false}
                  strokeWidth={2}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <p className="no-data">この月のデータがありません。</p>
          )}
          </div>

          <div className="chart-wrap chart-wrap-hum">
          <p className="chart-block-title">湿度</p>
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={CHART_H_SCREEN}>
              <LineChart data={chartData} margin={{ top: 12, right: 22, left: 18, bottom: 36 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis {...xAxisTimeProps} />
                <YAxis
                  tick={{ fontSize: 10 }}
                  tickFormatter={(v) => `${v}`}
                  width={48}
                  domain={[0, 100]}
                  label={{
                    value: '湿度（%）',
                    angle: -90,
                    position: 'insideLeft',
                    offset: 8,
                    style: { fill: '#b45309', fontSize: 11, fontWeight: 600 },
                  }}
                />
                <Tooltip
                  labelFormatter={(ts) => new Date(ts as number).toLocaleString('ja-JP')}
                  formatter={(value, name) => {
                    const n = typeof value === 'number' ? value : Number(value)
                    const label = name === '温度' ? `${n.toFixed(1)} ℃` : `${n.toFixed(1)} %`
                    return [label, String(name)]
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="湿度"
                  name="湿度"
                  stroke="#b45309"
                  dot={false}
                  strokeWidth={1.8}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <p className="no-data">この月のデータがありません。</p>
          )}
          </div>
        </div>

        <table className="summary-table">
          <thead>
            <tr>
              <th>計測項目</th>
              <th>温度（℃）</th>
              <th>湿度（%）</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th>計測回数</th>
              <td>{tempSum.count}</td>
              <td>{humSum.count}</td>
            </tr>
            {showDeviationRows ? (
              <tr>
                <th>逸脱回数</th>
                <td className={useT && tempSum.deviationCount > 0 ? 'deviation' : ''}>
                  {useT ? tempSum.deviationCount : '—'}
                </td>
                <td className={useH && humSum.deviationCount > 0 ? 'deviation' : ''}>
                  {useH ? humSum.deviationCount : '—'}
                </td>
              </tr>
            ) : null}
            {showDeviationRows ? (
              <tr>
                <th>基準</th>
                <td>
                  {useT && tempT
                    ? formatThresholdRange(tempT.alert.min, tempT.alert.max, '℃')
                    : '—'}
                </td>
                <td>
                  {useH && humT
                    ? formatThresholdRange(humT.alert.min, humT.alert.max, '%')
                    : '—'}
                </td>
              </tr>
            ) : null}
            <tr>
              <th>平均</th>
              <td>{tempSum.avg != null ? `${tempSum.avg.toFixed(1)}℃` : '-'}</td>
              <td>{humSum.avg != null ? `${humSum.avg.toFixed(1)}%` : '-'}</td>
            </tr>
            <tr>
              <th>最大</th>
              <td>{tempSum.max != null ? `${tempSum.max.toFixed(1)}℃` : '-'}</td>
              <td>{humSum.max != null ? `${humSum.max.toFixed(1)}%` : '-'}</td>
            </tr>
            <tr>
              <th>最小</th>
              <td>{tempSum.min != null ? `${tempSum.min.toFixed(1)}℃` : '-'}</td>
              <td>{humSum.min != null ? `${humSum.min.toFixed(1)}%` : '-'}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <footer className="summary-foot">
        <span className="muted">上段: 温度（℃）、中段: 湿度（％）、下段: 集計</span>
      </footer>
    </div>
  )
}
