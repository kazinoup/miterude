// Phase 1.7b: 通知チャネルのテスト送信
//
// POST /functions/v1/send-notification-test
//   Body: { channel_kind: 'email'|'slack'|'webhook', target: string, organization_id?: string }
//
// 通知グループの編集画面（テナント側 / Admin Console）から、個別チャネルに
// テストメッセージを 1 回送る。alert_logs / notification_deliveries は触らず、
// 履歴に残さない。設定が動作しているか確認するためだけの機能。
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { assertSafeOutboundUrl } from '../_shared/urlGuard.ts'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const RESEND_FROM = Deno.env.get('RESEND_FROM') || 'ミテルデ <onboarding@resend.dev>'

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  })
}

type SendResult = { ok: true } | { ok: false; error: string }

async function sendTestEmail(target: string, orgName: string): Promise<SendResult> {
  if (!RESEND_API_KEY) return { ok: false, error: 'RESEND_API_KEY not configured' }
  const subject = `[ミテルデ ${orgName}] 通知テスト`
  const text = [
    `${orgName} の通知設定テスト送信です。`,
    '',
    'このメールは「テスト送信」ボタンから手動で送られています。',
    '受信できていればメール通知の設定は正しく動作しています。',
    '',
    'なおこのメールは履歴に残りません（alert_logs には登録されません）。',
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
    return { ok: false, error: `Resend ${r.status}: ${body?.message ?? JSON.stringify(body)}` }
  }
  return { ok: true }
}

async function sendTestSlack(target: string, orgName: string): Promise<SendResult> {
  const text =
    `*[${orgName}] 通知テスト*\n` +
    'このメッセージは「テスト送信」ボタンから手動で送られています。\n' +
    '受信できていれば Slack 通知の設定は正しく動作しています。'
  try {
    assertSafeOutboundUrl(target, { allowHosts: ['hooks.slack.com'] })
  } catch (e) {
    return {
      ok: false,
      error: `unsafe-slack-url: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
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

async function sendTestWebhook(target: string, orgName: string): Promise<SendResult> {
  const payload = {
    test: true,
    organization: { name: orgName },
    message: '通知テスト送信です。このリクエストは「テスト送信」ボタンから手動で送られました。',
    timestamp: new Date().toISOString(),
  }
  try {
    assertSafeOutboundUrl(target)
  } catch (e) {
    return {
      ok: false,
      error: `unsafe-webhook-url: ${e instanceof Error ? e.message : String(e)}`,
    }
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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }
  if (req.method !== 'POST') return jsonResponse({ ok: false, error: 'method-not-allowed' }, 405)
  let body: { channel_kind?: string; target?: string; organization_id?: string }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ ok: false, error: 'invalid-body' }, 400)
  }
  const channelKind = body.channel_kind
  const target = (body.target ?? '').trim()
  const organizationId = body.organization_id

  if (!channelKind || !target) {
    return jsonResponse({ ok: false, error: 'channel_kind and target are required' }, 400)
  }
  if (channelKind !== 'email' && channelKind !== 'slack' && channelKind !== 'webhook') {
    return jsonResponse({ ok: false, error: 'invalid channel_kind' }, 400)
  }

  // 組織名を取得（任意・失敗してもデフォルトで送る）
  let orgName = 'テスト組織'
  if (organizationId) {
    const { data } = await supabase
      .from('organizations')
      .select('name')
      .eq('id', organizationId)
      .maybeSingle()
    if (data?.name) orgName = data.name
  }

  let result: SendResult
  if (channelKind === 'email') {
    result = await sendTestEmail(target, orgName)
  } else if (channelKind === 'slack') {
    result = await sendTestSlack(target, orgName)
  } else {
    result = await sendTestWebhook(target, orgName)
  }

  // 失敗でも HTTP 200 で返す（呼び出し側がトーストに出しやすいよう）
  return jsonResponse(result)
})
