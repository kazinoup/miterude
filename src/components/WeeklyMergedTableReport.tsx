/**
 * 週報の温度・湿度を 1 ページに左右並べてまとめるテーブル — Phase A-3 / 改訂2
 *
 * レイアウト方針（ユーザー要望反映後）:
 * - 上部のサマリは左:温度 / 右:湿度 で完全に左右 2 ブロックに分け、
 *   中央の時刻列の幅は含めない（3 分割: 左ブロック / 時刻スペーサ / 右ブロック）。
 * - 下段の温湿度テーブルは、温度 7 列 × 時刻列 × 湿度 7 列 の構成。
 *   時刻列は中央に置き、左右の区切りとしても機能する。
 *   時刻列の幅は通常列の半分にして、7 日分の日付列を少しでも広く取る。
 * - 1 行目の列タイトルには月報と同様に「時刻」の文言を入れる。
 * - 「赤・薄いブルー」のセクションヘッダ背景色は使わない（無彩色のみ）。
 * - 「対象期間」の枠は確認印枠の下端に揃える（下寄せ）。
 *
 * サマリ（逸脱あり）のレイアウト:
 *   行1: 計測項目|温度 | 計測回数|N | 基準 | [範囲 colspan=3]
 *   行2: 平均|x | 最小|x | 最大|x | 逸脱回数 | n
 *   → どちらの行も 8 列ぶんの幅に揃う。範囲セルは 3 列ぶんの横幅を確保することで
 *     「注意 x〜y / 危険 x〜y」のような長い文字列も折り返しで収まる。
 *
 * サマリ（逸脱なし）のレイアウト:
 *   行1: 計測項目|温度 | 計測回数|N | (空)(空)
 *   行2: 平均|x | 最小|x | 最大|x
 *   → 6 列ぶんの幅に揃う。
 */
import { Fragment } from 'react'
import type { SensorReading, SensorThresholds } from '../types'
import {
  buildWeeklyGrid,
  cellIsDeviation,
  formatCellValue,
  getThresholdForMetric,
  isMetricDeviationEnabled,
  summarizeRange,
} from '../lib/report'
import { weekdayJp, formatBothThresholdLevels } from '../lib/jp'

type Metric = 'temperature' | 'humidity'

type Props = {
  deviceId: string
  /** 表示用ラベル。未指定なら deviceId にフォールバック。 */
  deviceLabel?: string
  weekStart: Date
  readings: SensorReading[]
  thresholds: SensorThresholds | undefined
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

/** 1 つの metric（温度 / 湿度）に対する 2 行サマリ（小ブロック）。
 *  - 閾値あり (showDeviationStats): 8 列ぶん
 *      行1: th(計測項目) td(値) th(計測回数) td(N) th(基準) td(範囲, colspan=3)
 *      行2: th(平均) td(x) th(最小) td(x) th(最大) td(x) th(逸脱回数) td(n)
 *  - 閾値なし: 6 列ぶん
 *      行1: th(計測項目) td(値) th(計測回数) td(N) th(空) td(空)  ← 列幅維持のためのパディング
 *      行2: th(平均) td(x) th(最小) td(x) th(最大) td(x)          */
function MetricStatsBlock({
  metric,
  summary,
  showDeviationStats,
  thresholdSummary,
}: {
  metric: Metric
  summary: ReturnType<typeof summarizeRange>
  showDeviationStats: boolean
  thresholdSummary: string
}) {
  const unit = metric === 'temperature' ? '℃' : '%'
  return (
    <table
      className={`stats-row stats-row-block ${showDeviationStats ? 'has-dev' : ''}`}
    >
      <tbody>
        <tr>
          <th>計測項目</th>
          <td>{metric === 'temperature' ? '温度' : '湿度'}</td>
          <th>計測回数</th>
          <td>{summary.count}</td>
          {showDeviationStats ? (
            <>
              <th>基準</th>
              <td colSpan={3} className="threshold-range-cell">
                {thresholdSummary}
              </td>
            </>
          ) : (
            <>
              <th aria-hidden="true" className="stats-pad"></th>
              <td aria-hidden="true" className="stats-pad"></td>
            </>
          )}
        </tr>
        <tr>
          <th>平均</th>
          <td>{summary.avg != null ? `${summary.avg.toFixed(1)}${unit}` : '-'}</td>
          <th>最小</th>
          <td>{summary.min != null ? `${summary.min.toFixed(1)}${unit}` : '-'}</td>
          <th>最大</th>
          <td>{summary.max != null ? `${summary.max.toFixed(1)}${unit}` : '-'}</td>
          {showDeviationStats ? (
            <>
              <th>逸脱回数</th>
              <td className={summary.deviationCount > 0 ? 'deviation' : ''}>
                {summary.deviationCount}
              </td>
            </>
          ) : null}
        </tr>
      </tbody>
    </table>
  )
}

export function WeeklyMergedTableReport({
  deviceId,
  deviceLabel,
  weekStart,
  readings,
  thresholds,
}: Props) {
  const range = {
    start: weekStart,
    end: (() => {
      const e = new Date(weekStart)
      e.setDate(e.getDate() + 7)
      return e
    })(),
  }

  // 温度・湿度それぞれのグリッドを構築
  const tempGrid = buildWeeklyGrid(readings, weekStart, 'temperature')
  const humGrid = buildWeeklyGrid(readings, weekStart, 'humidity')

  const tempSummary = summarizeRange(readings, range, 'temperature', thresholds)
  const humSummary = summarizeRange(readings, range, 'humidity', thresholds)

  const tempThresh = getThresholdForMetric(thresholds, 'temperature')
  const humThresh = getThresholdForMetric(thresholds, 'humidity')

  const tempShowDev = isMetricDeviationEnabled(thresholds, 'temperature')
  const humShowDev = isMetricDeviationEnabled(thresholds, 'humidity')

  // 注意・危険を両方含めたサマリ（horizontal colspan=3 のセルに表示）
  const tempThresholdSummary = tempThresh
    ? formatBothThresholdLevels(tempThresh.warn, tempThresh.alert, '℃')
    : '—'
  const humThresholdSummary = humThresh
    ? formatBothThresholdLevels(humThresh.warn, humThresh.alert, '%')
    : '—'

  const decimals = 1
  const heroPeriodLabel = formatPeriodWeekJp(weekStart)

  // 7 日分の日付ヘッダ（左右で同じ列ラベルを使う）
  const dayHeads = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart)
    d.setDate(d.getDate() + i)
    return {
      label: `${d.getMonth() + 1}/${d.getDate()}`,
      wd: weekdayJp(d),
    }
  })

  return (
    <div className="report-page weekly-page weekly-merged-page report-numeric">
      <h1 className="monthly-title">週報（温度・湿度）</h1>
      <div className="report-hero-wrap">
        <p className="report-hero-line">
          <span className="report-hero-ym">【{heroPeriodLabel}】</span>
          <span className="report-hero-device">{deviceLabel || deviceId}</span>
        </p>
      </div>

      {/* 対象期間（左）と確認印（右）を、確認印枠の下端で揃える */}
      <div className="monthly-meta meta-bottom-aligned">
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

      {/* 温度サマリ（左） / [時刻列ぶんのスペーサ] / 湿度サマリ（右）
       *  下のグリッドの 7+0.5+7 列幅と一致させ、時刻列ぶんは含めない */}
      <div className="stats-split-row">
        <MetricStatsBlock
          metric="temperature"
          summary={tempSummary}
          showDeviationStats={tempShowDev}
          thresholdSummary={tempThresholdSummary}
        />
        <div className="stats-spacer" aria-hidden="true" />
        <MetricStatsBlock
          metric="humidity"
          summary={humSummary}
          showDeviationStats={humShowDev}
          thresholdSummary={humThresholdSummary}
        />
      </div>

      {/* 温度7列 + 時刻 + 湿度7列。時刻列は中央で左右を分ける役割。
       *  時刻列の幅は通常列の半分にして、7 日分のセルを少しでも広く確保する */}
      <div className="monthly-table-scroll">
        <table className="monthly-grid weekly-grid weekly-merged-grid">
          <colgroup>
            {Array.from({ length: 7 }, (_, i) => (
              <col key={`tc-${i}`} className="col-day" />
            ))}
            <col className="col-time" />
            {Array.from({ length: 7 }, (_, i) => (
              <col key={`hc-${i}`} className="col-day" />
            ))}
          </colgroup>
          <thead>
            <tr>
              {dayHeads.map((d, i) => (
                <th key={`th-t-${i}`} className="day-head">
                  {d.label}
                  <span className="wd">({d.wd})</span>
                </th>
              ))}
              <th className="merged-time-col-head">時刻</th>
              {dayHeads.map((d, i) => (
                <th key={`th-h-${i}`} className="day-head">
                  {d.label}
                  <span className="wd">({d.wd})</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 24 }, (_, hour) => {
              const rowA = hour * 2
              const rowB = hour * 2 + 1
              return (
                <Fragment key={hour}>
                  <tr className="monthly-hour-row">
                    {/* 温度 7 列 */}
                    {Array.from({ length: 7 }, (_, col) => {
                      const v = tempGrid[rowA]?.[col] ?? null
                      const dev = cellIsDeviation(v, 'temperature', thresholds)
                      return (
                        <td
                          key={`t-${col}`}
                          className={dev ? 'cell-deviation' : ''}
                        >
                          <span className="cell-num">
                            {formatCellValue(v, decimals)}
                          </span>
                        </td>
                      )
                    })}
                    {/* 中央の時刻列（2 行をまとめて表示） */}
                    <th rowSpan={2} className="row-head-hour merged-time-col">
                      {hour}時
                    </th>
                    {/* 湿度 7 列 */}
                    {Array.from({ length: 7 }, (_, col) => {
                      const v = humGrid[rowA]?.[col] ?? null
                      const dev = cellIsDeviation(v, 'humidity', thresholds)
                      return (
                        <td
                          key={`h-${col}`}
                          className={dev ? 'cell-deviation' : ''}
                        >
                          <span className="cell-num">
                            {formatCellValue(v, decimals)}
                          </span>
                        </td>
                      )
                    })}
                  </tr>
                  <tr className="monthly-hour-row monthly-hour-row-sub">
                    {/* 第 2 行（30分目）— 時刻列は rowSpan=2 で既に占有済み */}
                    {Array.from({ length: 7 }, (_, col) => {
                      const v = tempGrid[rowB]?.[col] ?? null
                      const dev = cellIsDeviation(v, 'temperature', thresholds)
                      return (
                        <td
                          key={`t-${col}`}
                          className={dev ? 'cell-deviation' : ''}
                        >
                          <span className="cell-num">
                            {formatCellValue(v, decimals)}
                          </span>
                        </td>
                      )
                    })}
                    {Array.from({ length: 7 }, (_, col) => {
                      const v = humGrid[rowB]?.[col] ?? null
                      const dev = cellIsDeviation(v, 'humidity', thresholds)
                      return (
                        <td
                          key={`h-${col}`}
                          className={dev ? 'cell-deviation' : ''}
                        >
                          <span className="cell-num">
                            {formatCellValue(v, decimals)}
                          </span>
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
