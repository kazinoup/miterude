import { formatYearMonthJp } from '../lib/jp'
import type { YearMonth } from '../types'

type Props = {
  ym: YearMonth
  deviceId: string
}

/** 温湿度サマリー・温度月報・湿度月報で共通のヘッダー行（【年月】デバイス名・中央） */
export function ReportHeroLine({ ym, deviceId }: Props) {
  return (
    <div className="report-hero-wrap">
      <p className="report-hero-line">
        <span className="report-hero-ym">【{formatYearMonthJp(ym.year, ym.month)}】</span>
        <span className="report-hero-device">{deviceId}</span>
      </p>
    </div>
  )
}
