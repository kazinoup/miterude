/**
 * Supabase 読み取りクエリ — Phase G (Block A/B)
 *
 * 現段階では「読み取り専用 + デモ組織固定」。書き込みはまだ localStorage 経由。
 * 将来的にここを統一の Data Access Layer にしていく。
 */
import { supabase, getActiveOrgId } from './supabase'
import type {
  AlertLogEntry,
  AlertLogStore,
  AlertSettings,
  CategoryIconKey,
  Gateway,
  GatewayAlertSettings,
  GatewayRole,
  GatewayStore,
  CheckinSensorComment,
  Dashboard,
  DashboardCheckin,
  DashboardCheckinStatus,
  DashboardCheckinStore,
  DashboardDefaultPeriod,
  DashboardStore,
  DeviceStore,
  ManualCategory,
  ManualPage,
  NotificationChannel,
  NotificationGroup,
  NotificationGroupStore,
  NotificationTiming,
  RecordApproval,
  Sensor,
  SensorCategory,
  SensorCategoryStore,
  SensorGroup,
  SensorGroupStore,
  SensorNote,
  SensorNoteCategory,
  SensorNoteStore,
  SensorReading,
  SensorRole,
  SensorStore,
  SensorThresholds,
  Widget,
} from '../types'

/** Supabase の devices テーブルから返ってくる素の形 */
export type SupabaseDeviceRow = {
  id: string
  device_type: 'sensor' | 'gateway'
  role: string
  manufacturer: string
  model: string
  external_key: string
  serial_number: string
  dev_eui: string | null
  name: string | null
  device_number: string
  category_id: string | null
  group_id: string | null
  tags: string[] | null
  notification_group_id: string | null
  online: boolean
  last_seen_at: string | null
  registered_at: string
  sensor_props:
    | {
        battery: number | null
        gateway_id: string | null
        thresholds: SensorThresholds | null
        alert_settings: AlertSettings | null
        exclusion_windows: unknown
        exclusion_dates: unknown
        updated_at: string | null
      }
    | null
}

/** devices + sensor_props を JOIN して、デモ組織のセンサー一覧を取得する。 */
export async function fetchSensorDevices(): Promise<SupabaseDeviceRow[]> {
  const { data, error } = await supabase
    .from('devices')
    .select(
      `
      id, device_type, role, manufacturer, model, external_key,
      serial_number, dev_eui, name, device_number,
      category_id, group_id, tags, notification_group_id,
      online, last_seen_at, registered_at,
      sensor_props!sensor_props_device_id_fkey (
        battery, gateway_id, thresholds, alert_settings,
        exclusion_windows, exclusion_dates, updated_at
      )
    `,
    )
    .eq('organization_id', getActiveOrgId())
    .eq('device_type', 'sensor')
    .order('device_number', { ascending: true })

  if (error) throw error
  // PostgREST は埋め込みリレーションを常に配列で型推論するため、unknown 経由でキャスト。
  // 実体は sensor_props!sensor_props_device_id_fkey の 1:1 で単一オブジェクト。
  return (data ?? []) as unknown as SupabaseDeviceRow[]
}

/** sensor_id ごとの「最新計測値」をまとめて取得する。
 *  Supabase は LATERAL JOIN を直接書けないので、ここでは sensor_ids 単位で
 *  最新行を取りに行く（件数が増えたらマテビュー化を検討）。 */
export type LatestReading = {
  sensor_id: string
  measured_at: string
  temperature: number | null
  humidity: number | null
}

export async function fetchLatestReadings(
  sensorIds: string[],
): Promise<Map<string, LatestReading>> {
  if (sensorIds.length === 0) return new Map()
  const { data, error } = await supabase
    .from('sensor_readings')
    .select('sensor_id, measured_at, temperature, humidity')
    .eq('organization_id', getActiveOrgId())
    .in('sensor_id', sensorIds)
    .order('measured_at', { ascending: false })
    .limit(sensorIds.length * 10)

  if (error) throw error
  const map = new Map<string, LatestReading>()
  for (const row of data ?? []) {
    if (!map.has(row.sensor_id)) {
      map.set(row.sensor_id, row as LatestReading)
    }
  }
  return map
}

/* ============================================================
   アプリ型（SensorStore / SensorCategoryStore / SensorGroupStore）への変換
   ------------------------------------------------------------
   既存の UI コードはこれらの型を期待するので、Supabase から取ってきた
   行をそのまま app の React state に流し込めるようにする。
   ============================================================ */

/** Supabase 側の devices.role 文字列を SensorRole（厳格 union）として解釈する。
 *  未知の値は 'other' に倒す。 */
function asSensorRole(role: string): SensorRole {
  switch (role) {
    case 'temperature-humidity':
    case 'temperature':
    case 'current':
    case 'co2':
    case 'pressure':
    case 'door':
      return role
    default:
      return 'other'
  }
}

/** DB 既定の AlertSettings（schema の jsonb default と同じ内容）。 */
const DEFAULT_SENSOR_ALERT_SETTINGS: AlertSettings = {
  offlineEnabled: true,
  offlineThresholdMinutes: 60,
  deviationEnabled: true,
  deviationConsecutiveCount: 3,
  notifyChannels: { email: true, slack: false, push: false },
  batteryEnabled: false,
  batteryThresholdPercent: 10,
}

/** Supabase の 1 行を Sensor（JOIN ビュー型）に変換する。 */
export function rowToSensor(row: SupabaseDeviceRow): Sensor {
  const props = row.sensor_props
  const alertSettings = props?.alert_settings ?? DEFAULT_SENSOR_ALERT_SETTINGS
  // exclusionWindows / exclusionDates は AlertSettings の中に畳み込まれる設計。
  const exclusionWindows = props?.exclusion_windows
  const exclusionDates = props?.exclusion_dates
  const role = asSensorRole(row.role)

  return {
    id: row.id,
    deviceType: 'sensor',
    role,
    // kind は SensorKind（'analog-meter'/'water-level' 含む）と
    // SensorRole（'temperature'/'co2'/'pressure'/'other' 含む）が部分的に異なる union。
    // 共通ラベルのときだけ kind に振る。
    kind:
      role === 'temperature-humidity' || role === 'door' || role === 'current'
        ? role
        : undefined,
    manufacturer: row.manufacturer,
    model: row.model,
    externalKey: row.external_key,
    serialNumber: row.serial_number,
    devEUI: row.dev_eui ?? undefined,
    name: row.name ?? undefined,
    deviceNumber: row.device_number,
    categoryId: row.category_id,
    groupId: row.group_id,
    tags: row.tags ?? [],
    notificationGroupId: row.notification_group_id,
    online: row.online,
    lastSeenAt: row.last_seen_at ? new Date(row.last_seen_at) : undefined,
    registeredAt: new Date(row.registered_at),
    /* ----- SensorProps ----- */
    thresholds: props?.thresholds ?? undefined,
    battery: props?.battery ?? 100,
    gatewayId: props?.gateway_id ?? '',
    alertSettings: {
      ...alertSettings,
      exclusionWindows:
        Array.isArray(exclusionWindows)
          ? (exclusionWindows as AlertSettings['exclusionWindows'])
          : undefined,
      exclusionDates:
        Array.isArray(exclusionDates)
          ? (exclusionDates as AlertSettings['exclusionDates'])
          : undefined,
    },
  }
}

/** デモ組織の Sensor 一覧を SensorStore（id でキー引きできる Record）として返す。 */
export async function fetchSensorsAsStore(): Promise<SensorStore> {
  const rows = await fetchSensorDevices()
  const store: SensorStore = {}
  for (const row of rows) store[row.id] = rowToSensor(row)
  return store
}

/* ---------- カテゴリ ---------- */

type SupabaseCategoryRow = {
  id: string
  name: string
  icon: string | null
  description: string | null
  created_at: string
  updated_at: string
}

function asCategoryIcon(icon: string | null): CategoryIconKey {
  const valid: CategoryIconKey[] = [
    'snowflake', 'refrigerator', 'home', 'flame', 'thermometer',
    'droplets', 'zap', 'door-open', 'package', 'wheat', 'wind',
    'gauge', 'box', 'tag', 'activity', 'star',
  ]
  if (icon && (valid as string[]).includes(icon)) return icon as CategoryIconKey
  return 'tag'
}

export async function fetchCategoriesAsStore(): Promise<SensorCategoryStore> {
  const { data, error } = await supabase
    .from('sensor_categories')
    .select('id, name, icon, description, created_at, updated_at')
    .eq('organization_id', getActiveOrgId())
    .order('display_order', { ascending: true })
  if (error) throw error
  const store: SensorCategoryStore = {}
  for (const r of (data ?? []) as SupabaseCategoryRow[]) {
    const cat: SensorCategory = {
      id: r.id,
      name: r.name,
      icon: asCategoryIcon(r.icon),
      description: r.description ?? undefined,
      createdAt: new Date(r.created_at),
      updatedAt: new Date(r.updated_at),
    }
    store[r.id] = cat
  }
  return store
}

/* ---------- グループ ---------- */

type SupabaseGroupRow = {
  id: string
  name: string
  description: string | null
  color: string | null
  created_at: string
  updated_at: string
}

/* ---------- 時系列読み取り ---------- */

type SupabaseReadingRow = {
  sensor_id: string
  measured_at: string
  temperature: number | null
  humidity: number | null
  battery: number | null
}

/** 過去 N 日間の sensor_readings を取得して、DeviceStore（センサーごとの配列）に変換する。
 *  DashboardView のタイル / 折れ線チャートが直接これを読む。 */
export async function fetchReadingsAsDeviceStore(opts: {
  sinceDays?: number
  limit?: number
} = {}): Promise<DeviceStore> {
  const sinceDays = opts.sinceDays ?? 30
  const limit = opts.limit ?? 20000
  const sinceIso = new Date(Date.now() - sinceDays * 86_400_000).toISOString()

  const { data, error } = await supabase
    .from('sensor_readings')
    .select('sensor_id, measured_at, temperature, humidity, battery')
    .eq('organization_id', getActiveOrgId())
    .gte('measured_at', sinceIso)
    .order('measured_at', { ascending: true })
    .limit(limit)

  if (error) throw error

  const store: DeviceStore = {}
  for (const r of (data ?? []) as SupabaseReadingRow[]) {
    if (r.temperature == null && r.humidity == null) continue
    const reading: SensorReading = {
      deviceId: r.sensor_id,
      measuredAt: new Date(r.measured_at),
      temperature: r.temperature ?? NaN,
      humidity: r.humidity ?? NaN,
      battery: r.battery ?? undefined,
    }
    if (!store[r.sensor_id]) store[r.sensor_id] = []
    store[r.sensor_id].push(reading)
  }
  return store
}

/** CSV エクスポート用に、指定 sensor × 期間の sensor_readings を全件取得する。
 *  Supabase の 1 リクエスト上限（1000 行）を超える期間でも安全に取りきれるよう、
 *  1000 件ずつページングして連結して返す。 */
export async function fetchReadingsForCsvExport(opts: {
  sensorId: string
  fromIso: string
  /** 排他的（< toIso）。呼び出し側で「終了日 + 1日 00:00」を渡す前提。 */
  toIso: string
}): Promise<SensorReading[]> {
  const PAGE = 1000
  const all: SensorReading[] = []
  let offset = 0
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await supabase
      .from('sensor_readings')
      .select('sensor_id, measured_at, temperature, humidity, battery')
      .eq('sensor_id', opts.sensorId)
      .gte('measured_at', opts.fromIso)
      .lt('measured_at', opts.toIso)
      .order('measured_at', { ascending: true })
      .range(offset, offset + PAGE - 1)
    if (error) throw error
    const rows = (data ?? []) as SupabaseReadingRow[]
    for (const r of rows) {
      if (r.temperature == null && r.humidity == null) continue
      all.push({
        deviceId: r.sensor_id,
        measuredAt: new Date(r.measured_at),
        temperature: r.temperature ?? NaN,
        humidity: r.humidity ?? NaN,
        battery: r.battery ?? undefined,
      })
    }
    if (rows.length < PAGE) break
    offset += PAGE
  }
  return all
}

/* ============================================================
   書き込み（UPDATE のみ。CREATE/DELETE は別フェーズ）
   ============================================================ */

/** updateSensorInSupabase に渡す差分。Sensor 型のサブセット。 */
export type SensorUpdatePatch = Partial<{
  // ----- devices -----
  name: string | null
  deviceNumber: string
  serialNumber: string
  model: string
  manufacturer: string
  categoryId: string | null
  groupId: string | null
  tags: string[]
  notificationGroupId: string | null
  // ----- sensor_props -----
  thresholds: SensorThresholds | undefined
  gatewayId: string
  alertSettings: AlertSettings
}>

/** 1 センサーの差分を Supabase に反映する。
 *  devices と sensor_props のどちらに属するかを判別して、対応する UPDATE を投げる。
 *  alertSettings の中の exclusionWindows / exclusionDates は sensor_props 側で
 *  別カラムなので、ここで取り出して 3 カラムに分けて書く。 */
export async function updateSensorInSupabase(
  sensorId: string,
  patch: SensorUpdatePatch,
): Promise<void> {
  // devices 側
  const devicePatch: Record<string, unknown> = {}
  if ('name' in patch) devicePatch.name = patch.name ?? null
  if ('deviceNumber' in patch) devicePatch.device_number = patch.deviceNumber
  if ('serialNumber' in patch) devicePatch.serial_number = patch.serialNumber
  if ('model' in patch) devicePatch.model = patch.model
  if ('manufacturer' in patch) devicePatch.manufacturer = patch.manufacturer
  if ('categoryId' in patch) devicePatch.category_id = patch.categoryId ?? null
  if ('groupId' in patch) devicePatch.group_id = patch.groupId ?? null
  if ('tags' in patch) devicePatch.tags = patch.tags ?? []
  if ('notificationGroupId' in patch) {
    devicePatch.notification_group_id = patch.notificationGroupId ?? null
  }

  // sensor_props 側
  const propsPatch: Record<string, unknown> = {}
  if ('thresholds' in patch) propsPatch.thresholds = patch.thresholds ?? null
  if ('gatewayId' in patch) propsPatch.gateway_id = patch.gatewayId || null
  if ('alertSettings' in patch && patch.alertSettings) {
    const { exclusionWindows, exclusionDates, ...rest } = patch.alertSettings
    propsPatch.alert_settings = rest
    propsPatch.exclusion_windows = exclusionWindows ?? []
    propsPatch.exclusion_dates = exclusionDates ?? []
  }

  // PostgrestFilterBuilder は thenable だが TS の型では Promise ではないため、
  // async IIFE で包んで Promise<void> として並列実行する。
  const tasks: Promise<void>[] = []
  if (Object.keys(devicePatch).length > 0) {
    devicePatch.updated_at = new Date().toISOString()
    tasks.push(
      (async () => {
        await supabase
          .from('devices')
          .update(devicePatch)
          .eq('id', sensorId)
          .eq('organization_id', getActiveOrgId())
          .throwOnError()
      })(),
    )
  }
  if (Object.keys(propsPatch).length > 0) {
    propsPatch.updated_at = new Date().toISOString()
    tasks.push(
      (async () => {
        await supabase
          .from('sensor_props')
          .update(propsPatch)
          .eq('device_id', sensorId)
          .throwOnError()
      })(),
    )
  }
  await Promise.all(tasks)
}

/* ---------- 設定 3 ストアの upsert / delete ---------- */

/** カテゴリ 1 件を upsert（INSERT または UPDATE）する。 */
export async function upsertCategoryInSupabase(c: SensorCategory): Promise<void> {
  await supabase
    .from('sensor_categories')
    .upsert({
      id: c.id,
      organization_id: getActiveOrgId(),
      name: c.name,
      icon: c.icon,
      description: c.description ?? null,
      updated_at: new Date().toISOString(),
    })
    .throwOnError()
}

export async function deleteCategoryFromSupabase(id: string): Promise<void> {
  await supabase
    .from('sensor_categories')
    .delete()
    .eq('id', id)
    .eq('organization_id', getActiveOrgId())
    .throwOnError()
}

/** グループ 1 件を upsert。 */
export async function upsertGroupInSupabase(g: SensorGroup): Promise<void> {
  await supabase
    .from('sensor_groups')
    .upsert({
      id: g.id,
      organization_id: getActiveOrgId(),
      name: g.name,
      description: g.description ?? null,
      color: g.color ?? null,
      updated_at: new Date().toISOString(),
    })
    .throwOnError()
}

export async function deleteGroupFromSupabase(id: string): Promise<void> {
  await supabase
    .from('sensor_groups')
    .delete()
    .eq('id', id)
    .eq('organization_id', getActiveOrgId())
    .throwOnError()
}

/** 通知グループ 1 件を upsert。 */
export async function upsertNotificationGroupInSupabase(
  g: NotificationGroup,
): Promise<void> {
  await supabase
    .from('notification_groups')
    .upsert({
      id: g.id,
      organization_id: getActiveOrgId(),
      name: g.name,
      description: g.description ?? null,
      timing: g.timing,
      channels: g.channels ?? [],
      updated_at: new Date().toISOString(),
    })
    .throwOnError()
}

export async function deleteNotificationGroupFromSupabase(id: string): Promise<void> {
  await supabase
    .from('notification_groups')
    .delete()
    .eq('id', id)
    .eq('organization_id', getActiveOrgId())
    .throwOnError()
}

/* ---------- ダッシュボード ---------- */

type SupabaseDashboardRow = {
  id: string
  name: string
  description: string | null
  target_sensor_ids: string[] | null
  default_period: DashboardDefaultPeriod | null
  widgets: Widget[] | null
  public_share_token: string | null
  public_share_issued_at: string | null
  created_at: string
  updated_at: string
}

export async function fetchDashboardsAsStore(): Promise<DashboardStore> {
  const { data, error } = await supabase
    .from('dashboards')
    .select(
      'id, name, description, target_sensor_ids, default_period, widgets, ' +
        'public_share_token, public_share_issued_at, created_at, updated_at',
    )
    .eq('organization_id', getActiveOrgId())
    .order('display_order', { ascending: true })
  if (error) throw error
  const store: DashboardStore = {}
  for (const r of (data ?? []) as unknown as SupabaseDashboardRow[]) {
    const d: Dashboard = {
      id: r.id,
      name: r.name,
      description: r.description ?? undefined,
      widgets: r.widgets ?? [],
      targetSensorIds: r.target_sensor_ids ?? [],
      defaultPeriod: r.default_period ?? { type: 'week' },
      publicShareToken: r.public_share_token ?? undefined,
      publicShareIssuedAt: r.public_share_issued_at
        ? new Date(r.public_share_issued_at)
        : undefined,
      createdAt: new Date(r.created_at),
      updatedAt: new Date(r.updated_at),
    }
    store[r.id] = d
  }
  return store
}

function asIsoString(v: Date | string | undefined | null): string | null {
  if (!v) return null
  if (v instanceof Date) return v.toISOString()
  if (typeof v === 'string') {
    const d = new Date(v)
    return Number.isNaN(d.getTime()) ? null : d.toISOString()
  }
  return null
}

export async function upsertDashboardInSupabase(d: Dashboard): Promise<void> {
  await supabase
    .from('dashboards')
    .upsert({
      id: d.id,
      organization_id: getActiveOrgId(),
      name: d.name,
      description: d.description ?? null,
      target_sensor_ids: d.targetSensorIds ?? [],
      default_period: d.defaultPeriod,
      widgets: d.widgets ?? [],
      public_share_token: d.publicShareToken ?? null,
      public_share_issued_at: asIsoString(d.publicShareIssuedAt),
      updated_at: new Date().toISOString(),
    })
    .throwOnError()
}

export async function deleteDashboardFromSupabase(id: string): Promise<void> {
  await supabase
    .from('dashboards')
    .delete()
    .eq('id', id)
    .eq('organization_id', getActiveOrgId())
    .throwOnError()
}

/* ---------- 運営側 4 テーブル（Admin Console 用） ----------
 * users / organization_members / staff_assignments / staff_audit_logs */

import type {
  AppUser,
  OrganizationMember,
  StaffAssignment,
  StaffAuditLog,
  StaffCategory,
  SystemRole,
  TenantRole,
} from '../types'

type SupabaseUserRow = {
  id: string
  clerk_user_id: string | null
  email: string
  display_name: string
  system_role: SystemRole | null
  staff_category: StaffCategory | null
  created_at: string
}

export async function fetchUsersList(): Promise<AppUser[]> {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .order('created_at', { ascending: true })
  if (error) throw error
  return ((data ?? []) as SupabaseUserRow[]).map((r) => ({
    id: r.id,
    clerkUserId: r.clerk_user_id ?? undefined,
    email: r.email,
    displayName: r.display_name,
    systemRole: r.system_role ?? undefined,
    staffCategory: r.staff_category ?? undefined,
    createdAt: new Date(r.created_at),
  }))
}

export async function upsertUserInSupabase(u: AppUser): Promise<void> {
  await supabase
    .from('users')
    .upsert({
      id: u.id,
      clerk_user_id: u.clerkUserId ?? null,
      email: u.email,
      display_name: u.displayName,
      system_role: u.systemRole ?? null,
      staff_category: u.staffCategory ?? null,
      updated_at: new Date().toISOString(),
    })
    .throwOnError()
}

export async function deleteUserFromSupabase(id: string): Promise<void> {
  await supabase.from('users').delete().eq('id', id).throwOnError()
}

/* ---- organization_members ---- */

type SupabaseMemberRow = {
  id: string
  organization_id: string
  user_id: string
  role: TenantRole
  invited_at: string
  first_login_at: string | null
  last_login_at: string | null
}

export async function fetchMembersList(): Promise<OrganizationMember[]> {
  const { data, error } = await supabase
    .from('organization_members')
    .select('*')
    .order('invited_at', { ascending: false })
  if (error) throw error
  return ((data ?? []) as SupabaseMemberRow[]).map((r) => ({
    id: r.id,
    organizationId: r.organization_id,
    userId: r.user_id,
    role: r.role,
    invitedAt: new Date(r.invited_at),
    firstLoginAt: r.first_login_at ? new Date(r.first_login_at) : undefined,
    lastLoginAt: r.last_login_at ? new Date(r.last_login_at) : undefined,
  }))
}

export async function upsertMemberInSupabase(m: OrganizationMember): Promise<void> {
  await supabase
    .from('organization_members')
    .upsert({
      id: m.id,
      organization_id: m.organizationId,
      user_id: m.userId,
      role: m.role,
      invited_at: asIsoString(m.invitedAt),
      first_login_at: asIsoString(m.firstLoginAt),
      last_login_at: asIsoString(m.lastLoginAt),
      updated_at: new Date().toISOString(),
    })
    .throwOnError()
}

export async function deleteMemberFromSupabase(id: string): Promise<void> {
  await supabase
    .from('organization_members')
    .delete()
    .eq('id', id)
    .throwOnError()
}

/* ---- staff_assignments ---- */

type SupabaseAssignmentRow = {
  id: string
  staff_user_id: string
  organization_id: string
  granted_by_user_id: string | null
  granted_at: string
  expires_at: string | null
  revoked_at: string | null
  notes: string | null
}

export async function fetchStaffAssignmentsList(): Promise<StaffAssignment[]> {
  const { data, error } = await supabase
    .from('staff_assignments')
    .select('*')
    .order('granted_at', { ascending: false })
  if (error) throw error
  return ((data ?? []) as SupabaseAssignmentRow[]).map((r) => ({
    id: r.id,
    staffUserId: r.staff_user_id,
    organizationId: r.organization_id,
    grantedByUserId: r.granted_by_user_id ?? '',
    grantedAt: new Date(r.granted_at),
    expiresAt: r.expires_at ? new Date(r.expires_at) : undefined,
    revokedAt: r.revoked_at ? new Date(r.revoked_at) : undefined,
    notes: r.notes ?? undefined,
  }))
}

export async function upsertStaffAssignmentInSupabase(a: StaffAssignment): Promise<void> {
  await supabase
    .from('staff_assignments')
    .upsert({
      id: a.id,
      staff_user_id: a.staffUserId,
      organization_id: a.organizationId,
      granted_by_user_id: a.grantedByUserId || null,
      granted_at: asIsoString(a.grantedAt),
      expires_at: asIsoString(a.expiresAt),
      revoked_at: asIsoString(a.revokedAt),
      notes: a.notes ?? null,
    })
    .throwOnError()
}

export async function deleteStaffAssignmentFromSupabase(id: string): Promise<void> {
  await supabase
    .from('staff_assignments')
    .delete()
    .eq('id', id)
    .throwOnError()
}

/* ---- staff_audit_logs ---- */

type SupabaseAuditRow = {
  id: string
  staff_user_id: string | null
  organization_id: string | null
  action: string
  target_table: string | null
  target_id: string | null
  metadata: Record<string, unknown> | null
  occurred_at: string
}

export async function fetchAuditLogsList(opts: { limit?: number } = {}): Promise<StaffAuditLog[]> {
  const { data, error } = await supabase
    .from('staff_audit_logs')
    .select('*')
    .order('occurred_at', { ascending: false })
    .limit(opts.limit ?? 500)
  if (error) throw error
  return ((data ?? []) as SupabaseAuditRow[]).map((r) => ({
    id: r.id,
    staffUserId: r.staff_user_id ?? '',
    organizationId: r.organization_id ?? undefined,
    action: r.action,
    targetTable: r.target_table ?? undefined,
    targetId: r.target_id ?? undefined,
    metadata: r.metadata ?? undefined,
    occurredAt: new Date(r.occurred_at),
  }))
}

export async function appendAuditLogInSupabase(l: StaffAuditLog): Promise<void> {
  await supabase
    .from('staff_audit_logs')
    .insert({
      id: l.id,
      staff_user_id: l.staffUserId || null,
      organization_id: l.organizationId ?? null,
      action: l.action,
      target_table: l.targetTable ?? null,
      target_id: l.targetId ?? null,
      metadata: l.metadata ?? {},
      occurred_at: asIsoString(l.occurredAt),
    })
    .throwOnError()
}

/* ---------- 組織（Admin Console 用） ----------
 * テナント（Organization）の CRUD。admin 側でしか使わない想定。 */

type SupabaseOrganizationRow = {
  id: string
  name: string
  slug: string
  plan: string | null
  created_at: string
  // 拡張カラム
  billing_cycle?: string | null
  contract_started_at?: string | null
  contract_expires_at?: string | null
  payment_method?: string | null
  billing_email?: string | null
  auto_invoice?: boolean | null
  contract_type?: string | null
  tsukurude_ai_enabled?: boolean | null
  // 論理削除
  deactivated_at?: string | null
  deactivated_by_user_id?: string | null
  deactivation_reason?: string | null
  physical_delete_after?: string | null
}

import type { BillingCycle, ContractType, Organization, PaymentMethod } from '../types'

function asBillingCycle(v: string | null | undefined): BillingCycle | undefined {
  if (v === 'monthly' || v === 'annual') return v
  return undefined
}
function asPaymentMethod(v: string | null | undefined): PaymentMethod | undefined {
  if (v === 'bank_transfer' || v === 'credit_card') return v
  return undefined
}
function asContractType(v: string | null | undefined): ContractType | undefined {
  if (v === 'demo' || v === 'subscription' || v === 'purchase' || v === 'typeless') return v
  return undefined
}

export async function fetchOrganizationsList(): Promise<Organization[]> {
  const { data, error } = await supabase
    .from('organizations')
    .select('*')
    .order('created_at', { ascending: true })
  if (error) throw error
  return ((data ?? []) as SupabaseOrganizationRow[]).map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    plan: (r.plan ?? undefined) as Organization['plan'],
    createdAt: new Date(r.created_at),
    billingCycle: asBillingCycle(r.billing_cycle),
    contractStartedAt: r.contract_started_at
      ? new Date(r.contract_started_at)
      : undefined,
    contractExpiresAt: r.contract_expires_at
      ? new Date(r.contract_expires_at)
      : undefined,
    paymentMethod: asPaymentMethod(r.payment_method),
    billingEmail: r.billing_email ?? undefined,
    autoInvoice: r.auto_invoice ?? undefined,
    contractType: asContractType(r.contract_type),
    tsukurudeAiEnabled: r.tsukurude_ai_enabled ?? undefined,
    deactivatedAt: r.deactivated_at ? new Date(r.deactivated_at) : undefined,
    deactivatedByUserId: r.deactivated_by_user_id ?? undefined,
    deactivationReason: r.deactivation_reason ?? undefined,
    physicalDeleteAfter: r.physical_delete_after
      ? new Date(r.physical_delete_after)
      : undefined,
  }))
}

/** テナントを「無効化（論理削除）」する。
 *  - deactivated_at = now()
 *  - physical_delete_after = now() + gracePeriodDays（既定 180 日）
 *  - 配下データ（センサー / readings 等）は触らない */
export async function deactivateOrganizationInSupabase(opts: {
  id: string
  byUserId: string
  reason?: string
  gracePeriodDays?: number
}): Promise<void> {
  const days = opts.gracePeriodDays ?? 180
  const now = new Date()
  const physicalDeleteAfter = new Date(now)
  physicalDeleteAfter.setDate(physicalDeleteAfter.getDate() + days)
  await supabase
    .from('organizations')
    .update({
      deactivated_at: now.toISOString(),
      deactivated_by_user_id: opts.byUserId || null,
      deactivation_reason: opts.reason ?? null,
      physical_delete_after: physicalDeleteAfter.toISOString(),
      updated_at: now.toISOString(),
    })
    .eq('id', opts.id)
    .throwOnError()
}

/** 無効化されたテナントを復活させる。 */
export async function reactivateOrganizationInSupabase(id: string): Promise<void> {
  await supabase
    .from('organizations')
    .update({
      deactivated_at: null,
      deactivated_by_user_id: null,
      deactivation_reason: null,
      physical_delete_after: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .throwOnError()
}

export async function upsertOrganizationInSupabase(o: Organization): Promise<void> {
  await supabase
    .from('organizations')
    .upsert({
      id: o.id,
      name: o.name,
      slug: o.slug,
      plan: o.plan ?? null,
      billing_cycle: o.billingCycle ?? null,
      contract_started_at: asIsoString(o.contractStartedAt),
      contract_expires_at: asIsoString(o.contractExpiresAt),
      payment_method: o.paymentMethod ?? null,
      billing_email: o.billingEmail ?? null,
      auto_invoice: o.autoInvoice ?? null,
      contract_type: o.contractType ?? null,
      tsukurude_ai_enabled: o.tsukurudeAiEnabled ?? null,
      updated_at: new Date().toISOString(),
    })
    .throwOnError()
}

export async function deleteOrganizationFromSupabase(id: string): Promise<void> {
  // FK on delete cascade で配下テーブルも連鎖削除される（devices / sensor_categories / 等）。
  await supabase
    .from('organizations')
    .delete()
    .eq('id', id)
    .throwOnError()
}

/** 新規テナント作成時のデフォルト区分を seed する（Migration 0011 と同等の内容）。 */
export async function seedDefaultCategoriesForOrg(
  organizationId: string,
): Promise<void> {
  const now = new Date().toISOString()
  const rows = [
    {
      id: crypto.randomUUID(),
      organization_id: organizationId,
      name: '冷凍',
      icon: 'snowflake',
      description: '冷凍庫・フリーザー（標準セット）',
      display_order: 1,
      created_at: now,
      updated_at: now,
    },
    {
      id: crypto.randomUUID(),
      organization_id: organizationId,
      name: '冷蔵',
      icon: 'refrigerator',
      description: '冷蔵庫・チルド（標準セット）',
      display_order: 2,
      created_at: now,
      updated_at: now,
    },
    {
      id: crypto.randomUUID(),
      organization_id: organizationId,
      name: '室温',
      icon: 'home',
      description: '室温・常温保管（標準セット）',
      display_order: 3,
      created_at: now,
      updated_at: now,
    },
  ]
  await supabase
    .from('sensor_categories')
    .upsert(rows, { onConflict: 'organization_id,name', ignoreDuplicates: true })
    .throwOnError()
}

/** 新規テナント作成時の Milesight integration プレースホルダ。
 *  詳細画面で secret / uuid を入力するまでは未連携状態。 */
export async function seedMilesightIntegrationForOrg(
  organizationId: string,
): Promise<void> {
  await supabase
    .from('manufacturer_integrations')
    .upsert({
      organization_id: organizationId,
      manufacturer: 'Milesight',
      enabled: false,
      sensor_kinds: ['temperature-humidity'],
      updated_at: new Date().toISOString(),
    }, { onConflict: 'organization_id,manufacturer', ignoreDuplicates: true })
    .throwOnError()
}

/* ---------- ゲートウェイ ---------- */

type SupabaseGatewayDeviceRow = {
  id: string
  device_type: 'sensor' | 'gateway'
  role: string
  manufacturer: string
  model: string
  external_key: string
  serial_number: string
  dev_eui: string | null
  name: string | null
  device_number: string
  category_id: string | null
  group_id: string | null
  tags: string[] | null
  notification_group_id: string | null
  online: boolean
  last_seen_at: string | null
  registered_at: string
  gateway_props:
    | {
        alert_settings: GatewayAlertSettings | null
        exclusion_windows: unknown
        exclusion_dates: unknown
        updated_at: string | null
      }
    | null
}

function asGatewayRole(role: string): GatewayRole {
  return role === 'relay' ? 'relay' : 'master'
}

const DEFAULT_GATEWAY_ALERT_SETTINGS: GatewayAlertSettings = {
  offlineEnabled: true,
  offlineThresholdMinutes: 60,
  notifyChannels: { email: true, slack: false, push: false },
}

export async function fetchGatewaysAsStore(): Promise<GatewayStore> {
  const { data, error } = await supabase
    .from('devices')
    .select(
      `
      id, device_type, role, manufacturer, model, external_key,
      serial_number, dev_eui, name, device_number,
      category_id, group_id, tags, notification_group_id,
      online, last_seen_at, registered_at,
      gateway_props ( alert_settings, exclusion_windows, exclusion_dates, updated_at )
    `,
    )
    .eq('organization_id', getActiveOrgId())
    .eq('device_type', 'gateway')
    .order('device_number', { ascending: true })
  if (error) throw error

  const store: GatewayStore = {}
  for (const r of (data ?? []) as unknown as SupabaseGatewayDeviceRow[]) {
    const props = r.gateway_props
    const alertSettings = props?.alert_settings ?? DEFAULT_GATEWAY_ALERT_SETTINGS
    const exclusionWindows = props?.exclusion_windows
    const exclusionDates = props?.exclusion_dates
    const gw: Gateway = {
      id: r.id,
      deviceType: 'gateway',
      role: asGatewayRole(r.role),
      manufacturer: r.manufacturer,
      model: r.model,
      externalKey: r.external_key,
      serialNumber: r.serial_number,
      devEUI: r.dev_eui ?? undefined,
      name: r.name ?? undefined,
      deviceNumber: r.device_number,
      categoryId: r.category_id,
      groupId: r.group_id,
      tags: r.tags ?? [],
      notificationGroupId: r.notification_group_id,
      online: r.online,
      lastSeenAt: r.last_seen_at ? new Date(r.last_seen_at) : undefined,
      registeredAt: new Date(r.registered_at),
      alertSettings: {
        ...alertSettings,
        exclusionWindows: Array.isArray(exclusionWindows)
          ? (exclusionWindows as GatewayAlertSettings['exclusionWindows'])
          : undefined,
        exclusionDates: Array.isArray(exclusionDates)
          ? (exclusionDates as GatewayAlertSettings['exclusionDates'])
          : undefined,
      },
    }
    store[r.id] = gw
  }
  return store
}

/** ゲートウェイ編集（基本情報 + alertSettings）を Supabase に反映。
 *  CREATE は Webhook 経由、DELETE は専用関数を使う。 */
export type GatewayUpdatePatch = Partial<{
  name: string | null
  deviceNumber: string
  serialNumber: string
  model: string
  manufacturer: string
  categoryId: string | null
  groupId: string | null
  tags: string[]
  notificationGroupId: string | null
  alertSettings: GatewayAlertSettings
}>

export async function updateGatewayInSupabase(
  gatewayId: string,
  patch: GatewayUpdatePatch,
): Promise<void> {
  const devicePatch: Record<string, unknown> = {}
  if ('name' in patch) devicePatch.name = patch.name ?? null
  if ('deviceNumber' in patch) devicePatch.device_number = patch.deviceNumber
  if ('serialNumber' in patch) devicePatch.serial_number = patch.serialNumber
  if ('model' in patch) devicePatch.model = patch.model
  if ('manufacturer' in patch) devicePatch.manufacturer = patch.manufacturer
  if ('categoryId' in patch) devicePatch.category_id = patch.categoryId ?? null
  if ('groupId' in patch) devicePatch.group_id = patch.groupId ?? null
  if ('tags' in patch) devicePatch.tags = patch.tags ?? []
  if ('notificationGroupId' in patch) {
    devicePatch.notification_group_id = patch.notificationGroupId ?? null
  }

  const propsPatch: Record<string, unknown> = {}
  if ('alertSettings' in patch && patch.alertSettings) {
    const { exclusionWindows, exclusionDates, ...rest } = patch.alertSettings
    propsPatch.alert_settings = rest
    propsPatch.exclusion_windows = exclusionWindows ?? []
    propsPatch.exclusion_dates = exclusionDates ?? []
  }

  const tasks: Promise<void>[] = []
  if (Object.keys(devicePatch).length > 0) {
    devicePatch.updated_at = new Date().toISOString()
    tasks.push(
      (async () => {
        await supabase
          .from('devices')
          .update(devicePatch)
          .eq('id', gatewayId)
          .eq('organization_id', getActiveOrgId())
          .throwOnError()
      })(),
    )
  }
  if (Object.keys(propsPatch).length > 0) {
    propsPatch.updated_at = new Date().toISOString()
    tasks.push(
      (async () => {
        await supabase
          .from('gateway_props')
          .update(propsPatch)
          .eq('device_id', gatewayId)
          .throwOnError()
      })(),
    )
  }
  await Promise.all(tasks)
}

export async function deleteGatewayFromSupabase(gatewayId: string): Promise<void> {
  await supabase
    .from('devices')
    .delete()
    .eq('id', gatewayId)
    .eq('organization_id', getActiveOrgId())
    .throwOnError()
}

/* ---------- センサー運用メモ ---------- */

type SupabaseSensorNoteRow = {
  id: string
  sensor_id: string | null
  sensor_name_snapshot: string
  author_id: string
  author_name: string
  body: string
  category: string
  approval: RecordApproval | null
  timestamp: string
}

function asNoteCategory(c: string): SensorNoteCategory {
  switch (c) {
    case 'install':
    case 'move':
    case 'calibration':
    case 'maintenance':
    case 'config':
    case 'incident':
      return c
    default:
      return 'other'
  }
}

export async function fetchSensorNotesAsStore(): Promise<SensorNoteStore> {
  const { data, error } = await supabase
    .from('sensor_notes')
    .select(
      'id, sensor_id, sensor_name_snapshot, author_id, author_name, body, category, approval, timestamp',
    )
    .eq('organization_id', getActiveOrgId())
    .order('timestamp', { ascending: false })
  if (error) throw error
  const store: SensorNoteStore = {}
  for (const r of (data ?? []) as SupabaseSensorNoteRow[]) {
    const note: SensorNote = {
      id: r.id,
      sensorId: r.sensor_id ?? '',
      sensorName: r.sensor_name_snapshot,
      authorId: r.author_id,
      authorName: r.author_name,
      body: r.body,
      category: asNoteCategory(r.category),
      timestamp: new Date(r.timestamp),
      approval: r.approval
        ? {
            approvedById: r.approval.approvedById,
            approvedByName: r.approval.approvedByName,
            approvedAt: new Date(r.approval.approvedAt),
            comment: r.approval.comment,
          }
        : undefined,
    }
    store[r.id] = note
  }
  return store
}

export async function upsertSensorNoteInSupabase(n: SensorNote): Promise<void> {
  await supabase
    .from('sensor_notes')
    .upsert({
      id: n.id,
      organization_id: getActiveOrgId(),
      sensor_id: n.sensorId || null,
      sensor_name_snapshot: n.sensorName,
      author_id: n.authorId,
      author_name: n.authorName,
      body: n.body,
      category: n.category,
      approval: n.approval
        ? {
            approvedById: n.approval.approvedById,
            approvedByName: n.approval.approvedByName,
            approvedAt: asIsoString(n.approval.approvedAt),
            comment: n.approval.comment,
          }
        : null,
      timestamp: asIsoString(n.timestamp),
    })
    .throwOnError()
}

export async function deleteSensorNoteFromSupabase(id: string): Promise<void> {
  await supabase
    .from('sensor_notes')
    .delete()
    .eq('id', id)
    .eq('organization_id', getActiveOrgId())
    .throwOnError()
}

/* ---------- アラートログ ---------- */

type SupabaseAlertLogRow = {
  id: string
  occurred_at: string
  target_kind: 'sensor' | 'gateway'
  target_id: string | null
  manufacturer: string
  model: string
  serial_number: string
  sensor_number: string | null
  kind: string
  metric: string | null
  value: number | null
  message: string
  session_id: string | null
  re_alert_index: number | null
  confirm_comment: string | null
  confirmed_by: string | null
  confirmed_at: string | null
}

export async function fetchAlertLogsAsStore(): Promise<AlertLogStore> {
  const { data, error } = await supabase
    .from('alert_logs')
    .select(
      'id, occurred_at, target_kind, target_id, manufacturer, model, serial_number, sensor_number, kind, metric, value, message, session_id, re_alert_index, confirm_comment, confirmed_by, confirmed_at',
    )
    .eq('organization_id', getActiveOrgId())
    .order('occurred_at', { ascending: false })
  if (error) throw error
  const store: AlertLogStore = {}
  for (const r of (data ?? []) as SupabaseAlertLogRow[]) {
    const entry: AlertLogEntry = {
      id: r.id,
      occurredAt: new Date(r.occurred_at),
      targetKind: r.target_kind,
      targetId: r.target_id ?? '',
      manufacturer: r.manufacturer,
      model: r.model,
      serialNumber: r.serial_number,
      sensorNumber: r.sensor_number ?? undefined,
      kind: r.kind as AlertLogEntry['kind'],
      metric: (r.metric ?? undefined) as AlertLogEntry['metric'],
      value: r.value ?? undefined,
      message: r.message,
      sessionId: r.session_id ?? undefined,
      reAlertIndex: r.re_alert_index ?? undefined,
      confirmComment: r.confirm_comment ?? undefined,
      confirmedBy: r.confirmed_by ?? undefined,
      confirmedAt: r.confirmed_at ? new Date(r.confirmed_at) : undefined,
    }
    store[r.id] = entry
  }
  return store
}

export async function upsertAlertLogInSupabase(e: AlertLogEntry): Promise<void> {
  await supabase
    .from('alert_logs')
    .upsert({
      id: e.id,
      organization_id: getActiveOrgId(),
      occurred_at: asIsoString(e.occurredAt),
      target_kind: e.targetKind,
      target_id: e.targetId || null,
      manufacturer: e.manufacturer,
      model: e.model,
      serial_number: e.serialNumber,
      sensor_number: e.sensorNumber ?? null,
      kind: e.kind,
      metric: e.metric ?? null,
      value: e.value ?? null,
      message: e.message,
      session_id: e.sessionId ?? null,
      re_alert_index: e.reAlertIndex ?? 0,
      confirm_comment: e.confirmComment ?? null,
      confirmed_by: e.confirmedBy ?? null,
      confirmed_at: asIsoString(e.confirmedAt),
    })
    .throwOnError()
}

export async function deleteAlertLogFromSupabase(id: string): Promise<void> {
  await supabase
    .from('alert_logs')
    .delete()
    .eq('id', id)
    .eq('organization_id', getActiveOrgId())
    .throwOnError()
}

/* ---------- ダッシュボード確認チェックイン ---------- */

type SupabaseCheckinRow = {
  id: string
  dashboard_id: string | null
  dashboard_name_snapshot: string
  user_id: string
  user_name: string
  timestamp: string
  status: DashboardCheckinStatus | null
  comment: string | null
  sensor_comments: CheckinSensorComment[] | null
  snapshot: DashboardCheckin['snapshot']
  approval: RecordApproval | null
}

export async function fetchCheckinsAsStore(): Promise<DashboardCheckinStore> {
  const { data, error } = await supabase
    .from('dashboard_checkins')
    .select(
      'id, dashboard_id, dashboard_name_snapshot, user_id, user_name, timestamp, status, comment, sensor_comments, snapshot, approval',
    )
    .eq('organization_id', getActiveOrgId())
    .order('timestamp', { ascending: false })
  if (error) throw error
  const store: DashboardCheckinStore = {}
  for (const r of (data ?? []) as SupabaseCheckinRow[]) {
    const snap = r.snapshot ?? {
      sensorCount: 0, onlineCount: 0, deviationSensorCount: 0, lookbackHours: 0,
    }
    const c: DashboardCheckin = {
      id: r.id,
      dashboardId: r.dashboard_id ?? '',
      dashboardName: r.dashboard_name_snapshot,
      userId: r.user_id,
      userName: r.user_name,
      timestamp: new Date(r.timestamp),
      status: r.status ?? undefined,
      comment: r.comment ?? undefined,
      sensorComments: (r.sensor_comments ?? []).map((sc) => ({
        ...sc,
        segmentComments: sc.segmentComments?.map((seg) => ({
          ...seg,
          start: new Date(seg.start),
          end: new Date(seg.end),
        })),
      })),
      snapshot: {
        ...snap,
        rangeStart: snap.rangeStart ? new Date(snap.rangeStart) : undefined,
        rangeEnd: snap.rangeEnd ? new Date(snap.rangeEnd) : undefined,
      },
      approval: r.approval
        ? {
            approvedById: r.approval.approvedById,
            approvedByName: r.approval.approvedByName,
            approvedAt: new Date(r.approval.approvedAt),
            comment: r.approval.comment,
          }
        : undefined,
    }
    store[r.id] = c
  }
  return store
}

export async function upsertCheckinInSupabase(c: DashboardCheckin): Promise<void> {
  await supabase
    .from('dashboard_checkins')
    .upsert({
      id: c.id,
      organization_id: getActiveOrgId(),
      dashboard_id: c.dashboardId || null,
      dashboard_name_snapshot: c.dashboardName,
      user_id: c.userId,
      user_name: c.userName,
      timestamp: asIsoString(c.timestamp),
      status: c.status ?? null,
      comment: c.comment ?? null,
      sensor_comments: c.sensorComments ?? [],
      snapshot: c.snapshot ?? {},
      approval: c.approval
        ? {
            approvedById: c.approval.approvedById,
            approvedByName: c.approval.approvedByName,
            approvedAt: asIsoString(c.approval.approvedAt),
            comment: c.approval.comment,
          }
        : null,
    })
    .throwOnError()
}

export async function deleteCheckinFromSupabase(id: string): Promise<void> {
  await supabase
    .from('dashboard_checkins')
    .delete()
    .eq('id', id)
    .eq('organization_id', getActiveOrgId())
    .throwOnError()
}

/** センサーを物理削除する。
 *  sensor_props / sensor_readings は FK on delete cascade で連鎖削除される。
 *  ただし Webhook が同じ devEUI で受信し続けると Block A の webhook-milesight
 *  Edge Function が再登録する仕組みになっているので、運用上は「いったん視界から外す」
 *  操作と等価。完全に消したい場合は MDP 側でも当該デバイスを停止する必要がある。 */
export async function deleteSensorFromSupabase(sensorId: string): Promise<void> {
  await supabase
    .from('devices')
    .delete()
    .eq('id', sensorId)
    .eq('organization_id', getActiveOrgId())
    .throwOnError()
}

/* ---------- 通知グループ ---------- */

type SupabaseNotificationGroupRow = {
  id: string
  name: string
  description: string | null
  timing: string
  channels: NotificationChannel[] | null
  created_at: string
  updated_at: string
}

function asTiming(t: string): NotificationTiming {
  switch (t) {
    case 'immediate':
    case 'batch-1h':
    case 'batch-6h':
    case 'batch-12h':
    case 'batch-24h':
      return t
    default:
      return 'immediate'
  }
}

export async function fetchNotificationGroupsAsStore(): Promise<NotificationGroupStore> {
  const { data, error } = await supabase
    .from('notification_groups')
    .select('id, name, description, timing, channels, created_at, updated_at')
    .eq('organization_id', getActiveOrgId())
    .order('created_at', { ascending: true })
  if (error) throw error
  const store: NotificationGroupStore = {}
  for (const r of (data ?? []) as SupabaseNotificationGroupRow[]) {
    const g: NotificationGroup = {
      id: r.id,
      name: r.name,
      description: r.description ?? undefined,
      timing: asTiming(r.timing),
      channels: r.channels ?? [],
      createdAt: new Date(r.created_at),
      updatedAt: new Date(r.updated_at),
    }
    store[r.id] = g
  }
  return store
}

export async function fetchGroupsAsStore(): Promise<SensorGroupStore> {
  const { data, error } = await supabase
    .from('sensor_groups')
    .select('id, name, description, color, created_at, updated_at')
    .eq('organization_id', getActiveOrgId())
    .order('display_order', { ascending: true })
  if (error) throw error
  const store: SensorGroupStore = {}
  for (const r of (data ?? []) as SupabaseGroupRow[]) {
    const g: SensorGroup = {
      id: r.id,
      name: r.name,
      description: r.description ?? undefined,
      color: r.color ?? undefined,
      createdAt: new Date(r.created_at),
      updatedAt: new Date(r.updated_at),
    }
    store[r.id] = g
  }
  return store
}

/* ============================================================
 * Manual (Phase 1.1: Supabase 同期)
 * ============================================================
 * manual_categories / manual_pages を双方向同期する。
 * - super_admin: 読み書き両方を Supabase 経由で（write-through）
 * - テナント: 読み取りのみ
 *
 * RLS は暫定で全許可（migration 0028 参照）。Phase 6 で super_admin 限定に。
 */

type SupabaseManualCategoryRow = {
  id: string
  name: string
  sort_order: number
  updated_at: string
}

type SupabaseManualPageRow = {
  id: string
  category_id: string
  title: string
  sort_order: number
  content: unknown
  updated_by_user_id: string | null
  updated_at: string
}

export async function fetchManualCategoriesList(): Promise<ManualCategory[]> {
  const { data, error } = await supabase
    .from('manual_categories')
    .select('*')
    .order('sort_order', { ascending: true })
  if (error) throw error
  return ((data ?? []) as SupabaseManualCategoryRow[]).map((r) => ({
    id: r.id,
    name: r.name,
    sortOrder: r.sort_order,
    updatedAt: new Date(r.updated_at),
  }))
}

export async function fetchManualPagesList(): Promise<ManualPage[]> {
  const { data, error } = await supabase
    .from('manual_pages')
    .select('*')
    .order('sort_order', { ascending: true })
  if (error) throw error
  return ((data ?? []) as SupabaseManualPageRow[]).map((r) => ({
    id: r.id,
    categoryId: r.category_id,
    title: r.title,
    sortOrder: r.sort_order,
    content: r.content ?? null,
    updatedByUserId: r.updated_by_user_id ?? undefined,
    updatedAt: new Date(r.updated_at),
  }))
}

export async function upsertManualCategoryInSupabase(
  c: ManualCategory,
): Promise<void> {
  await supabase
    .from('manual_categories')
    .upsert({
      id: c.id,
      name: c.name,
      sort_order: c.sortOrder,
      updated_at:
        c.updatedAt instanceof Date
          ? c.updatedAt.toISOString()
          : new Date().toISOString(),
    })
    .throwOnError()
}

export async function deleteManualCategoryFromSupabase(
  id: string,
): Promise<void> {
  // FK on delete cascade で配下ページも連鎖削除
  await supabase
    .from('manual_categories')
    .delete()
    .eq('id', id)
    .throwOnError()
}

export async function upsertManualPageInSupabase(p: ManualPage): Promise<void> {
  await supabase
    .from('manual_pages')
    .upsert({
      id: p.id,
      category_id: p.categoryId,
      title: p.title,
      sort_order: p.sortOrder,
      content: p.content ?? null,
      updated_by_user_id: p.updatedByUserId ?? null,
      updated_at:
        p.updatedAt instanceof Date
          ? p.updatedAt.toISOString()
          : new Date().toISOString(),
    })
    .throwOnError()
}

export async function deleteManualPageFromSupabase(id: string): Promise<void> {
  await supabase.from('manual_pages').delete().eq('id', id).throwOnError()
}

/* ---- Storage: manual-images バケットへのアップロード ---- */

/**
 * BlockNote から画像をアップロードする。戻り値は public URL。
 * Phase 1 では認可は Storage RLS の暫定ポリシー（全許可）に任せる。
 * 画像本体ではなく URL を BlockNote の document に持たせるため、ファイル名は
 * 衝突しないよう UUID プレフィックスを付ける。
 */
export async function uploadManualImage(file: File): Promise<string> {
  const ext = (file.name.split('.').pop() ?? 'bin').toLowerCase()
  const path = `${new Date().getFullYear()}/${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage
    .from('manual-images')
    .upload(path, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type || undefined,
    })
  if (error) throw error
  const { data } = supabase.storage.from('manual-images').getPublicUrl(path)
  return data.publicUrl
}
