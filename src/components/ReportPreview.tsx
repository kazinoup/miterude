import type {
  MissingDisplay,
  ReportKind,
  ReportThresholds,
  SensorReading,
  YearMonth,
} from '../types'
import { yearMonthKey } from '../types'
import { inferStorageKind, inferStorageKindForRange } from '../lib/report'
import { MonthlyTableReport } from './MonthlyTableReport'
import { SummaryReport } from './SummaryReport'
import { WeeklyTableReport } from './WeeklyTableReport'
import { WeeklySummaryReport } from './WeeklySummaryReport'

type CommonProps = {
  deviceId: string
  readings: SensorReading[]
  thresholds: ReportThresholds
  missingDisplay: MissingDisplay
}

type Props = CommonProps &
  (
    | { kind?: 'monthly'; ym: YearMonth; weekStart?: undefined }
    | { kind: 'weekly'; weekStart: Date; ym?: undefined }
  )

export function ReportPreview(props: Props) {
  const {
    deviceId,
    readings,
    thresholds,
    missingDisplay,
  } = props
  const kind: ReportKind = props.kind ?? 'monthly'

  if (kind === 'weekly' && props.weekStart) {
    const weekStart = props.weekStart
    const range = {
      start: weekStart,
      end: (() => {
        const e = new Date(weekStart)
        e.setDate(e.getDate() + 7)
        return e
      })(),
    }
    const storageKind = inferStorageKindForRange(readings, range)
    const key = `${deviceId}-w-${weekStart.toISOString().slice(0, 10)}`

    return (
      <article className="report-bundle" data-report-key={key}>
        <WeeklySummaryReport
          deviceId={deviceId}
          weekStart={weekStart}
          readings={readings}
          thresholds={thresholds}
          storageKind={storageKind}
        />
        <WeeklyTableReport
          title="温度週報"
          metric="temperature"
          deviceId={deviceId}
          weekStart={weekStart}
          readings={readings}
          thresholds={thresholds}
          storageKind={storageKind}
          missingDisplay={missingDisplay}
        />
        <WeeklyTableReport
          title="湿度週報"
          metric="humidity"
          deviceId={deviceId}
          weekStart={weekStart}
          readings={readings}
          thresholds={thresholds}
          storageKind={storageKind}
          missingDisplay={missingDisplay}
        />
      </article>
    )
  }

  // Monthly (default)
  const ym = props.ym!
  const storageKind = inferStorageKind(readings, ym)
  const key = `${deviceId}-${yearMonthKey(ym)}`

  return (
    <article className="report-bundle" data-report-key={key}>
      <SummaryReport
        deviceId={deviceId}
        ym={ym}
        readings={readings}
        thresholds={thresholds}
        storageKind={storageKind}
      />
      <MonthlyTableReport
        title="温度月報"
        metric="temperature"
        deviceId={deviceId}
        ym={ym}
        readings={readings}
        thresholds={thresholds}
        storageKind={storageKind}
        missingDisplay={missingDisplay}
      />
      <MonthlyTableReport
        title="湿度月報"
        metric="humidity"
        deviceId={deviceId}
        ym={ym}
        readings={readings}
        thresholds={thresholds}
        storageKind={storageKind}
        missingDisplay={missingDisplay}
      />
    </article>
  )
}
