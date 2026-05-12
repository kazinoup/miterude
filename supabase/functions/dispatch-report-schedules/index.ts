// Phase 1.8: レポート定期配信ディスパッチャ
//
// pg_cron が毎分起動。
// enabled な report_schedules を全件チェックし、
//   - 今日が配信曜日 / 配信日であり、
//   - 現時刻（JST）が delivery_time を過ぎており、
//   - last_dispatched_period_key が今期と異なる
// 場合に：
//   1. 期間（先週 Mon-Sun / 先月）を計算
//   2. ランダムトークンで report_delivery_links を 1 行 INSERT
//   3. 該当 notification_group の channel ごとに URL 入りメッセージを送信
//   4. last_dispatched_period_key / last_dispatched_at を更新
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const RESEND_FROM =
  Deno.env.get('RESEND_FROM') || 'ミテルデ <onboarding@resend.dev>'
const APP_URL =
  (Deno.env.get('APP_URL') ?? 'https://miterude-demo.vercel.app').replace(
    /\/$/,
    '',
  )

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// ---- JST 時刻ヘルパ -----------------------------------------------

type JstNow = {
  date: Date
  hh: number
  mm: number
  dayOfWeek: number
  dayOfMonth: number
  year: number
  month: number
}

function getJstNow(): JstNow {
  const now = new Date()
  // JST = UTC + 9h
  const jst = new Date(now.getTime() + 9 * 3600 * 1000)
  return {
    date: jst,
    hh: jst.getUTCHours(),
    mm: jst.getUTCMinutes(),
    dayOfWeek: jst.getUTCDay(),
    dayOfMonth: jst.getUTCDate(),
    year: jst.getUTCFullYear(),
    month: jst.getUTCMonth() + 1,
  }
}

function parseHHMM(s: string): { hh: number; mm: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim())
  if (!m) return null
  const hh = Number(m[1])
  const mm = Number(m[2])
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null
  return { hh, mm }
}

function pad2(n: number): string {
  return n < 10 ? '0' + n : '' + n
}

function ymd(y: number, m: number, d: number): string {
  return `${y}-${pad2(m)}-${pad2(d)}`
}

/** 与えた日付の n 日前 / 後の日付を計算（JST のカレンダー上で）。 */
function shiftDay(jst: Date, deltaDays: number): Date {
  return new Date(jst.getTime() + deltaDays * 86_400_000)
}

/** 与えた JST 日付の「ISO 週番号」を返す（Mon 始まり、週 1 はその年の最初の木曜を含む週）。 */
function isoWeek(jst: Date): { year: number; week: number } {
  const d = new Date(
    Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate()),
  )
  // 木曜日に揃える
  const dayNum = d.getUTCDay() === 0 ? 7 : d.getUTCDay()
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const week = Math.ceil(
    ((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7,
  )
  return { year: d.getUTCFullYear(), week }
}

// ---- 期間計算 ----------------------------------------------------

type Period = {
  start: string // YYYY-MM-DD
  end: string // YYYY-MM-DD (inclusive)
  key: string // 'YYYY-Www' or 'YYYY-MM'
}

/** 「直前の Mon〜Sun の 7 日間」を返す（JST 基準）。 */
function previousMonSunWeek(now: JstNow): Period {
  // 「今日が含まれる週の Sunday」までさかのぼる → そこから 6 日戻すと Monday
  // 今日が Sun の場合、その「直前の Sun」は 7 日前
  const dow = now.dayOfWeek // 0=Sun
  const daysBackToLastSun = dow === 0 ? 7 : dow
  const lastSun = shiftDay(now.date, -daysBackToLastSun)
  const lastMon = shiftDay(lastSun, -6)
  const iw = isoWeek(lastMon)
  return {
    start: ymd(
      lastMon.getUTCFullYear(),
      lastMon.getUTCMonth() + 1,
      lastMon.getUTCDate(),
    ),
    end: ymd(
      lastSun.getUTCFullYear(),
      lastSun.getUTCMonth() + 1,
      lastSun.getUTCDate(),
    ),
    key: `${iw.year}-W${pad2(iw.week)}`,
  }
}

/** 「前月の 1 日〜末日」を返す（JST 基準）。 */
function previousMonth(now: JstNow): Period {
  const y = now.month === 1 ? now.year - 1 : now.year
  const m = now.month === 1 ? 12 : now.month - 1
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate() // m=月（1始まり）, 日=0 で前月最終日
  return {
    start: ymd(y, m, 1),
    end: ymd(y, m, lastDay),
    key: `${y}-${pad2(m)}`,
  }
}

// ---- メッセージ送信 ------------------------------------------------

type Channel = { id?: string; kind: 'email' | 'slack' | 'webhook'; target: string }
type SendResult = { ok: true } | { ok: false; error: string }

async function sendReportEmail(
  target: string,
  orgName: string,
  reportKind: 'weekly' | 'monthly',
  period: Period,
  url: string,
): Promise<SendResult> {
  if (!RESEND_API_KEY) return { ok: false, error: 'RESEND_API_KEY not configured' }
  const kindLabel = reportKind === 'monthly' ? '月報' : '週報'
  const subject = `[ミテルデ ${orgName}] ${kindLabel}（${period.start} 〜 ${period.end}）`
  const text = [
    `${orgName} の${kindLabel}が出来上がりました。`,
    '',
    `対象期間: ${period.start} 〜 ${period.end}`,
    '',
    'レポート閲覧 URL（ログイン不要）:',
    url,
    '',
    '画面を開いた後、ブラウザの「印刷 → PDF として保存」で PDF 化できます。',
    '',
    'このメールはミテルデから自動送信されています。',
  ].join('\n')
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: RESEND_FROM,
      to: [target],
      subject,
      text,
    }),
  })
  const body = await r.json().catch(() => ({}))
  if (!r.ok) {
    return {
      ok: false,
      error: `Resend ${r.status}: ${body?.message ?? JSON.stringify(body)}`,
    }
  }
  return { ok: true }
}

async function sendReportSlack(
  target: string,
  orgName: string,
  reportKind: 'weekly' | 'monthly',
  period: Period,
  url: string,
): Promise<SendResult> {
  const kindLabel = reportKind === 'monthly' ? '月報' : '週報'
  const text =
    `*[${orgName}] ${kindLabel}（${period.start} 〜 ${period.end}）*\n` +
    `レポート: ${url}\n` +
    'ブラウザで開いた後、印刷 → PDF として保存で PDF 化できます。'
  const r = await fetch(target, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })
  if (!r.ok) {
    const t = await r.text().catch(() => '')
    return { ok: false, error: `Slack ${r.status}: ${t.slice(0, 200)}` }
  }
  return { ok: true }
}

async function sendReportWebhook(
  target: string,
  orgName: string,
  reportKind: 'weekly' | 'monthly',
  period: Period,
  url: string,
): Promise<SendResult> {
  const payload = {
    type: 'report-link',
    organization: { name: orgName },
    reportKind,
    period: { start: period.start, end: period.end },
    url,
    timestamp: new Date().toISOString(),
  }
  const r = await fetch(target, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!r.ok) {
    const t = await r.text().catch(() => '')
    return { ok: false, error: `Webhook ${r.status}: ${t.slice(0, 200)}` }
  }
  return { ok: true }
}

async function sendToChannel(
  channel: Channel,
  orgName: string,
  reportKind: 'weekly' | 'monthly',
  period: Period,
  url: string,
): Promise<SendResult> {
  if (channel.kind === 'email') {
    return sendReportEmail(channel.target, orgName, reportKind, period, url)
  }
  if (channel.kind === 'slack') {
    return sendReportSlack(channel.target, orgName, reportKind, period, url)
  }
  return sendReportWebhook(channel.target, orgName, reportKind, period, url)
}

// ---- メイン処理 ---------------------------------------------------

type ScheduleRow = {
  id: string
  organization_id: string
  name: string
  enabled: boolean
  report_kind: string
  target_sensor_ids: string[] | null
  notification_group_id: string | null
  delivery_time: string
  weekly_day_of_week: number | null
  monthly_day_of_month: number | null
  last_dispatched_period_key: string | null
}

async function processSchedule(
  s: ScheduleRow,
  now: JstNow,
): Promise<{ status: 'skipped' | 'dispatched' | 'failed'; reason?: string }> {
  if (!s.enabled) return { status: 'skipped', reason: 'disabled' }
  if (!s.notification_group_id) return { status: 'skipped', reason: 'no-group' }

  // 配信曜日 / 日のチェック
  if (s.report_kind === 'weekly') {
    const dow = s.weekly_day_of_week ?? 1
    if (now.dayOfWeek !== dow) return { status: 'skipped', reason: 'not-dow' }
  } else if (s.report_kind === 'monthly') {
    const dom = s.monthly_day_of_month ?? 1
    if (now.dayOfMonth !== dom) return { status: 'skipped', reason: 'not-dom' }
  } else {
    return { status: 'skipped', reason: 'unknown-kind' }
  }

  // 配信時刻のチェック（過ぎているか）
  const hm = parseHHMM(s.delivery_time)
  if (!hm) return { status: 'skipped', reason: 'invalid-time' }
  const nowMins = now.hh * 60 + now.mm
  const schedMins = hm.hh * 60 + hm.mm
  if (nowMins < schedMins) return { status: 'skipped', reason: 'too-early' }

  // 期間計算
  const period =
    s.report_kind === 'monthly' ? previousMonth(now) : previousMonSunWeek(now)

  // 重複ガード
  if (s.last_dispatched_period_key === period.key) {
    return { status: 'skipped', reason: 'already-dispatched' }
  }

  // 通知グループと組織を取得
  const [groupRes, orgRes] = await Promise.all([
    supabase
      .from('notification_groups')
      .select('id, enabled, channels')
      .eq('id', s.notification_group_id)
      .maybeSingle(),
    supabase
      .from('organizations')
      .select('id, name, slug')
      .eq('id', s.organization_id)
      .maybeSingle(),
  ])
  if (groupRes.error || !groupRes.data) {
    return { status: 'failed', reason: `group fetch: ${groupRes.error?.message}` }
  }
  if (orgRes.error || !orgRes.data) {
    return { status: 'failed', reason: `org fetch: ${orgRes.error?.message}` }
  }
  const group = groupRes.data as { id: string; enabled: boolean | null; channels: Channel[] | null }
  if (group.enabled === false) return { status: 'skipped', reason: 'group-disabled' }
  const channels = group.channels ?? []
  if (channels.length === 0) return { status: 'skipped', reason: 'no-channels' }

  const orgName = (orgRes.data as { name: string }).name

  // report_delivery_links を 1 行 INSERT してトークンを発行
  const { data: linkRow, error: linkErr } = await supabase
    .from('report_delivery_links')
    .insert({
      organization_id: s.organization_id,
      schedule_id: s.id,
      report_kind: s.report_kind,
      period_start: period.start,
      period_end: period.end,
      target_sensor_ids: s.target_sensor_ids ?? [],
    })
    .select('id, token')
    .single()
  if (linkErr || !linkRow) {
    return { status: 'failed', reason: `link insert: ${linkErr?.message}` }
  }
  const url = `${APP_URL}/share/report/${(linkRow as { token: string }).token}`

  // チャネルごとに送信
  await Promise.all(
    channels.map(async (c) => {
      try {
        const res = await sendToChannel(
          c,
          orgName,
          s.report_kind as 'weekly' | 'monthly',
          period,
          url,
        )
        if (!res.ok) {
          console.warn(
            `[dispatch-report] channel send failed`,
            c.kind,
            c.target,
            res.error,
          )
        }
      } catch (e) {
        console.warn(
          `[dispatch-report] channel send exception`,
          c.kind,
          c.target,
          e,
        )
      }
    }),
  )

  // last_dispatched_period_key を更新（連続発火防止）
  await supabase
    .from('report_schedules')
    .update({
      last_dispatched_period_key: period.key,
      last_dispatched_at: new Date().toISOString(),
    })
    .eq('id', s.id)

  return { status: 'dispatched' }
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return jsonResponse({ ok: false, error: 'method-not-allowed' }, 405)
  }

  const now = getJstNow()

  // enabled 配信のみ
  const { data: rows, error } = await supabase
    .from('report_schedules')
    .select(
      'id, organization_id, name, enabled, report_kind, target_sensor_ids, notification_group_id, delivery_time, weekly_day_of_week, monthly_day_of_month, last_dispatched_period_key',
    )
    .eq('enabled', true)
  if (error) return jsonResponse({ ok: false, error: error.message }, 500)

  const summary = {
    total: rows?.length ?? 0,
    dispatched: 0,
    skipped: 0,
    failed: 0,
    details: [] as Array<{ id: string; name: string; status: string; reason?: string }>,
  }

  for (const r of (rows ?? []) as ScheduleRow[]) {
    try {
      const result = await processSchedule(r, now)
      if (result.status === 'dispatched') summary.dispatched += 1
      else if (result.status === 'failed') summary.failed += 1
      else summary.skipped += 1
      summary.details.push({
        id: r.id,
        name: r.name,
        status: result.status,
        reason: result.reason,
      })
    } catch (e) {
      summary.failed += 1
      summary.details.push({
        id: r.id,
        name: r.name,
        status: 'failed',
        reason: e instanceof Error ? e.message : String(e),
      })
    }
  }

  return jsonResponse({ ok: true, jstNow: now, summary })
})
