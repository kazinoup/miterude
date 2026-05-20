// β-1 E.5: 公開レポート用 Edge Function
//
// GET /functions/v1/share-report?token=<token>
//   → { ok, organization, link, sensors[], readingsBySensor{ sensor_id: row[] } }
//
// verify_jwt=false で誰でも叩ける。anon でも service_role でデータを返す。
// β-1 で report_delivery_links / organizations / devices / sensor_props /
// sensor_readings の anon SELECT を撤去したため、PublicReportView は本 EF 経由
// に切替。share-dashboard と同形。
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Cache-Control': 'no-store',
    },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return jsonResponse({ ok: true })
  if (req.method !== 'GET' && req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'method-not-allowed' }, 405)
  }
  const url = new URL(req.url)
  const token = url.searchParams.get('token')
  if (!token || token.length < 16) {
    return jsonResponse({ ok: false, error: 'invalid-token' }, 400)
  }

  // 1) link 行を token で SELECT
  const { data: link, error: linkErr } = await supabase
    .from('report_delivery_links')
    .select(
      'id, organization_id, schedule_id, report_kind, period_start, period_end, target_sensor_ids, expires_at',
    )
    .eq('token', token)
    .maybeSingle()
  if (linkErr) return jsonResponse({ ok: false, error: linkErr.message }, 500)
  if (!link) return jsonResponse({ ok: false, error: 'not-found' }, 404)
  if (link.expires_at && new Date(link.expires_at).getTime() < Date.now()) {
    return jsonResponse({ ok: false, error: 'expired' }, 410)
  }

  // 2) 組織
  const { data: org, error: orgErr } = await supabase
    .from('organizations')
    .select('id, name')
    .eq('id', link.organization_id)
    .maybeSingle()
  if (orgErr) return jsonResponse({ ok: false, error: orgErr.message }, 500)
  if (!org) return jsonResponse({ ok: false, error: 'org-not-found' }, 404)

  // 3) 対象センサー（target が指定されていればその ID、無ければ org の全 sensor）
  const targetIds: string[] = link.target_sensor_ids ?? []
  const devicesQuery = targetIds.length > 0
    ? supabase
        .from('devices')
        .select('id, name, device_number, serial_number')
        .in('id', targetIds)
    : supabase
        .from('devices')
        .select('id, name, device_number, serial_number')
        .eq('organization_id', link.organization_id)
        .eq('device_type', 'sensor')
  const { data: devices, error: devErr } = await devicesQuery
  if (devErr) return jsonResponse({ ok: false, error: devErr.message }, 500)
  const deviceList = devices ?? []

  // 4) sensor_props で thresholds
  const sensorIds = deviceList.map((d) => d.id)
  const propsRes = sensorIds.length > 0
    ? await supabase
        .from('sensor_props')
        .select('device_id, thresholds')
        .in('device_id', sensorIds)
    : { data: [] as Array<{ device_id: string; thresholds: unknown }>, error: null as null | { message: string } }
  if (propsRes.error) return jsonResponse({ ok: false, error: propsRes.error.message }, 500)
  const thresholdsByDevice: Record<string, unknown> = {}
  for (const row of propsRes.data ?? []) {
    thresholdsByDevice[row.device_id] = row.thresholds ?? null
  }

  const sensors = deviceList.map((d) => ({
    id: d.id,
    name: d.name,
    device_number: d.device_number,
    serial_number: d.serial_number,
    thresholds: thresholdsByDevice[d.id] ?? null,
  }))

  // 5) 対象期間の readings をセンサーごと並列・1000 件単位ページング
  const periodStartIso = `${link.period_start}T00:00:00+09:00`
  const endDate = new Date(`${link.period_end}T00:00:00+09:00`)
  endDate.setDate(endDate.getDate() + 1)
  const periodEndIso = endDate.toISOString()

  async function fetchAllReadings(sensorId: string) {
    const PAGE = 1000
    const out: Array<{
      sensor_id: string
      measured_at: string
      temperature: number | null
      humidity: number | null
      battery: number | null
    }> = []
    let offset = 0
    while (true) {
      const { data, error } = await supabase
        .from('sensor_readings')
        .select('sensor_id, measured_at, temperature, humidity, battery')
        .eq('sensor_id', sensorId)
        .gte('measured_at', periodStartIso)
        .lt('measured_at', periodEndIso)
        .order('measured_at', { ascending: true })
        .range(offset, offset + PAGE - 1)
      if (error) {
        console.error('[share-report] readings', sensorId, error)
        break
      }
      const rows = data ?? []
      out.push(...rows)
      if (rows.length < PAGE) break
      offset += PAGE
    }
    return out
  }

  const readingsBySensor: Record<string, Awaited<ReturnType<typeof fetchAllReadings>>> = {}
  await Promise.all(
    sensors.map(async (s) => {
      readingsBySensor[s.id] = await fetchAllReadings(s.id)
    }),
  )

  // 6) view_count / last_viewed_at を加算（best-effort）
  supabase
    .from('report_delivery_links')
    .update({
      last_viewed_at: new Date().toISOString(),
      view_count: 1,
    })
    .eq('id', link.id)
    .then(() => undefined)

  return jsonResponse({
    ok: true,
    organization: org,
    link,
    sensors,
    readingsBySensor,
  })
})
