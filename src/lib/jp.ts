const WD = ['日', '月', '火', '水', '木', '金', '土'] as const

export function weekdayJp(d: Date): string {
  return WD[d.getDay()]
}

/** 例: 2024年10月 */
export function formatYearMonthJp(year: number, month: number): string {
  return `${year}年${month}月`
}

/** 例: 2024/10/1 ～ 2024/10/31 */
export function formatPeriodJp(year: number, month: number, lastDay: number): string {
  return `${year}/${month}/${1} ～ ${year}/${month}/${lastDay}`
}

/** 例: 2024年10月1日から2024年10月31日まで */
export function formatPeriodLongJp(year: number, month: number, lastDay: number): string {
  return `${year}年${month}月1日から${year}年${month}月${lastDay}日まで`
}

/** 例: 0.0℃ ～ 10.0℃ */
export function formatTempRange(min: number, max: number): string {
  return `${min.toFixed(1)}℃ ～ ${max.toFixed(1)}℃`
}

/** 例: 40.0% ～ 85.0% */
export function formatHumRange(min: number, max: number): string {
  return `${min.toFixed(1)}% ～ ${max.toFixed(1)}%`
}

/** 上下限が片方だけのケースに対応した範囲表記
 *  - 両方ある: "0.0 〜 10.0℃"
 *  - 下限のみ: "0.0℃ 以上"
 *  - 上限のみ: "10.0℃ 以下"
 *  - どちらもなし: "—"
 */
export function formatThresholdRange(
  min: number | undefined,
  max: number | undefined,
  unit: string,
  decimals = 1,
): string {
  if (min != null && max != null) {
    return `${min.toFixed(decimals)} 〜 ${max.toFixed(decimals)}${unit}`
  }
  if (min != null) return `${min.toFixed(decimals)}${unit} 以上`
  if (max != null) return `${max.toFixed(decimals)}${unit} 以下`
  return '—'
}

/** 注意・危険の両方の閾値をレンダリング用の文字列で返す。
 *  両方有効: "注意 x〜y\n危険 x〜y"（CSS の white-space: pre-line で改行が表示される）
 *  片方だけ: その 1 行
 *  両方無効: "—"
 *  月報・週報の「基準」セル共通で使う。 */
export function formatBothThresholdLevels(
  warn: { enabled: boolean; min?: number; max?: number },
  alert: { enabled: boolean; min?: number; max?: number },
  unit: string,
  decimals = 1,
): string {
  const parts: string[] = []
  if (warn.enabled && (warn.min != null || warn.max != null)) {
    parts.push(`注意 ${formatThresholdRange(warn.min, warn.max, unit, decimals)}`)
  }
  if (alert.enabled && (alert.min != null || alert.max != null)) {
    parts.push(`危険 ${formatThresholdRange(alert.min, alert.max, unit, decimals)}`)
  }
  return parts.length === 0 ? '—' : parts.join('\n')
}

/** 相対時間表示（最終更新からの経過時間）
 *  - 1分未満: "now"
 *  - 1時間未満: "30min"
 *  - 1日未満: "2h 15min" / 分0なら "2h"
 *  - 1日以上: "3d"
 */
export function formatRelativeAgo(target: Date | undefined | null, now: Date = new Date()): string {
  if (!target) return '-'
  const t = target instanceof Date ? target.getTime() : new Date(target as unknown as string).getTime()
  if (Number.isNaN(t)) return '-'
  const ms = now.getTime() - t
  if (ms < 60_000) return 'now'
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 60) return `${minutes}min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    const remMin = minutes - hours * 60
    return remMin > 0 ? `${hours}h ${remMin}min` : `${hours}h`
  }
  const days = Math.floor(hours / 24)
  return `${days}d`
}
