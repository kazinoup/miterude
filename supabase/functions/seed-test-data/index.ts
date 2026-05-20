// β-7a: テストデータ シードジェネレータ Edge Function
//
// POST /functions/v1/seed-test-data
//   Body: {
//     organization_id: uuid,
//     scenario: 'normal' | 'with-deviations' | 'with-offline' | 'battery-low',
//     sensor_count?: number = 5,
//     days?: number = 7,
//     clear_existing?: boolean = false
//   }
//
// 権限: super_admin のみ（JWT の app_role を確認）。
//   service_role の Authorization も受け付ける（cron 自動実行用、β-7b 想定）。
//
// 動作:
//   - 既存「seed-test」マークの devices / readings を任意で削除（clear_existing）
//   - 温湿度センサーを sensor_count 台、`metadata.seed_test = true` で作成
//     + sensor_props（標準的な閾値）
//   - 過去 days 日分の sensor_readings を 1 時間毎に挿入
//   - シナリオに応じて末尾数件を加工:
//     - normal:           5℃ / 50% RH 周辺で標準ノイズのみ
//     - with-deviations:  1〜2 台が ALERT/WARN 閾値外（温度上昇）
//     - with-offline:     1 台が直近 30h 無音 + last_seen_at を 30h 前に
//     - battery-low:      1 台が battery < 10%（既定アラート閾値）
//
// 戻り値: { ok, devices_created, readings_inserted, scenario, organization_id }
//
// 関連:
//   - β-7b: pg_cron が 30 分おきに stg/demo へ呼ぶ予定
//   - β-7e: Admin Console のテストデータタブから手動投入予定
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

type Scenario = 'normal' | 'with-deviations' | 'with-offline' | 'battery-low'

type Body = {
  organization_id?: string
  scenario?: Scenario
  sensor_count?: number
  days?: number
  clear_existing?: boolean
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Cache-Control': 'no-store',
    },
  })
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.')
    if (parts.length < 2) return null
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    // padding
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
    const json = atob(padded)
    return JSON.parse(json) as Record<string, unknown>
  } catch {
    return null
  }
}

/** super_admin の JWT または service_role キーであることを確認 */
function checkAuthorization(req: Request): { ok: boolean; reason?: string } {
  const auth = req.headers.get('Authorization') ?? ''
  if (!auth.startsWith('Bearer ')) return { ok: false, reason: 'missing-bearer' }
  const token = auth.slice('Bearer '.length).trim()
  if (!token) return { ok: false, reason: 'empty-token' }
  // service_role キーそのものを許容（cron 自動実行用）
  if (token === SERVICE_ROLE_KEY) return { ok: true }
  // それ以外はユーザー JWT。app_metadata.app_role === 'super_admin' を要求
  const payload = decodeJwtPayload(token)
  const role =
    payload &&
    typeof payload === 'object' &&
    'app_metadata' in payload &&
    typeof (payload as { app_metadata?: unknown }).app_metadata === 'object'
      ? ((payload as { app_metadata: Record<string, unknown> }).app_metadata
          .app_role as string | undefined)
      : undefined
  if (role !== 'super_admin') return { ok: false, reason: 'not-super-admin' }
  return { ok: true }
}

/** 0-1 → ノイズ量に変換（小さなランダム揺れ） */
function noise(amp: number): number {
  return (Math.random() * 2 - 1) * amp
}

/** 温度・湿度の標準的な値を返す（24h 周期 + ノイズ） */
function baseline(measuredAt: Date, baseT: number, baseH: number) {
  const hour = measuredAt.getUTCHours() + measuredAt.getUTCMinutes() / 60
  // 日周変動: ±1.5℃ / ±5%
  const t = baseT + Math.sin(((hour - 6) / 24) * Math.PI * 2) * 1.5 + noise(0.3)
  const h = baseH + Math.cos(((hour - 6) / 24) * Math.PI * 2) * 5 + noise(1.0)
  return {
    temperature: Math.round(t * 10) / 10,
    humidity: Math.round(h * 10) / 10,
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return jsonResponse({ ok: true })
  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'method-not-allowed' }, 405)
  }

  const auth = checkAuthorization(req)
  if (!auth.ok) {
    return jsonResponse({ ok: false, error: `unauthorized:${auth.reason}` }, 401)
  }

  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return jsonResponse({ ok: false, error: 'invalid-json' }, 400)
  }

  const orgId = body.organization_id
  const scenario: Scenario = body.scenario ?? 'normal'
  const sensorCount = Math.max(1, Math.min(20, body.sensor_count ?? 5))
  const days = Math.max(1, Math.min(30, body.days ?? 7))
  const clearExisting = body.clear_existing === true

  if (!orgId) return jsonResponse({ ok: false, error: 'organization_id required' }, 400)
  if (
    !['normal', 'with-deviations', 'with-offline', 'battery-low'].includes(scenario)
  ) {
    return jsonResponse({ ok: false, error: 'invalid scenario' }, 400)
  }

  // ---------- 1) clear_existing: seed-test マークの devices を削除 ----------
  if (clearExisting) {
    const { data: oldDevices } = await supabase
      .from('devices')
      .select('id')
      .eq('organization_id', orgId)
      .contains('metadata', { seed_test: true })
    const oldIds = (oldDevices ?? []).map((d) => d.id)
    if (oldIds.length > 0) {
      await supabase.from('sensor_readings').delete().in('sensor_id', oldIds)
      await supabase.from('sensor_props').delete().in('device_id', oldIds)
      await supabase.from('devices').delete().in('id', oldIds)
    }
  }

  // ---------- 2) devices + sensor_props を作成 ----------
  const now = new Date()
  const newDevices: Array<{ id: string; name: string }> = []
  for (let i = 0; i < sensorCount; i++) {
    const externalKey = `seed-${orgId.slice(0, 8)}-${now.getTime()}-${i}`
    const devEui = `SEEDTEST${String(now.getTime()).slice(-8)}${String(i).padStart(2, '0')}`
    const insertRes = await supabase
      .from('devices')
      .insert({
        organization_id: orgId,
        device_type: 'sensor',
        role: 'sensor',
        manufacturer: 'Milesight',
        model: 'EM300-TH',
        external_key: externalKey,
        serial_number: `SEED-${externalKey.slice(-12).toUpperCase()}`,
        dev_eui: devEui,
        name: `テストセンサー${i + 1}`,
        device_number: `T-${String(i + 1).padStart(3, '0')}`,
        online: true,
        last_seen_at: now.toISOString(),
        registered_at: new Date(now.getTime() - days * 24 * 3600_000).toISOString(),
        metadata: { seed_test: true, scenario },
      })
      .select('id, name')
      .single()
    if (insertRes.error || !insertRes.data) {
      return jsonResponse(
        { ok: false, error: `device insert: ${insertRes.error?.message}` },
        500,
      )
    }
    newDevices.push(insertRes.data)
    await supabase.from('sensor_props').insert({
      device_id: insertRes.data.id,
      thresholds: {
        kind: 'temperature-humidity',
        temperature: {
          alert: { enabled: true, min: 0, max: 10 },
          warn: { enabled: true, min: 2, max: 8 },
        },
        humidity: { alert: { enabled: false }, warn: { enabled: false } },
      },
    })
  }

  // ---------- 3) readings を days 日分 × 1h 毎で投入 ----------
  const points = days * 24
  type Reading = {
    organization_id: string
    sensor_id: string
    measured_at: string
    temperature: number | null
    humidity: number | null
    battery: number | null
  }
  const allReadings: Reading[] = []

  for (let di = 0; di < newDevices.length; di++) {
    const dev = newDevices[di]
    // この device は「特異」になるか
    const isDeviationTarget =
      scenario === 'with-deviations' && (di === 0 || di === 1)
    const isOfflineTarget = scenario === 'with-offline' && di === 0
    const isBatteryLowTarget = scenario === 'battery-low' && di === 0

    for (let p = 0; p < points; p++) {
      const ts = new Date(now.getTime() - (points - p - 1) * 3600_000)

      // offline は直近 30h の点を skip
      if (isOfflineTarget && now.getTime() - ts.getTime() < 30 * 3600_000) {
        continue
      }

      const { temperature, humidity } = baseline(ts, 5, 50)
      let t = temperature
      // deviation: 末尾 1/4 で温度が上昇し閾値外に
      if (isDeviationTarget && p >= points - points / 4) {
        t = 11 + noise(0.4)
      }

      // battery: 末尾に向けて減衰、低 1 台は 5〜9% に
      const battery = isBatteryLowTarget
        ? Math.max(5, 9 - (p / points) * 4)
        : Math.max(20, 95 - (p / points) * 5)

      allReadings.push({
        organization_id: orgId,
        sensor_id: dev.id,
        measured_at: ts.toISOString(),
        temperature: Math.round(t * 10) / 10,
        humidity,
        battery: Math.round(battery),
      })
    }

    // offline 対象は last_seen_at を 30h 前に修正
    if (isOfflineTarget) {
      await supabase
        .from('devices')
        .update({
          online: false,
          last_seen_at: new Date(now.getTime() - 30 * 3600_000).toISOString(),
        })
        .eq('id', dev.id)
    }
  }

  // 1000 件チャンクで insert
  let inserted = 0
  const CHUNK = 500
  for (let i = 0; i < allReadings.length; i += CHUNK) {
    const slice = allReadings.slice(i, i + CHUNK)
    const { error } = await supabase.from('sensor_readings').insert(slice)
    if (error) {
      return jsonResponse(
        { ok: false, error: `readings insert: ${error.message}`, inserted },
        500,
      )
    }
    inserted += slice.length
  }

  return jsonResponse({
    ok: true,
    organization_id: orgId,
    scenario,
    devices_created: newDevices.length,
    readings_inserted: inserted,
    days,
    sensor_count: sensorCount,
  })
})
