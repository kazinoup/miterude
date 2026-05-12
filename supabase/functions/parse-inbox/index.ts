// webhook_inbox の pending 行を取り出して devices / sensor_props / sensor_readings
// に変換する Parser。
//
// 当面は手動 invoke 用（後で cron 連動を予定）。verify_jwt=true で service_role か
// authenticated でしか叩けないようにする。
//
// Phase 1.3a: sensor_readings INSERT 後にアラート判定を実行し、必要なら alert_logs に INSERT。
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { judgeAndInsertAlert } from '../_shared/alertDetection.ts'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

// ----- model → device_type / role の対応 -----
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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

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

type DeviceLookupResult =
  | { ok: true; id: string; device_type: string; role: string; manufacturer: string; model: string; serial_number: string; device_number: string | null; notification_group_id: string | null }
  | { ok: false; error: string }

async function findOrRegisterDevice(
  orgId: string,
  payload: PayloadShape,
): Promise<DeviceLookupResult> {
  const devEui = payload.devEUI
  const model  = payload.model
  const name   = payload.name ?? ''
  const sn     = payload.sn ?? ''
  if (!devEui) return { ok: false, error: 'missing-devEUI' }
  if (!model)  return { ok: false, error: 'missing-model' }

  const { data: existing, error: lookErr } = await supabase
    .from('devices')
    .select('id, device_type, role, manufacturer, model, serial_number, device_number, notification_group_id')
    .eq('organization_id', orgId)
    .eq('manufacturer', 'Milesight')
    .eq('external_key', devEui)
    .maybeSingle()
  if (lookErr) return { ok: false, error: `lookup-error: ${lookErr.message}` }
  if (existing) return { ok: true, ...existing }

  const mapped = mapModel(model)
  if (!mapped) return { ok: false, error: `unknown-model: ${model}` }

  const deviceNumber = name.trim() || devEui

  const { data: inserted, error: insErr } = await supabase
    .from('devices')
    .insert({
      organization_id: orgId,
      device_type: mapped.device_type,
      role: mapped.role,
      manufacturer: 'Milesight',
      model,
      external_key: devEui,
      serial_number: sn || devEui,
      dev_eui: devEui,
      name,
      device_number: deviceNumber,
    })
    .select('id, device_type, role, manufacturer, model, serial_number, device_number, notification_group_id')
    .single()
  if (insErr) return { ok: false, error: `insert-device-error: ${insErr.message}` }

  if (mapped.device_type === 'sensor') {
    const { error } = await supabase.from('sensor_props').insert({ device_id: inserted.id })
    if (error) return { ok: false, error: `insert-sensor-props: ${error.message}` }
  } else {
    const { error } = await supabase.from('gateway_props').insert({ device_id: inserted.id })
    if (error) return { ok: false, error: `insert-gateway-props: ${error.message}` }
  }

  return { ok: true, ...inserted }
}

function extractPayload(raw: Record<string, unknown>): PayloadShape {
  const eventType = typeof raw.eventType === 'string' ? raw.eventType : null
  const data = (raw.data && typeof raw.data === 'object')
    ? raw.data as Record<string, unknown> : null
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

function toNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
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
    const { error } = await supabase
      .from('sensor_readings')
      .insert({
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

    // Phase 1.3a: アラート判定（historical は除外）
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
            notification_group_id: dev.notification_group_id,
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
      console.error('[alert] judge failed', e)
    }
  }

  if (dev.device_type === 'sensor' && battery != null) {
    const { error } = await supabase
      .from('sensor_props')
      .update({ battery: Math.round(battery), updated_at: new Date().toISOString() })
      .eq('device_id', dev.id)
    if (error) return { status: 'failed', error: `battery-update: ${error.message}`, readingCount, alertFired }
  }

  if (!isHistorical) {
    const { error } = await supabase
      .from('devices')
      .update({ online: true, last_seen_at: new Date().toISOString() })
      .eq('id', dev.id)
    if (error) return { status: 'failed', error: `device-touch: ${error.message}`, readingCount, alertFired }
  }

  return { status: 'parsed', readingCount, alertFired }
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return jsonResponse({ ok: false, error: 'method-not-allowed' }, 405)
  }

  const url = new URL(req.url)
  const limit = Math.max(1, Math.min(2000, parseInt(url.searchParams.get('limit') || '500', 10) || 500))

  const { data: rows, error } = await supabase
    .from('webhook_inbox')
    .select('id, organization_id, payload_raw')
    .eq('parse_status', 'pending')
    .order('received_at', { ascending: true })
    .limit(limit)

  if (error) return jsonResponse({ ok: false, error: error.message }, 500)
  if (!rows || rows.length === 0) {
    return jsonResponse({ ok: true, processed: 0, parsed: 0, failed: 0, ignored: 0, alertFired: 0 })
  }

  let parsed = 0, failed = 0, ignored = 0, alertFiredTotal = 0
  const errors: { id: string; error: string }[] = []

  for (const row of rows) {
    try {
      const result = await processRow(row as never)
      const update: Record<string, unknown> = {
        parse_status: result.status,
        parsed_at: new Date().toISOString(),
        parsed_reading_count: result.readingCount,
      }
      if (result.error) {
        update.parse_error = result.error
        errors.push({ id: row.id, error: result.error })
      }
      await supabase.from('webhook_inbox').update(update).eq('id', row.id)
      if (result.status === 'parsed') parsed += 1
      else if (result.status === 'failed') failed += 1
      else ignored += 1
      alertFiredTotal += result.alertFired
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      failed += 1
      errors.push({ id: row.id, error: `exception: ${msg}` })
      await supabase.from('webhook_inbox').update({
        parse_status: 'failed',
        parsed_at: new Date().toISOString(),
        parse_error: `exception: ${msg}`,
      }).eq('id', row.id)
    }
  }

  return jsonResponse({
    ok: true,
    processed: rows.length,
    parsed,
    failed,
    ignored,
    alertFired: alertFiredTotal,
    errors: errors.slice(0, 20),
  })
})
