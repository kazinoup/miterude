import { formatYearMonthJp } from '../lib/jp'
import type { YearMonth } from '../types'

type Props = {
  ym: YearMonth
  /** 内部 ID（落ちラベル用）。新規呼び出し側は deviceLabel を渡す。 */
  deviceId: string
  /** 表示用ラベル（name / deviceNumber など）。未指定なら deviceId にフォールバック。 */
  deviceLabel?: string
}

/** 温湿度サマリー・温度月報・湿度月報で共通のヘッダー行（【年月】デバイス名・中央） */
export function ReportHeroLine({ ym, deviceId, deviceLabel }: Props) {
  return (
    <div className="report-hero-wrap">
      <p className="report-hero-line">
        <span className="report-hero-ym">【{formatYearMonthJp(ym.year, ym.month)}】</span>
        <span className="report-hero-device">{deviceLabel || deviceId}</span>
      </p>
    </div>
  )
}
