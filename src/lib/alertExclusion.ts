/**
 * アラート除外時間帯（exclusion windows）の判定ヘルパ。
 *
 * 飲食店の営業時間外や食品工場の夜間扉閉めなど、
 * 「この時間帯のアラートは無視したい」というケースを表現する。
 *
 * 主に `judgeReadingForAlerts` / `judgeBatteryForAlerts` /
 * `judgeOfflineTransitionAlert`（src/lib/alertLog.ts）の冒頭から呼ばれる。
 */
import type {
  AlertExclusionDate,
  AlertExclusionTarget,
  AlertExclusionWindow,
  AlertSettings,
  DayOfWeek,
} from '../types'

/** "HH:MM" を 0..1439 の「その日の経過分」に変換。
 *  解釈不能なら null を返し、呼び出し側で「除外なし」扱いにする。 */
export function toMinuteOfDay(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h < 0 || h > 23 || min < 0 || min > 59) return null
  return h * 60 + min
}

/** 1 件の窓に対する判定。
 *
 *  - `start <= end`（同日内、例 13:00→17:00）: `[start, end)` の範囲を抑制。
 *    曜日チェックは「その日」を見る。
 *  - `start >  end`（日跨ぎ、例 22:00→08:00）: `[start, 24:00) ∪ [00:00, end)` を抑制。
 *    曜日チェックは **窓の "開始日"** を基準にする
 *    （月曜 22:00 → 火曜 08:00 の窓に "月曜" を指定したとき、火曜の早朝も含めて抑制する）。
 *  - `daysOfWeek` が空配列なら毎日適用。
 */
export function isInExclusionWindow(
  at: Date,
  w: AlertExclusionWindow,
): boolean {
  if (!w.enabled) return false
  const start = toMinuteOfDay(w.startTime)
  const end = toMinuteOfDay(w.endTime)
  if (start == null || end == null) return false
  // start === end の窓は「24時間ずっと」と解釈してもよいが、混乱を避けるため
  // 「無効」扱いにする（UI でも止めるが、二重ガード）。
  if (start === end) return false

  const dow = at.getDay() as DayOfWeek
  const minute = at.getHours() * 60 + at.getMinutes()
  const matchDow = (target: DayOfWeek) =>
    w.daysOfWeek.length === 0 || w.daysOfWeek.includes(target)

  if (start < end) {
    // 同日内
    if (minute < start || minute >= end) return false
    return matchDow(dow)
  }
  // 日跨ぎ
  // - 当日の後半（minute >= start）→ 開始日 = 当日
  if (minute >= start) {
    return matchDow(dow)
  }
  // - 当日の前半（minute < end）→ 開始日 = 前日
  if (minute < end) {
    const prevDow = (((dow - 1) % 7) + 7) % 7
    return matchDow(prevDow as DayOfWeek)
  }
  return false
}

/** 指定の `at` 日時が除外日（日付範囲）に含まれるか。
 *  startDate / endDate は両端を含む（startDate 00:00 〜 endDate 23:59:59）。 */
export function isInExclusionDate(at: Date, d: AlertExclusionDate): boolean {
  if (!d.enabled) return false
  if (!d.startDate || !d.endDate) return false
  // ローカル時刻での日付文字列で比較するのが直感的（"2026-12-30" 等）
  const y = at.getFullYear()
  const m = String(at.getMonth() + 1).padStart(2, '0')
  const day = String(at.getDate()).padStart(2, '0')
  const today = `${y}-${m}-${day}`
  return today >= d.startDate && today <= d.endDate
}

/** 指定の `at` 時刻 + アラート種別が、いずれかの除外窓 / 除外日に該当するか。
 *
 *  - `settings.exclusionWindows` / `settings.exclusionDates` が空 / undefined → 抑制なし
 *  - 任意の窓で `enabled` かつ `targets` が一致（targets が空なら全種別一致）
 *    かつ `at` が時間範囲 / 日付範囲に入る → true
 */
export function isAlertSuppressed(
  at: Date,
  settings: AlertSettings | undefined,
  target: AlertExclusionTarget,
): boolean {
  if (!settings) return false
  const windows = settings.exclusionWindows
  if (windows && windows.length > 0) {
    for (const w of windows) {
      if (!w.enabled) continue
      if (w.targets.length > 0 && !w.targets.includes(target)) continue
      if (isInExclusionWindow(at, w)) return true
    }
  }
  const dates = settings.exclusionDates
  if (dates && dates.length > 0) {
    for (const d of dates) {
      if (!d.enabled) continue
      if (d.targets.length > 0 && !d.targets.includes(target)) continue
      if (isInExclusionDate(at, d)) return true
    }
  }
  return false
}

/* ---------- ヘルパ・定数（UI 共有） ---------- */

export const DAY_OF_WEEK_LABELS: Record<DayOfWeek, string> = {
  0: '日',
  1: '月',
  2: '火',
  3: '水',
  4: '木',
  5: '金',
  6: '土',
}

export const DAY_OF_WEEK_LIST: DayOfWeek[] = [1, 2, 3, 4, 5, 6, 0]

export const ALERT_EXCLUSION_TARGET_LABELS: Record<
  AlertExclusionTarget,
  string
> = {
  deviation: '逸脱（温度・湿度）',
  offline: 'オフライン',
  battery: 'バッテリー残量',
}

/** 新規追加時のテンプレート。
 *  営業時間外（22:00〜08:00、毎日）+ 逸脱・オフライン抑制を初期値にする。
 *  ユーザはここから編集する想定。 */
export function defaultExclusionWindow(id: string): AlertExclusionWindow {
  return {
    id,
    label: '',
    enabled: true,
    startTime: '22:00',
    endTime: '08:00',
    daysOfWeek: [],
    targets: ['deviation', 'offline'],
  }
}

/** 除外日の新規追加時テンプレート。
 *  当日 1 日 + 逸脱・オフライン・バッテリー全部抑制が初期値。
 *  ユーザは「年末年始 12/29-1/3」のように調整する想定。 */
export function defaultExclusionDate(id: string): AlertExclusionDate {
  const today = new Date()
  const y = today.getFullYear()
  const m = String(today.getMonth() + 1).padStart(2, '0')
  const d = String(today.getDate()).padStart(2, '0')
  const todayStr = `${y}-${m}-${d}`
  return {
    id,
    label: '',
    enabled: true,
    startDate: todayStr,
    endDate: todayStr,
    targets: ['deviation', 'offline', 'battery'],
  }
}

/** 除外日のサマリラベル。 */
export function describeExclusionDate(d: AlertExclusionDate): string {
  if (!d.startDate || !d.endDate) return '日付未設定'
  if (d.startDate === d.endDate) return d.startDate
  return `${d.startDate} 〜 ${d.endDate}`
}

/** 表示用に「同日内 / 日跨ぎ / 毎日 / 平日のみ / カスタム」のラベルを作る。 */
export function describeExclusionWindow(w: AlertExclusionWindow): string {
  const t = `${w.startTime} – ${w.endTime}`
  const start = toMinuteOfDay(w.startTime)
  const end = toMinuteOfDay(w.endTime)
  const span =
    start != null && end != null && start > end ? '（日跨ぎ）' : ''
  let dowLabel = '毎日'
  if (w.daysOfWeek.length > 0) {
    if (w.daysOfWeek.length === 5 &&
        [1, 2, 3, 4, 5].every((d) => w.daysOfWeek.includes(d as DayOfWeek))) {
      dowLabel = '平日のみ'
    } else if (
      w.daysOfWeek.length === 2 &&
      [0, 6].every((d) => w.daysOfWeek.includes(d as DayOfWeek))
    ) {
      dowLabel = '土日のみ'
    } else {
      dowLabel = w.daysOfWeek
        .slice()
        .sort()
        .map((d) => DAY_OF_WEEK_LABELS[d])
        .join('・')
    }
  }
  return `${t}${span} / ${dowLabel}`
}
