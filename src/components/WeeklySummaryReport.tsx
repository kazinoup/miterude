import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type {
  ReportThresholds,
  SensorReading,
  StorageKind,
} from '../types'
import { formatHumRange, formatTempRange } from '../lib/jp'
import {
  activeTempRange,
  isMetricDeviationEnabled,
  summarizeRange,
} from '../lib/report'
import { ensureDate } from '../lib/mock'

const CHART_H_SCREEN = 260

type Props = {
  deviceId: string
  weekStart: Date
  readings: SensorReading[]
  thresholds: ReportThresholds
  storageKind: StorageKind
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

export function WeeklySummaryReport({
  deviceId,
  weekStart,
  readings,
  thresholds,
  storageKind,
}: Props) {
  const range = {
    start: weekStart,
    end: (() => {
      const e = new Date(weekStart)
      e.setDate(e.getDate() + 7)
      return e
    })(),
  }
  const startMs = range.start.getTime()
  const endMs = range.end.getTime()
  const periodReadings = readings.filter((r) => {
    const t = ensureDate(r.measuredAt).getTime()
    return t >= startMs && t < endMs
  })

  const tempSum = summarizeRange(readings, range, 'temperature', thresholds, storageKind)
  const humSum = summarizeRange(readings, range, 'humidity', thresholds, storageKind)

  const chartData = periodReadings.map((r) => ({
    ts: ensureDate(r.measuredAt).getTime(),
    温度: r.temperature,
    湿度: r.humidity,
  }))

  const now = new Date()
  const outputDate = now.toLocaleDateString('ja-JP')
  const tempRange = activeTempRange(storageKind, thresholds)
  const useT = isMetricDeviationEnabled('temperature', thresholds, storageKind)
  const useH = isMetricDeviationEnabled('humidity', thresholds, storageKind)
  const showDeviationRows = useT || useH
  const heroPeriodLabel = formatPeriodWeekJp(weekStart)

  return (
    <div className="report-page summary-page weekly-page">
      <header className="summary-header">
        <h1 className="report-title">温湿度 週次レポート</h1>
        <div className="report-hero-wrap">
          <p className="report-hero-line">
            <span className="report-hero-ym">【{heroPeriodLabel}】</span>
            <span className="report-hero-device">{deviceId}</span>
          </p>
        </div>
        <p className="meta meta-sub">
          対象期間: {heroPeriodLabel} / 出力日: {outputDate}
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
              <p className="no-data">この週のデータがありません。</p>
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
              <p className="no-data">この週のデータがありません。</p>
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
                <td>{useT ? formatTempRange(tempRange.min, tempRange.max) : '—'}</td>
                <td>{useH ? formatHumRange(thresholds.humMin, thresholds.humMax) : '—'}</td>
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
