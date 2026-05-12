import type {
  ReportKind,
  SensorReading,
  SensorThresholds,
  YearMonth,
} from '../types'
import { yearMonthKey } from '../types'
import { MonthlyTableReport } from './MonthlyTableReport'
import { SummaryReport } from './SummaryReport'
import { WeeklyMergedTableReport } from './WeeklyMergedTableReport'
import { WeeklySummaryReport } from './WeeklySummaryReport'

type CommonProps = {
  deviceId: string
  /** 表示用ラベル（センサー名 / デバイス番号）。未指定なら deviceId が出る。 */
  deviceLabel?: string
  readings: SensorReading[]
  /** 該当センサーの個別閾値。未設定なら逸脱判定なし。 */
  thresholds: SensorThresholds | undefined
}

type Props = CommonProps &
  (
    | { kind?: 'monthly'; ym: YearMonth; weekStart?: undefined }
    | { kind: 'weekly'; weekStart: Date; ym?: undefined }
  )

export function ReportPreview(props: Props) {
  const { deviceId, deviceLabel, readings, thresholds } = props
  const kind: ReportKind = props.kind ?? 'monthly'

  if (kind === 'weekly' && props.weekStart) {
    const weekStart = props.weekStart
    const key = `${deviceId}-w-${weekStart.toISOString().slice(0, 10)}`

    // Phase A-3: 週報は 2 ページ構成
    //   1) WeeklySummaryReport（グラフ + サマリ）
    //   2) WeeklyMergedTableReport（温度・湿度を 1 ページに左右並びで集約）
    return (
      <article className="report-bundle" data-report-key={key}>
        <WeeklySummaryReport
          deviceId={deviceId}
          deviceLabel={deviceLabel}
          weekStart={weekStart}
          readings={readings}
          thresholds={thresholds}
        />
        <WeeklyMergedTableReport
          deviceId={deviceId}
          deviceLabel={deviceLabel}
          weekStart={weekStart}
          readings={readings}
          thresholds={thresholds}
        />
      </article>
    )
  }

  // Monthly (default)
  const ym = props.ym!
  const key = `${deviceId}-${yearMonthKey(ym)}`

  return (
    <article className="report-bundle" data-report-key={key}>
      <SummaryReport
        deviceId={deviceId}
        deviceLabel={deviceLabel}
        ym={ym}
        readings={readings}
        thresholds={thresholds}
      />
      <MonthlyTableReport
        title="温度月報"
        metric="temperature"
        deviceId={deviceId}
        deviceLabel={deviceLabel}
        ym={ym}
        readings={readings}
        thresholds={thresholds}
      />
      <MonthlyTableReport
        title="湿度月報"
        metric="humidity"
        deviceId={deviceId}
        deviceLabel={deviceLabel}
        ym={ym}
        readings={readings}
        thresholds={thresholds}
      />
    </article>
  )
}
