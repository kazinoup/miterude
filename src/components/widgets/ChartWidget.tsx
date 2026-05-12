import { useMemo } from 'react'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { AlertCircle } from 'lucide-react'
import type {
  ChartWidget as ChartWidgetT,
  DeviceStore,
  SensorStore,
} from '../../types'
import { ensureDate } from '../../lib/mock'

type Props = {
  widget: ChartWidgetT
  devices: DeviceStore
  sensors: SensorStore
  /** ダッシュボードから渡される対象センサー（絞り込み後） */
  effectiveSensorIds: string[]
  /** ダッシュボードから渡される対象期間 */
  range: { start: Date; end: Date }
  /** 期間粒度（X軸フォーマットに使用） */
  fineGrain: boolean
}

/** 配色: ネイビー基調 + 湿度用アンバー + グレー段階。最大8系列。 */
const SENSOR_COLORS = [
  '#0f2744',
  '#1a6fb5',
  '#1a1a1a',
  '#4f7cb1',
  '#b45309',
  '#14365e',
  '#6b7480',
  '#2f3542',
]

function fmtTime(d: Date, fineGrain: boolean): string {
  if (fineGrain) {
    return d.toLocaleString('ja-JP', { hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleString('ja-JP', { month: '2-digit', day: '2-digit' })
}

function fmtTooltip(d: Date): string {
  return d.toLocaleString('ja-JP', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function ChartWidget({
  widget,
  devices,
  sensors,
  effectiveSensorIds,
  range,
  fineGrain,
}: Props) {
  const { metric } = widget

  const merged = useMemo(() => {
    const tsMap = new Map<number, Record<string, number | undefined>>()
    const startMs = range.start.getTime()
    const endMs = range.end.getTime()
    for (const id of effectiveSensorIds) {
      const rs = devices[id] ?? []
      for (const r of rs) {
        const ts = ensureDate(r.measuredAt).getTime()
        if (ts < startMs || ts >= endMs) continue
        const row = tsMap.get(ts) ?? { ts }
        row[id] = metric === 'temperature' ? r.temperature : r.humidity
        tsMap.set(ts, row)
      }
    }
    return Array.from(tsMap.values())
      .map((r) => ({ ...(r as { ts: number } & Record<string, number | undefined>) }))
      .sort((a, b) => (a.ts as number) - (b.ts as number))
  }, [effectiveSensorIds, devices, range, metric])

  if (effectiveSensorIds.length === 0) {
    return (
      <p className="muted in-panel">
        <AlertCircle size={14} className="inline-icon" />{' '}
        対象センサーがありません。ダッシュボード設定でセンサーを追加してください。
      </p>
    )
  }

  const yDomain: [number | string, number | string] =
    metric === 'humidity' ? [0, 100] : ['auto', 'auto']
  const yLabel = metric === 'humidity' ? '湿度（%）' : '温度（℃）'
  const unitSuffix = metric === 'humidity' ? '%' : '℃'
  const renderIds = effectiveSensorIds.slice(0, 8)

  if (merged.length === 0) {
    return <p className="muted in-panel widget-chart-empty">この期間のデータがありません。</p>
  }

  return (
    <div className="widget-chart-wrap">
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={merged} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
          <CartesianGrid stroke="#e6eaf0" strokeDasharray="3 3" />
          <XAxis
            dataKey="ts"
            type="number"
            domain={[range.start.getTime(), range.end.getTime()]}
            tick={{ fontSize: 11, fill: '#4b5563' }}
            tickFormatter={(ts) => fmtTime(new Date(ts as number), fineGrain)}
            stroke="#94a3b8"
            minTickGap={fineGrain ? 24 : 32}
          />
          <YAxis
            tick={{ fontSize: 11, fill: '#4b5563' }}
            stroke="#94a3b8"
            width={44}
            domain={yDomain}
            label={{
              value: yLabel,
              angle: -90,
              position: 'insideLeft',
              offset: 8,
              style: { fill: '#1a1a1a', fontSize: 11, fontWeight: 600 },
            }}
          />
          <Tooltip
            contentStyle={{
              background: '#ffffff',
              border: '1px solid #d3dae3',
              borderRadius: 6,
              fontSize: 12,
            }}
            labelFormatter={(ts) => fmtTooltip(new Date(ts as number))}
            formatter={(v, name) => [
              v == null ? '-' : `${Number(v).toFixed(1)} ${unitSuffix}`,
              String(name),
            ]}
          />
          <Legend
            verticalAlign="bottom"
            wrapperStyle={{ fontSize: '11px', paddingTop: 8 }}
            iconType="line"
          />
          {renderIds.map((id, idx) => (
            <Line
              key={id}
              type="monotone"
              dataKey={id}
              name={sensors[id]?.name?.trim() || sensors[id]?.deviceNumber || id}
              stroke={SENSOR_COLORS[idx % SENSOR_COLORS.length]}
              strokeWidth={1.6}
              dot={false}
              connectNulls={true}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
      {effectiveSensorIds.length > 8 && (
        <p className="muted in-panel">
          ※ {effectiveSensorIds.length} センサー中、最大 8 系列まで表示しています。
        </p>
      )}
    </div>
  )
}
