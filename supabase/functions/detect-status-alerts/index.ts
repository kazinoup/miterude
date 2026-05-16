// Phase 1.11b: 状態ベースのアラート検知ジョブ
//
// pg_cron で 10 分おきに起動。webhook 経由ではなく「現在の状態」から
// 以下の 4 種を判定して alert_logs に積み、通知配信する。
//   1. オフライン初回検知（センサーから受信が途絶えたとき）
//   2. オフライン継続中の再アラート（offlineReAlertEnabled = true のセンサー）
//   3. オフライン復帰アラート（途絶 → 戻ったとき。1 回だけ）
//   4. バッテリー再アラート（batteryReAlertEnabled = true で日数経過）
//
// 初回バッテリーアラートは別経路（webhook 経由）で生成する想定。
// 本ジョブは「すでに発生したバッテリーアラートを定期的に再発火させる」係。

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

type AlertSettings = {
  offlineEnabled?: boolean
  offlineThresholdMinutes?: number
  offlineReAlertEnabled?: boolean
  offlineReAlertHours?: number
  batteryEnabled?: boolean
  batteryThresholdPercent?: number
  batteryReAlertEnabled?: boolean
  batteryReAlertDays?: number
}

type DeviceRow = {
  id: string
  organization_id: string
  manufacturer: string
  model: string
  serial_number: string
  device_number: string | null
  notification_group_id: string | null
  online: boolean
  last_seen_at: string | null
}

type SensorPropsRow = {
  device_id: string
  alert_settings: AlertSettings | null
  battery: number | null
}

type AlertRow = {
  id: string
  occurred_at: string
  kind: string
  session_id: string | null
  re_alert_index: number | null
}

type Channel = { id?: string; kind: 'email' | 'slack' | 'webhook'; target: string }

const TIMING_DELAY_HOURS: Record<string, number> = {
  immediate: 0,
  'batch-1h': 1,
  'batch-6h': 6,
  'batch-12h': 12,
  'batch-24h': 24,
}

/** 既存の send-notification と同じパターンで配信レコードを作成する。
 *  immediate なら同期で送信。 */
async function dispatchDeliveriesForAlert(opts: {
  organization_id: string
  alert_log_id: string
  notification_group_id: string | null
}): Promise<void> {
  const { organization_id, alert_log_id, notification_group_id } = opts
  if (!notification_group_id) return
  const { data: group } = await supabase
    .from('notification_groups')
    .select('id, timing, enabled, channels')
    .eq('id', notification_group_id)
    .maybeSingle()
  if (!group || group.enabled === false) return
  const channels = (group.channels ?? []) as Channel[]
  if (channels.length === 0) return
  const timing = (group.timing as string) ?? 'immediate'
  const delayHours = TIMING_DELAY_HOURS[timing] ?? 0
  const scheduledFor = new Date(
    Date.now() + delayHours * 60 * 60 * 1000,
  ).toISOString()

  const rows = channels
    .filter((c) => c.target && (c.kind === 'email' || c.kind === 'slack' || c.kind === 'webhook'))
    .map((c) => ({
      organization_id,
      alert_log_id,
      notification_group_id: group.id,
      channel_kind: c.kind,
      target: c.target,
      status: 'pending',
      scheduled_for: scheduledFor,
    }))
  if (rows.length === 0) return

  const { data: inserted } = await supabase
    .from('notification_deliveries')
    .insert(rows)
    .select('id')

  if (timing !== 'immediate' || !inserted) return
  const url = Deno.env.get('SUPABASE_URL')!
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  await Promise.all(
    inserted.map(async (r) => {
      try {
        await fetch(`${url}/functions/v1/send-notification`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ delivery_id: r.id }),
        })
      } catch (e) {
        console.warn('[detect-status] immediate send failed', r.id, e)
      }
    }),
  )
}

/** alert_logs に 1 件 INSERT し、ID を返す。 */
async function insertAlert(opts: {
  organization_id: string
  occurred_at: Date
  target_id: string
  device: DeviceRow
  kind: 'offline' | 'offline-recovery' | 'battery'
  message: string
  session_id: string
  re_alert_index: number
  value?: number
  metric?: 'temperature' | 'humidity' | 'battery'
}): Promise<string | null> {
  const { data, error } = await supabase
    .from('alert_logs')
    .insert({
      organization_id: opts.organization_id,
      occurred_at: opts.occurred_at.toISOString(),
      target_kind: 'sensor',
      target_id: opts.target_id,
      manufacturer: opts.device.manufacturer,
      model: opts.device.model,
      serial_number: opts.device.serial_number,
      sensor_number: opts.device.device_number,
      kind: opts.kind,
      metric: opts.metric ?? null,
      value: opts.value ?? null,
      message: opts.message,
      session_id: opts.session_id,
      re_alert_index: opts.re_alert_index,
    })
    .select('id')
    .single()
  if (error || !data) {
    console.error('[detect-status] alert insert failed', error)
    return null
  }
  return (data as { id: string }).id
}

/** sensor 1 台に対して、オフライン + バッテリー再アラートを評価して必要なら発火。 */
async function processSensor(
  device: DeviceRow,
  props: SensorPropsRow,
  now: Date,
): Promise<{
  offlineFired: number
  recoveryFired: number
  batteryReAlertFired: number
}> {
  const settings = props.alert_settings ?? {}
  const counters = { offlineFired: 0, recoveryFired: 0, batteryReAlertFired: 0 }

  // 直近の offline 系アラート（session_id 単位の最終行）
  const { data: lastOfflineRow } = await supabase
    .from('alert_logs')
    .select('id, occurred_at, kind, session_id, re_alert_index')
    .eq('target_id', device.id)
    .in('kind', ['offline', 'offline-recovery'])
    .order('occurred_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const lastOffline = lastOfflineRow as AlertRow | null

  // 「現在オフラインか」を last_seen_at で判定（offlineEnabled が ON のときのみ）
  const offlineEnabled = settings.offlineEnabled !== false
  const thresholdMin = Math.max(1, settings.offlineThresholdMinutes ?? 60)
  let isOfflineNow = false
  let lastSeen: Date | null = null
  if (device.last_seen_at) lastSeen = new Date(device.last_seen_at)
  if (offlineEnabled) {
    if (!lastSeen) {
      // registered_at から十分時間が経っていなければスキップ（誤検知防止）
      isOfflineNow = false
    } else {
      const elapsedMin = (now.getTime() - lastSeen.getTime()) / 60_000
      isOfflineNow = elapsedMin >= thresholdMin
    }
  }

  // 直前にオフライン中だったか（最終 offline alert が close されていない＝ recovery が後続していない）
  const wasOffline =
    !!lastOffline && lastOffline.kind === 'offline'

  if (offlineEnabled) {
    if (isOfflineNow && !wasOffline) {
      // ---- 1) オフライン初回検知 ----
      const sessionId = crypto.randomUUID()
      const message = `センサーからの受信が ${thresholdMin} 分以上途絶えました（最終: ${lastSeen ? lastSeen.toISOString() : '不明'}）`
      const alertId = await insertAlert({
        organization_id: device.organization_id,
        occurred_at: now,
        target_id: device.id,
        device,
        kind: 'offline',
        message,
        session_id: sessionId,
        re_alert_index: 0,
      })
      if (alertId) {
        counters.offlineFired += 1
        await dispatchDeliveriesForAlert({
          organization_id: device.organization_id,
          alert_log_id: alertId,
          notification_group_id: device.notification_group_id,
        })
      }
    } else if (isOfflineNow && wasOffline) {
      // ---- 2) オフライン継続中の再アラート ----
      const reAlertOn = Boolean(settings.offlineReAlertEnabled)
      const reAlertHours = Math.max(
        1,
        Math.min(24, settings.offlineReAlertHours ?? 6),
      )
      if (reAlertOn && lastOffline) {
        const elapsedMs = now.getTime() - new Date(lastOffline.occurred_at).getTime()
        if (elapsedMs >= reAlertHours * 3600_000) {
          const message = `通信途絶が続いています（最終受信: ${lastSeen ? lastSeen.toISOString() : '不明'}）（再アラート ${(lastOffline.re_alert_index ?? 0) + 1}）`
          const alertId = await insertAlert({
            organization_id: device.organization_id,
            occurred_at: now,
            target_id: device.id,
            device,
            kind: 'offline',
            message,
            session_id: lastOffline.session_id ?? crypto.randomUUID(),
            re_alert_index: (lastOffline.re_alert_index ?? 0) + 1,
          })
          if (alertId) {
            counters.offlineFired += 1
            await dispatchDeliveriesForAlert({
              organization_id: device.organization_id,
              alert_log_id: alertId,
              notification_group_id: device.notification_group_id,
            })
          }
        }
      }
    } else if (!isOfflineNow && wasOffline) {
      // ---- 3) オフライン復帰アラート（単発） ----
      const message = `通信が復帰しました（最終受信: ${lastSeen ? lastSeen.toISOString() : '不明'}）`
      const alertId = await insertAlert({
        organization_id: device.organization_id,
        occurred_at: now,
        target_id: device.id,
        device,
        kind: 'offline-recovery',
        message,
        session_id: lastOffline?.session_id ?? crypto.randomUUID(),
        re_alert_index: 0,
      })
      if (alertId) {
        counters.recoveryFired += 1
        await dispatchDeliveriesForAlert({
          organization_id: device.organization_id,
          alert_log_id: alertId,
          notification_group_id: device.notification_group_id,
        })
      }
    }
  }

  // ---- 4) バッテリー再アラート ----
  // 「現在 battery < threshold」かつ「最後の battery alert から daysX 日経過」のときに再発火。
  // ただし「現在オフライン」のときはバッテリー値が古い可能性が高いので skip。
  const batteryEnabled = Boolean(settings.batteryEnabled)
  const batteryReAlertOn = Boolean(settings.batteryReAlertEnabled)
  const batteryThreshold = settings.batteryThresholdPercent ?? 10
  const batteryReAlertDays = Math.max(
    1,
    Math.min(30, settings.batteryReAlertDays ?? 7),
  )
  if (
    batteryEnabled &&
    batteryReAlertOn &&
    !isOfflineNow &&
    typeof props.battery === 'number' &&
    props.battery < batteryThreshold
  ) {
    const { data: lastBattery } = await supabase
      .from('alert_logs')
      .select('id, occurred_at, session_id, re_alert_index')
      .eq('target_id', device.id)
      .eq('kind', 'battery')
      .order('occurred_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (lastBattery) {
      const last = lastBattery as AlertRow
      const elapsedMs = now.getTime() - new Date(last.occurred_at).getTime()
      if (elapsedMs >= batteryReAlertDays * 86400_000) {
        const message = `バッテリー残量 ${props.battery}% がしきい値 ${batteryThreshold}% を下回り続けています（再アラート ${(last.re_alert_index ?? 0) + 1}）`
        const alertId = await insertAlert({
          organization_id: device.organization_id,
          occurred_at: now,
          target_id: device.id,
          device,
          kind: 'battery',
          metric: 'battery',
          value: props.battery,
          message,
          session_id: last.session_id ?? crypto.randomUUID(),
          re_alert_index: (last.re_alert_index ?? 0) + 1,
        })
        if (alertId) {
          counters.batteryReAlertFired += 1
          await dispatchDeliveriesForAlert({
            organization_id: device.organization_id,
            alert_log_id: alertId,
            notification_group_id: device.notification_group_id,
          })
        }
      }
    }
  }

  return counters
}

// H1: device_type='sensor' を range ページングで全件取得
//     （PostgREST max_rows=1000 で 1000 台超のオフライン検知が
//      沈黙故障するのを防ぐ）。
async function fetchAllSensorDevices(): Promise<DeviceRow[]> {
  const all: DeviceRow[] = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('devices')
      .select(
        'id, organization_id, manufacturer, model, serial_number, device_number, notification_group_id, online, last_seen_at',
      )
      .eq('device_type', 'sensor')
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw error
    const rows = (data ?? []) as DeviceRow[]
    all.push(...rows)
    if (rows.length < PAGE) break
  }
  return all
}

// sensor_props を device_id チャンクで取得（IN 上限 / 1000件回避）。
async function fetchPropsByIds(
  ids: string[],
): Promise<Record<string, SensorPropsRow>> {
  const map: Record<string, SensorPropsRow> = {}
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500)
    const { data } = await supabase
      .from('sensor_props')
      .select('device_id, alert_settings, battery')
      .in('device_id', chunk)
    for (const p of (data ?? []) as SensorPropsRow[]) map[p.device_id] = p
  }
  return map
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return jsonResponse({ ok: false, error: 'method-not-allowed' }, 405)
  }
  const now = new Date()

  // 1) センサー全件取得（H1: 1000 台超 truncation 回避のためページング）
  let devices: DeviceRow[]
  try {
    devices = await fetchAllSensorDevices()
  } catch (e) {
    return jsonResponse(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      500,
    )
  }

  // 2) sensor_props を device_id チャンクで取得
  const sensorIds = devices.map((d) => d.id)
  const propsById = await fetchPropsByIds(sensorIds)

  // 3) バッチ並列で評価（H1: 直列 N+1 を解消）
  const summary = {
    sensors: devices.length,
    offlineFired: 0,
    recoveryFired: 0,
    batteryReAlertFired: 0,
    errors: [] as Array<{ id: string; error: string }>,
  }
  const BATCH = 20
  for (let i = 0; i < devices.length; i += BATCH) {
    const batch = devices.slice(i, i + BATCH)
    const results = await Promise.allSettled(
      batch.map((d) =>
        processSensor(
          d,
          propsById[d.id] ?? {
            device_id: d.id,
            alert_settings: {},
            battery: null,
          },
          now,
        ),
      ),
    )
    results.forEach((res, idx) => {
      if (res.status === 'fulfilled') {
        summary.offlineFired += res.value.offlineFired
        summary.recoveryFired += res.value.recoveryFired
        summary.batteryReAlertFired += res.value.batteryReAlertFired
      } else {
        const d = batch[idx]
        const msg =
          res.reason instanceof Error
            ? res.reason.message
            : String(res.reason)
        console.error('[detect-status] sensor failed', d.id, res.reason)
        summary.errors.push({ id: d.id, error: msg })
      }
    })
  }

  return jsonResponse({ ok: true, now: now.toISOString(), summary })
})
