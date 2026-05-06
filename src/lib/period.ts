/**
 * 期間（日／週／月）操作ヘルパ — Phase 3
 *
 * 「履歴ビューア」で日／週／月を切り替えるための共通ロジック。
 * 週は月曜起点（ISO 風）。終端は exclusive（次の境界）。
 */

export type PeriodType = 'day' | 'week' | 'month'

export type DateRange = { start: Date; end: Date }

export function startOfDay(d: Date): Date {
  const r = new Date(d)
  r.setHours(0, 0, 0, 0)
  return r
}

export function startOfWeek(d: Date): Date {
  const r = startOfDay(d)
  const day = r.getDay() // 0=Sun, 1=Mon, ..., 6=Sat
  const diff = day === 0 ? -6 : 1 - day
  r.setDate(r.getDate() + diff)
  return r
}

export function startOfMonth(d: Date): Date {
  const r = startOfDay(d)
  r.setDate(1)
  return r
}

export function periodRange(type: PeriodType, anchor: Date): DateRange {
  if (type === 'day') {
    const start = startOfDay(anchor)
    const end = new Date(start)
    end.setDate(end.getDate() + 1)
    return { start, end }
  }
  if (type === 'week') {
    const start = startOfWeek(anchor)
    const end = new Date(start)
    end.setDate(end.getDate() + 7)
    return { start, end }
  }
  const start = startOfMonth(anchor)
  const end = new Date(start)
  end.setMonth(end.getMonth() + 1)
  return { start, end }
}

export function shiftPeriod(type: PeriodType, anchor: Date, delta: number): Date {
  const r = new Date(anchor)
  if (type === 'day') {
    r.setDate(r.getDate() + delta)
  } else if (type === 'week') {
    r.setDate(r.getDate() + delta * 7)
  } else {
    r.setMonth(r.getMonth() + delta)
  }
  return r
}

const WD = ['日', '月', '火', '水', '木', '金', '土'] as const

export function formatPeriodLabel(type: PeriodType, anchor: Date): string {
  if (type === 'day') {
    const wd = WD[anchor.getDay()]
    return `${anchor.getFullYear()}年${anchor.getMonth() + 1}月${anchor.getDate()}日（${wd}）`
  }
  if (type === 'week') {
    const start = startOfWeek(anchor)
    const end = new Date(start)
    end.setDate(end.getDate() + 6)
    const sm = start.getMonth() + 1
    const em = end.getMonth() + 1
    if (start.getMonth() === end.getMonth()) {
      return `${start.getFullYear()}年${sm}月${start.getDate()}日 〜 ${end.getDate()}日`
    }
    return `${start.getFullYear()}年${sm}月${start.getDate()}日 〜 ${em}月${end.getDate()}日`
  }
  return `${anchor.getFullYear()}年${anchor.getMonth() + 1}月`
}

/** <input type="date"> 用 yyyy-mm-dd */
export function toDateInputValue(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function fromDateInputValue(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

/** <input type="month"> 用 yyyy-mm */
export function toMonthInputValue(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

export function fromMonthInputValue(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})$/.exec(s)
  if (!m) return null
  return new Date(Number(m[1]), Number(m[2]) - 1, 1)
}
