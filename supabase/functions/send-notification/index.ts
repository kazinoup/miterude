// Phase 1.7a: 通知配信 Edge Function（単一 delivery を送る）
//
// POST /functions/v1/send-notification
//   Body: { delivery_id: string }
//
// notification_deliveries の 1 行 (pending) を取得して、
// channel_kind に応じて Resend / Slack / 汎用 Webhook へ送信する。
// 結果に応じて status / sent_at / error_message を更新する。
//
// 呼び出し元:
//  - immediate 通知: webhook-milesight / parse-inbox (alertDetection) が同期で呼ぶ
//  - batch 通知: dispatch-notifications が時間に達したものを順次呼ぶ
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { assertSafeOutboundUrl } from '../_shared/urlGuard.ts'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const RESEND_FROM = Deno.env.get('RESEND_FROM') || 'ミテルデ <onboarding@resend.dev>'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

type Delivery = {
  id: string
  organization_id: string
  alert_log_id: string
  notification_group_id: string | null
  channel_kind: 'email' | 'slack' | 'webhook'
  target: string
  status: string
  retry_count: number
}

type AlertSummary = {
  id: string
  occurred_at: string
  kind: string
  metric: string | null
  value: number | null
  message: string
  manufacturer: string
  model: string
  serial_number: string
  sensor_number: string | null
}

type OrgSummary = {
  id: string
  name: string
  slug: string
}

async function sendEmail(
  delivery: Delivery,
  alert: AlertSummary,
  org: OrgSummary,
): Promise<{ ok: true; providerId?: string } | { ok: false; error: string }> {
  if (!RESEND_API_KEY) {
    return { ok: false, error: 'RESEND_API_KEY not configured' }
  }
  const kindLabel =
    alert.kind === 'deviation-alert' ? '危険逸脱' :
    alert.kind === 'deviation-warn' ? '注意逸脱' :
    alert.kind === 'offline' ? 'オフライン' :
    alert.kind === 'battery' ? 'バッテリー残量低下' : 'アラート'
  const sensorLabel = alert.sensor_number || alert.serial_number
  const subject = `[ミテルデ ${org.name}] ${kindLabel} ${sensorLabel}`
  const text = [
    `${org.name} でアラートが発生しました。`,
    '',
    `センサー: ${sensorLabel}`,
    `モデル: ${alert.manufacturer} ${alert.model}`,
    `種別: ${kindLabel}`,
    `内容: ${alert.message}`,
    `発生時刻: ${new Date(alert.occurred_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`,
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
      to: [delivery.target],
      subject,
      text,
    }),
  })
  const body = await r.json().catch(() => ({}))
  if (!r.ok) {
    return { ok: false, error: `Resend ${r.status}: ${body?.message ?? JSON.stringify(body)}` }
  }
  return { ok: true, providerId: body?.id }
}

async function sendSlack(
  delivery: Delivery,
  alert: AlertSummary,
  org: OrgSummary,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const kindLabel =
    alert.kind === 'deviation-alert' ? '🔴 危険逸脱' :
    alert.kind === 'deviation-warn' ? '🟠 注意逸脱' :
    alert.kind === 'offline' ? '⚫ オフライン' :
    alert.kind === 'battery' ? '🔋 バッテリー残量低下' : 'アラート'
  const sensorLabel = alert.sensor_number || alert.serial_number

  const payload = {
    text: `*[${org.name}] ${kindLabel}*\n` +
      `センサー: ${sensorLabel} (${alert.manufacturer} ${alert.model})\n` +
      `${alert.message}\n` +
      `発生: ${new Date(alert.occurred_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`,
  }

  try {
    assertSafeOutboundUrl(delivery.target, { allowHosts: ['hooks.slack.com'] })
  } catch (e) {
    return {
      ok: false,
      error: `unsafe-slack-url: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
  const r = await fetch(delivery.target, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!r.ok) {
    const t = await r.text().catch(() => '')
    return { ok: false, error: `Slack ${r.status}: ${t.slice(0, 200)}` }
  }
  return { ok: true }
}

async function sendWebhook(
  delivery: Delivery,
  alert: AlertSummary,
  org: OrgSummary,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const payload = {
    organization: { id: org.id, slug: org.slug, name: org.name },
    alert: {
      id: alert.id,
      occurredAt: alert.occurred_at,
      kind: alert.kind,
      metric: alert.metric,
      value: alert.value,
      message: alert.message,
      sensor: {
        manufacturer: alert.manufacturer,
        model: alert.model,
        serialNumber: alert.serial_number,
        sensorNumber: alert.sensor_number,
      },
    },
  }
  try {
    assertSafeOutboundUrl(delivery.target)
  } catch (e) {
    return {
      ok: false,
      error: `unsafe-webhook-url: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
  const r = await fetch(delivery.target, {
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

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return jsonResponse({ ok: false, error: 'method-not-allowed' }, 405)
  let body: { delivery_id?: string }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ ok: false, error: 'invalid-body' }, 400)
  }
  const deliveryId = body.delivery_id
  if (!deliveryId) return jsonResponse({ ok: false, error: 'delivery_id required' }, 400)

  // 1) delivery を取得
  const { data: delivery, error: dErr } = await supabase
    .from('notification_deliveries')
    .select('id, organization_id, alert_log_id, notification_group_id, channel_kind, target, status, retry_count')
    .eq('id', deliveryId)
    .maybeSingle()
  if (dErr || !delivery) return jsonResponse({ ok: false, error: dErr?.message ?? 'not-found' }, 404)
  if (delivery.status === 'sent') {
    return jsonResponse({ ok: true, skipped: 'already-sent' })
  }

  // 2) attempted_at を立てる（リトライ追跡）
  await supabase
    .from('notification_deliveries')
    .update({ attempted_at: new Date().toISOString(), retry_count: delivery.retry_count + 1 })
    .eq('id', delivery.id)

  // 3) 関連アラート + 組織を取得
  const { data: alert, error: aErr } = await supabase
    .from('alert_logs')
    .select('id, occurred_at, kind, metric, value, message, manufacturer, model, serial_number, sensor_number')
    .eq('id', delivery.alert_log_id)
    .maybeSingle()
  if (aErr || !alert) {
    await supabase.from('notification_deliveries').update({
      status: 'failed',
      error_message: 'alert_log not found',
    }).eq('id', delivery.id)
    return jsonResponse({ ok: false, error: 'alert-not-found' }, 404)
  }
  const { data: org, error: oErr } = await supabase
    .from('organizations')
    .select('id, name, slug')
    .eq('id', delivery.organization_id)
    .maybeSingle()
  if (oErr || !org) {
    await supabase.from('notification_deliveries').update({
      status: 'failed',
      error_message: 'organization not found',
    }).eq('id', delivery.id)
    return jsonResponse({ ok: false, error: 'org-not-found' }, 404)
  }

  // 4) channel_kind ごとに送信
  let result: { ok: true; providerId?: string } | { ok: false; error: string }
  if (delivery.channel_kind === 'email') {
    result = await sendEmail(delivery as Delivery, alert as AlertSummary, org as OrgSummary)
  } else if (delivery.channel_kind === 'slack') {
    result = await sendSlack(delivery as Delivery, alert as AlertSummary, org as OrgSummary)
  } else {
    result = await sendWebhook(delivery as Delivery, alert as AlertSummary, org as OrgSummary)
  }

  // 5) 結果反映
  if (result.ok) {
    await supabase.from('notification_deliveries').update({
      status: 'sent',
      sent_at: new Date().toISOString(),
      error_message: null,
      provider_message_id: 'providerId' in result ? result.providerId ?? null : null,
    }).eq('id', delivery.id)
    return jsonResponse({ ok: true })
  } else {
    await supabase.from('notification_deliveries').update({
      status: 'failed',
      error_message: result.error.slice(0, 1000),
    }).eq('id', delivery.id)
    return jsonResponse({ ok: false, error: result.error })
  }
})
