// β-7e+: CSV 由来の sensor_readings 一括投入 Edge Function
//
// POST /functions/v1/import-csv-readings
//   Body: {
//     organization_id: uuid,
//     rows: Array<{
//       device_id?: string,         // どちらか必須（uuid 直指定）
//       device_number?: string,     // または device_number 経由解決
//       measured_at: string,        // ISO timestamp
//       temperature?: number,
//       humidity?: number,
//       battery?: number,
//     }>
//   }
//
// 権限: super_admin のみ（JWT app_role を確認）。service_role キーも可。
// service_role 経由で sensor_readings に bulk insert（500 件チャンク）。
//
// 動作:
//   - rows で device_id 未指定なら device_number から該当組織内の device.id を解決
//   - 対象組織に属さない device_id / 不明な device_number はスキップ
//   - inserted / skipped / errors を返す
//
// CSV パースはフロント側で済ませて rows[] を渡す前提（CSV 仕様の自由度を確保）。
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

type Row = {
  device_id?: string
  device_number?: string
  measured_at?: string
  temperature?: number | null
  humidity?: number | null
  battery?: number | null
}

type Body = {
  organization_id?: string
  rows?: Row[]
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Max-Age': '86400',
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...CORS_HEADERS,
    },
  })
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.')
    if (parts.length < 2) return null
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
    return JSON.parse(atob(padded)) as Record<string, unknown>
  } catch {
    return null
  }
}

function checkAuthorization(req: Request): { ok: boolean; reason?: string } {
  const auth = req.headers.get('Authorization') ?? ''
  if (!auth.startsWith('Bearer ')) return { ok: false, reason: 'missing-bearer' }
  const token = auth.slice('Bearer '.length).trim()
  if (!token) return { ok: false, reason: 'empty-token' }
  if (token === SERVICE_ROLE_KEY) return { ok: true }
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }
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
  const rows = body.rows
  if (!orgId) {
    return jsonResponse({ ok: false, error: 'organization_id required' }, 400)
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    return jsonResponse({ ok: false, error: 'rows required' }, 400)
  }
  if (rows.length > 50000) {
    return jsonResponse({ ok: false, error: 'too many rows (max 50000)' }, 400)
  }

  // ---------- 1) device_number → device_id の解決マップを作る ----------
  const deviceNumbers = Array.from(
    new Set(
      rows
        .filter((r) => !r.device_id && r.device_number)
        .map((r) => r.device_number as string),
    ),
  )
  const deviceIdByNumber = new Map<string, string>()
  if (deviceNumbers.length > 0) {
    const { data, error } = await supabase
      .from('devices')
      .select('id, device_number')
      .eq('organization_id', orgId)
      .in('device_number', deviceNumbers)
    if (error) {
      return jsonResponse({ ok: false, error: `device lookup: ${error.message}` }, 500)
    }
    for (const d of data ?? []) {
      if (d.device_number) deviceIdByNumber.set(d.device_number, d.id)
    }
  }

  // 念のため、直接渡された device_id が本当に対象組織のものかも検証
  const directIds = Array.from(
    new Set(rows.filter((r) => r.device_id).map((r) => r.device_id as string)),
  )
  const validDirectIds = new Set<string>()
  if (directIds.length > 0) {
    const { data, error } = await supabase
      .from('devices')
      .select('id')
      .eq('organization_id', orgId)
      .in('id', directIds)
    if (error) {
      return jsonResponse({ ok: false, error: `device check: ${error.message}` }, 500)
    }
    for (const d of data ?? []) validDirectIds.add(d.id)
  }

  // ---------- 2) 投入対象を構築（不正 row は skipped に積む） ----------
  type Reading = {
    organization_id: string
    sensor_id: string
    measured_at: string
    temperature: number | null
    humidity: number | null
    battery: number | null
  }
  const readings: Reading[] = []
  const errors: Array<{ index: number; reason: string }> = []
  rows.forEach((r, idx) => {
    let sensorId: string | null = null
    if (r.device_id) {
      if (validDirectIds.has(r.device_id)) sensorId = r.device_id
      else {
        errors.push({ index: idx, reason: `device_id ${r.device_id} not in org` })
        return
      }
    } else if (r.device_number) {
      const id = deviceIdByNumber.get(r.device_number)
      if (id) sensorId = id
      else {
        errors.push({ index: idx, reason: `device_number ${r.device_number} not found` })
        return
      }
    } else {
      errors.push({ index: idx, reason: 'no device_id or device_number' })
      return
    }
    if (!r.measured_at) {
      errors.push({ index: idx, reason: 'measured_at required' })
      return
    }
    const t = new Date(r.measured_at)
    if (Number.isNaN(t.getTime())) {
      errors.push({ index: idx, reason: `invalid measured_at: ${r.measured_at}` })
      return
    }
    readings.push({
      organization_id: orgId,
      sensor_id: sensorId,
      measured_at: t.toISOString(),
      temperature:
        typeof r.temperature === 'number' && Number.isFinite(r.temperature)
          ? r.temperature
          : null,
      humidity:
        typeof r.humidity === 'number' && Number.isFinite(r.humidity)
          ? r.humidity
          : null,
      battery:
        typeof r.battery === 'number' && Number.isFinite(r.battery)
          ? Math.round(r.battery)
          : null,
    })
  })

  // ---------- 3) 500 件チャンクで insert ----------
  let inserted = 0
  const CHUNK = 500
  for (let i = 0; i < readings.length; i += CHUNK) {
    const slice = readings.slice(i, i + CHUNK)
    const { error } = await supabase.from('sensor_readings').insert(slice)
    if (error) {
      return jsonResponse(
        { ok: false, error: `readings insert: ${error.message}`, inserted, errors },
        500,
      )
    }
    inserted += slice.length
  }

  return jsonResponse({
    ok: true,
    organization_id: orgId,
    received: rows.length,
    inserted,
    skipped: errors.length,
    errors: errors.slice(0, 50),
  })
})
