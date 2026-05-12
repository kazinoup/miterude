// Milesight Webhook 受信 Edge Function
//
// 署名スキーム（実頼で逆解析したもの）:
//   X-Msc-Request-Signature = HMAC-SHA256(webhook_secret, timestamp + nonce)  // hex lowercase
//   X-Msc-Request-Timestamp = epoch 秒
//   X-Msc-Request-Nonce     = UUID
//   X-Msc-Webhook-Uuid      = MDP が発行するアプリケーション固有の UUID
//
// 接受後は inline で parser を走らせ、webhook_inbox を parsed 状態した上で
// devices / sensor_props / sensor_readings を更新する。失敗しても MDP には 200 を
// 返し、webhook_inbox.parse_status='failed' として後でリプレイできるようにする。
//
// Phase 1.3a: sensor_readings INSERT 後にアラート判定を実行し、必要なら alert_logs に INSERT。
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { judgeAndInsertAlert } from '../_shared/alertDetection.ts'

const MANUFACTURER = 'Milesight'
const TIMESTAMP_TOLERANCE_SEC = 300 // 5 分

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

// ===== 共通ユーティリティ ===========================================

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Connection': 'keep-alive' },
  })
}

function extractOrgId(url: URL): string | null {
  const parts = url.pathname.split('/').filter(Boolean)
  const idx = parts.lastIndexOf('webhook-milesight')
  if (idx === -1 || idx === parts.length - 1) return null
  const candidate = parts[idx + 1]
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(candidate)) {
    return null
  }
  return candidate
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message))
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder()
  const aBytes = enc.encode(a)
  const bBytes = enc.encode(b)
  const len = Math.max(aBytes.length, bBytes.length)
  let diff = aBytes.length ^ bBytes.length
  for (let i = 0; i < len; i++) diff |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0)
  return diff === 0
}

function headersToObject(h: Headers): Record<string, string> {
  const out: Record<string, string> = {}
  h.forEach((value, key) => { out[key.toLowerCase()] = value })
  return out
}

function toNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

// ===== model → device_type / role のマッピング ============================
// src/lib/supportedDevices.ts と同期させること。
type DeviceTypeRole = { device_type: 'sensor' | 'gateway'; role: string }
const MODEL_MAP: Record<string, DeviceTypeRole> = {
  'EM320-TH':        { device_type: 'sensor', role: 'temperature-humidity' },
  'EM320-TH-MAGNET': { device_type: 'sensor', role: 'temperature-humidity' },
  'AM102':           { device_type: 'sensor', role: 'temperature-humidity' },
  'EM300-TH':        { device_type: 'sensor', role: 'temperature-humidity' },
  'UG65':            { device_type: 'gateway', role: 'master' },
  'UG63':            { device_type: 'gateway', role: 'relay' },
}
function mapModel(model: string): DeviceTypeRole | null {
  if (!model) return null
  if (MODEL_MAP[model]) return MODEL_MAP[model]
  const lower = model.toLowerCase()
  for (const [k, v] of Object.entries(MODEL_MAP)) {
    if (lower.startsWith(k.toLowerCase() + '-')) return v
  }
  return null
}

// ===== Parser ====================================================

type PayloadShape = {
  devEUI: string | null
  model: string | null
  name: string | null
  sn: string | null
  eventType: string | null
  dataType: string | null
  tslId: string | null
  dataTs: number | null
  payloadFields: Record<string, unknown>
}

function extractPayload(raw: Record<string, unknown>): PayloadShape {
  const eventType = typeof raw.eventType === 'string' ? raw.eventType : null
  const data = (raw.data && typeof raw.data === 'object') ? raw.data as Record<string, unknown> : null
  const dp = (data?.deviceProfile && typeof data.deviceProfile === 'object')
    ? data.deviceProfile as Record<string, unknown> : null
  const pf = (data?.payload && typeof data.payload === 'object')
    ? data.payload as Record<string, unknown> : {}
  return {
    devEUI:    typeof dp?.devEUI === 'string' ? dp.devEUI : null,
    model:     typeof dp?.model === 'string' ? dp.model : null,
    name:      typeof dp?.name === 'string' ? dp.name : null,
    sn:        typeof dp?.sn === 'string' ? dp.sn : null,
    eventType,
    dataType:  typeof data?.type === 'string' ? data.type as string : null,
    tslId:     typeof data?.tslId === 'string' ? data.tslId as string : null,
    dataTs:    typeof data?.ts === 'number' ? data.ts as number : null,
    payloadFields: pf,
  }
}

type DeviceLookupResult =
  | { ok: true; id: string; device_type: string; role: string; manufacturer: string; model: string; serial_number: string; device_number: string | null }
  | { ok: false; error: string }

async function findOrRegisterDevice(
  orgId: string,
  p: PayloadShape,
): Promise<DeviceLookupResult> {
  if (!p.devEUI) return { ok: false, error: 'missing-devEUI' }
  if (!p.model)  return { ok: false, error: 'missing-model' }

  const { data: existing, error: lookErr } = await supabase
    .from('devices')
    .select('id, device_type, role, manufacturer, model, serial_number, device_number')
    .eq('organization_id', orgId)
    .eq('manufacturer', 'Milesight')
    .eq('external_key', p.devEUI)
    .maybeSingle()
  if (lookErr) return { ok: false, error: `lookup-error: ${lookErr.message}` }
  if (existing) return { ok: true, ...existing }

  const mapped = mapModel(p.model)
  if (!mapped) return { ok: false, error: `unknown-model: ${p.model}` }

  const deviceNumber = (p.name ?? '').trim() || p.devEUI

  const { data: inserted, error: insErr } = await supabase
    .from('devices')
    .insert({
      organization_id: orgId,
      device_type: mapped.device_type,
      role: mapped.role,
      manufacturer: 'Milesight',
      model: p.model,
      external_key: p.devEUI,
      serial_number: p.sn || p.devEUI,
      dev_eui: p.devEUI,
      name: p.name ?? '',
      device_number: deviceNumber,
    })
    .select('id, device_type, role, manufacturer, model, serial_number, device_number')
    .single()
  if (insErr) return { ok: false, error: `insert-device: ${insErr.message}` }

  if (mapped.device_type === 'sensor') {
    const { error } = await supabase.from('sensor_props').insert({ device_id: inserted.id })
    if (error) return { ok: false, error: `insert-sensor-props: ${error.message}` }
  } else {
    const { error } = await supabase.from('gateway_props').insert({ device_id: inserted.id })
    if (error) return { ok: false, error: `insert-gateway-props: ${error.message}` }
  }

  return { ok: true, ...inserted }
}

async function processRow(row: {
  id: string
  organization_id: string
  payload_raw: Record<string, unknown>
}): Promise<{ status: 'parsed' | 'failed' | 'ignored'; error?: string; readingCount: number; alertFired: number }> {
  const p = extractPayload(row.payload_raw)

  if (p.eventType !== 'DEVICE_DATA') {
    return { status: 'ignored', readingCount: 0, alertFired: 0 }
  }

  const dev = await findOrRegisterDevice(row.organization_id, p)
  if (!dev.ok) return { status: 'failed', error: dev.error, readingCount: 0, alertFired: 0 }

  const isHistorical = p.dataType === 'EVENT' && p.tslId === 'historical_data'

  let measuredAtIso: string | null = null
  if (isHistorical) {
    const ts = toNumber(p.payloadFields.timestamp)
    if (ts != null) {
      const ms = ts < 1e12 ? ts * 1000 : ts
      measuredAtIso = new Date(ms).toISOString()
    } else if (p.dataTs != null) {
      measuredAtIso = new Date(p.dataTs).toISOString()
    }
  } else {
    if (p.dataTs != null) measuredAtIso = new Date(p.dataTs).toISOString()
  }

  const temp = toNumber(p.payloadFields.temperature)
  const humid = toNumber(p.payloadFields.humidity)
  const battery = toNumber(p.payloadFields.battery)

  let readingCount = 0
  let alertFired = 0

  if (dev.device_type === 'sensor' && (temp != null || humid != null) && measuredAtIso) {
    const { error } = await supabase.from('sensor_readings').insert({
      organization_id: row.organization_id,
      sensor_id: dev.id,
      measured_at: measuredAtIso,
      temperature: temp,
      humidity: humid,
      battery: null,
      source_inbox_id: row.id,
    })
    if (error) return { status: 'failed', error: `reading-insert: ${error.message}`, readingCount: 0, alertFired: 0 }
    readingCount += 1

    // Phase 1.3a: アラート判定
    try {
      const { data: props } = await supabase
        .from('sensor_props')
        .select('device_id, thresholds, alert_settings, exclusion_windows, exclusion_dates')
        .eq('device_id', dev.id)
        .maybeSingle()
      if (props) {
        const res = await judgeAndInsertAlert(supabase, {
          device: {
            id: dev.id,
            organization_id: row.organization_id,
            manufacturer: dev.manufacturer,
            model: dev.model,
            serial_number: dev.serial_number,
            device_number: dev.device_number,
          },
          sensorProps: props,
          newReading: {
            measured_at: measuredAtIso,
            temperature: temp,
            humidity: humid,
          },
          isHistorical,
        })
        alertFired = res.fired
      }
    } catch (e) {
      // アラート判定の失敗は本体（reading 保存）に影響させない
      console.error('[alert] judge failed', e)
    }
  }

  if (dev.device_type === 'sensor' && battery != null) {
    const { error } = await supabase.from('sensor_props')
      .update({ battery: Math.round(battery), updated_at: new Date().toISOString() })
      .eq('device_id', dev.id)
    if (error) return { status: 'failed', error: `battery-update: ${error.message}`, readingCount, alertFired }
  }

  if (!isHistorical) {
    const { error } = await supabase.from('devices')
      .update({ online: true, last_seen_at: new Date().toISOString() })
      .eq('id', dev.id)
    if (error) return { status: 'failed', error: `device-touch: ${error.message}`, readingCount, alertFired }
  }

  return { status: 'parsed', readingCount, alertFired }
}

async function parseInboxRow(inboxId: string, orgId: string, payloadRaw: Record<string, unknown>): Promise<void> {
  try {
    const result = await processRow({ id: inboxId, organization_id: orgId, payload_raw: payloadRaw })
    const update: Record<string, unknown> = {
      parse_status: result.status,
      parsed_at: new Date().toISOString(),
      parsed_reading_count: result.readingCount,
    }
    if (result.error) update.parse_error = result.error
    await supabase.from('webhook_inbox').update(update).eq('id', inboxId)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await supabase.from('webhook_inbox').update({
      parse_status: 'failed',
      parsed_at: new Date().toISOString(),
      parse_error: `exception: ${msg}`,
    }).eq('id', inboxId)
  }
}

// ===== HTTP ハンドラ ===========================================

Deno.serve(async (req: Request) => {
  const url = new URL(req.url)
  const orgId = extractOrgId(url)
  const allHeaders = headersToObject(req.headers)
  const method = req.method
  const sourceIp =
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    req.headers.get('cf-connecting-ip') || null

  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return jsonResponse({ ok: true, method, note: 'health-check-ok' })
  }
  if (method !== 'POST') return jsonResponse({ ok: false, error: 'method-not-allowed' }, 405)
  if (!orgId) return jsonResponse({ ok: false, error: 'org-id-missing' }, 400)

  const signature = req.headers.get('x-msc-request-signature')
  const timestamp = req.headers.get('x-msc-request-timestamp')
  const nonce = req.headers.get('x-msc-request-nonce')
  const reqUuid = req.headers.get('x-msc-webhook-uuid')
  if (!signature || !timestamp || !nonce) {
    return jsonResponse({ ok: false, error: 'signature-headers-missing' }, 401)
  }

  const { data: integration, error: integErr } = await supabase
    .from('manufacturer_integrations')
    .select('webhook_secret, webhook_uuid, enabled')
    .eq('organization_id', orgId)
    .eq('manufacturer', MANUFACTURER)
    .maybeSingle()
  if (integErr) {
    console.error('[webhook-milesight] integration lookup error', integErr)
    return jsonResponse({ ok: false, error: 'integration-lookup-failed' }, 500)
  }
  if (!integration) return jsonResponse({ ok: false, error: 'integration-not-found' }, 401)
  if (!integration.enabled) return jsonResponse({ ok: false, error: 'integration-disabled' }, 401)
  if (!integration.webhook_secret) {
    return jsonResponse({ ok: false, error: 'webhook-secret-not-configured' }, 500)
  }
  if (integration.webhook_uuid && integration.webhook_uuid !== reqUuid) {
    return jsonResponse({ ok: false, error: 'uuid-mismatch' }, 401)
  }

  const tsNum = parseInt(timestamp, 10)
  if (!Number.isFinite(tsNum)) {
    return jsonResponse({ ok: false, error: 'timestamp-invalid' }, 401)
  }
  const now = Math.floor(Date.now() / 1000)
  if (Math.abs(now - tsNum) > TIMESTAMP_TOLERANCE_SEC) {
    return jsonResponse({ ok: false, error: 'timestamp-stale',
      detail: `now=${now}, ts=${tsNum}, diff=${Math.abs(now - tsNum)}s` }, 401)
  }

  const expectedSig = await hmacSha256Hex(integration.webhook_secret, timestamp + nonce)
  if (!timingSafeEqual(expectedSig, signature.toLowerCase())) {
    return jsonResponse({ ok: false, error: 'signature-mismatch' }, 401)
  }

  const bodyText = await req.text()
  let bodyJson: unknown = null
  try { bodyJson = bodyText ? JSON.parse(bodyText) : null }
  catch (_e) { return jsonResponse({ ok: false, error: 'invalid-json-body' }, 400) }

  const events: unknown[] = Array.isArray(bodyJson) ? bodyJson : bodyJson != null ? [bodyJson] : []
  if (events.length === 0) return jsonResponse({ ok: true, accepted: 0, note: 'empty-array' })

  const rows = await Promise.all(
    events.map(async (ev) => {
      const evObj = (ev && typeof ev === 'object') ? (ev as Record<string, unknown>) : { value: ev }
      const eventId = typeof evObj.eventId === 'string' ? evObj.eventId : null
      const idempotencyKey = eventId ?? `payload:${await sha256Hex(JSON.stringify(evObj))}`
      return {
        organization_id: orgId,
        manufacturer: MANUFACTURER,
        source_ip: sourceIp,
        signature_valid: true,
        payload_raw: evObj,
        raw_body: bodyText,
        event_id: eventId,
        idempotency_key: idempotencyKey,
        request_headers: { __method: method, ...allHeaders },
        parse_status: 'pending' as const,
      }
    }),
  )

  const { data: inserted, error } = await supabase
    .from('webhook_inbox')
    .upsert(rows, { onConflict: 'organization_id,idempotency_key', ignoreDuplicates: true })
    .select('id, organization_id, payload_raw')

  if (error) {
    console.error('[webhook-milesight] insert failed', error)
    return jsonResponse({ ok: false, error: 'insert-failed', detail: error.message }, 500)
  }

  // inline parse を “fire-and-await” で実行する。失敗しても全体は 200 を返す。
  const newInbox = inserted ?? []
  let parsedCount = 0
  await Promise.all(newInbox.map(async (r) => {
    try {
      await parseInboxRow(r.id as string, r.organization_id as string, r.payload_raw as Record<string, unknown>)
      parsedCount += 1
    } catch (e) {
      console.error('[webhook-milesight] inline parse error', e)
    }
  }))

  return jsonResponse({
    ok: true,
    received: events.length,
    inserted: newInbox.length,
    parsed: parsedCount,
  })
})
