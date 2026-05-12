// Phase 1.7a: pg_cron 用ディスパッチャ
//
// scheduled_for を過ぎた pending 行を取り出して send-notification を呼ぶ。
// 1 分おきに走らせる前提で、1 回あたり最大 limit 件処理（既定 200）。
//
// retry_count の上限は 5 とし、それを超えても 'failed' のままにしておく
// （pg_cron が再度拾わないよう、上限超過時に status を 'failed' に書き換える）。
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return jsonResponse({ ok: false, error: 'method-not-allowed' }, 405)
  }
  const url = new URL(req.url)
  const limit = Math.max(1, Math.min(500, parseInt(url.searchParams.get('limit') || '200', 10) || 200))

  // 1) scheduled_for を過ぎた pending を取得
  const { data: rows, error } = await supabase
    .from('notification_deliveries')
    .select('id, retry_count')
    .eq('status', 'pending')
    .lte('scheduled_for', new Date().toISOString())
    .order('scheduled_for', { ascending: true })
    .limit(limit)
  if (error) return jsonResponse({ ok: false, error: error.message }, 500)
  if (!rows || rows.length === 0) return jsonResponse({ ok: true, processed: 0, sent: 0, failed: 0 })

  let sent = 0
  let failed = 0
  let abandoned = 0

  for (const r of rows) {
    // retry 回数 5 を超えていたら諦めて failed に
    if ((r.retry_count ?? 0) >= 5) {
      await supabase.from('notification_deliveries')
        .update({ status: 'failed', error_message: 'max retries exceeded' })
        .eq('id', r.id)
      abandoned += 1
      continue
    }
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/send-notification`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${SERVICE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ delivery_id: r.id }),
      })
      const body = await res.json().catch(() => ({}))
      if (res.ok && body?.ok) sent += 1
      else failed += 1
    } catch (e) {
      console.error('[dispatch] send-notification call failed', r.id, e)
      failed += 1
    }
  }

  return jsonResponse({
    ok: true,
    processed: rows.length,
    sent,
    failed,
    abandoned,
  })
})
