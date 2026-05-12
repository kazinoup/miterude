/**
 * localStorage 永続化レイヤ — Phase 2
 *
 * Date 型は JSON 化できないため、シリアライズ時に { __d: ISO文字列 } マーカで包み、
 * デシリアライズ時に Date インスタンスへ復元する。
 */
import type {
  AlertLogStore,
  DashboardCheckinStore,
  DashboardReminderStore,
  DashboardStore,
  DeviceBaseStore,
  DeviceStore,
  GatewayPropsStore,
  GatewayStore,
  InvoiceStore,
  ManufacturerIntegration,
  ManufacturerIntegrationStore,
  NotificationGroupStore,
  ReportScheduleStore,
  SavedFilterStore,
  SensorCategoryStore,
  SensorGroupStore,
  SensorNoteStore,
  SensorPropsStore,
  SensorStore,
  ThresholdTemplateStore,
} from '../types'
import { defaultAlertSettings, defaultGatewayAlertSettings, ensureDate } from './mock'
import {
  buildDefaultIntegrations,
  LEGACY_DROPPED_INTEGRATION_IDS,
  manufacturerIntegrationId,
} from './notify'
import {
  buildDefaultCategories,
  defaultCategoryIdForKind,
  LEGACY_GATEWAY_CATEGORY_IDS,
} from './categories'
import { buildDefaultTemplates, migrateTemplate } from './thresholdTemplates'
import { collectYearMonths, inferStorageKind } from './report'
import {
  externalKeyFieldFor,
  inferDeviceRoleFromModel,
} from './supportedDevices'
import type { DeviceBase, GatewayRole, SensorRole } from '../types'
import {
  selectGateways,
  selectSensors,
  splitGateway,
  splitSensor,
} from './devices'

/** 旧グローバル単一テナント用キー（Phase A-1 でテナント別に移行済）。
 *  ensureSeedData() で demo 組織の tenantStateKey() にコピーされる。 */
const KEY = 'miterude:state:v3'

/** テナント別の永続化キー。
 *  v5 → v6 (Phase F-4 D-2) で sensors / gateways を 3 ストア
 *  (deviceMaster / sensorProps / gatewayProps) に物理分離した。 */
function tenantKey(organizationId: string): string {
  return `miterude:tenant:${organizationId}:state:v6`
}

/** v5 以前のテナントキー（読み込み時にあれば移行して削除）。 */
function legacyTenantKeyV5(organizationId: string): string {
  return `miterude:tenant:${organizationId}:state:v5`
}

/** v4 以前のテナントキー。v5 時代の loadState で吸収済みだが、
 *  v6 直行ケースでも一応見ておく（最後の保険）。 */
function legacyTenantKeyV4(organizationId: string): string {
  return `miterude:tenant:${organizationId}:state:v4`
}

/* ---------- thresholds マイグレーション (Phase 9.14) ----------
 *  旧形式: { kind: 'temperature-humidity',
 *            temperature: { enabled, alertMin, alertMax, warnMin?, warnMax? },
 *            humidity: { ... } }
 *  新形式: { kind: 'temperature-humidity',
 *            temperature: { alert: { enabled, min?, max? }, warn: { enabled, min?, max? } },
 *            humidity: { ... } }
 *
 *  - 既に新形式 → そのまま返す
 *  - 旧形式 → 新形式に変換
 *  - 想定外の形 → undefined（閾値なし扱い）に倒す。これでアプリは安全に起動する。
 */
type LegacyLevel = {
  enabled?: boolean
  alertMin?: number
  alertMax?: number
  warnMin?: number
  warnMax?: number
}

function migrateLegacyMetric(m: unknown): import('../types').ThresholdMetric | null {
  if (!m || typeof m !== 'object') return null
  const obj = m as Record<string, unknown>
  // 既に新形式
  if (obj.alert && typeof obj.alert === 'object' && obj.warn && typeof obj.warn === 'object') {
    return obj as unknown as import('../types').ThresholdMetric
  }
  // 旧形式（alertMin/alertMax 等を直接持つ）→ ネスト構造に持ち上げる
  const legacy = obj as LegacyLevel
  if (
    'alertMin' in legacy ||
    'alertMax' in legacy ||
    'warnMin' in legacy ||
    'warnMax' in legacy ||
    'enabled' in legacy
  ) {
    const legacyEnabled = legacy.enabled === true
    return {
      alert: {
        enabled: legacyEnabled,
        min: typeof legacy.alertMin === 'number' ? legacy.alertMin : undefined,
        max: typeof legacy.alertMax === 'number' ? legacy.alertMax : undefined,
      },
      warn: {
        enabled:
          legacyEnabled &&
          (typeof legacy.warnMin === 'number' || typeof legacy.warnMax === 'number'),
        min: typeof legacy.warnMin === 'number' ? legacy.warnMin : undefined,
        max: typeof legacy.warnMax === 'number' ? legacy.warnMax : undefined,
      },
    }
  }
  return null
}

function migrateThresholds(
  t: unknown,
): import('../types').SensorThresholds | undefined {
  if (!t || typeof t !== 'object') return undefined
  const obj = t as Record<string, unknown>
  if (obj.kind === 'temperature-humidity') {
    const temp = migrateLegacyMetric(obj.temperature)
    const hum = migrateLegacyMetric(obj.humidity)
    if (!temp && !hum) return undefined
    return {
      kind: 'temperature-humidity',
      temperature: temp ?? { alert: { enabled: false }, warn: { enabled: false } },
      humidity: hum ?? { alert: { enabled: false }, warn: { enabled: false } },
    }
  }
  // 想定外の kind は破棄（破損データ防止）
  return undefined
}
/** v2 以前のキー（読み込み時に存在すれば破棄して v3 に切り替え） */
const LEGACY_KEYS = ['miterude:state:v2', 'miterude:state:v1']

/** v5 までの古いシェイプ。loadState の中だけで使う中間型。
 *  v5 → v6 の変換が終われば不要になる。 */
type PersistedStateV5 = {
  devices: DeviceStore
  sensors: SensorStore
  gateways: GatewayStore
  dashboards?: DashboardStore
  activeDashboardId?: string | null
  notificationGroups?: NotificationGroupStore
  manufacturerIntegrations?: ManufacturerIntegrationStore
  checkins?: DashboardCheckinStore
  sensorNotes?: SensorNoteStore
  sensorGroups?: SensorGroupStore
  savedFilters?: SavedFilterStore
  sensorCategories?: SensorCategoryStore
  thresholdTemplates?: ThresholdTemplateStore
  alertLogs?: AlertLogStore
  reportSchedules?: ReportScheduleStore
  dashboardReminders?: DashboardReminderStore
  invoices?: InvoiceStore
}

/** v6 以降の正式シェイプ。デバイスマスター + 固有プロパティを物理分離。 */
export type PersistedState = {
  /** 計測値ストア（旧名 DeviceStore のまま、Record<deviceId, SensorReading[]>） */
  devices: DeviceStore
  /** Phase F-4 D-2: デバイスマスター（共通プロパティ） */
  deviceMaster: DeviceBaseStore
  /** Phase F-4 D-2: センサー固有プロパティ */
  sensorProps: SensorPropsStore
  /** Phase F-4 D-2: ゲートウェイ固有プロパティ */
  gatewayProps: GatewayPropsStore
  /** Phase 5 で追加。古いデータでは undefined */
  dashboards?: DashboardStore
  /** 現在表示中のダッシュボードID */
  activeDashboardId?: string | null
  /** Phase 7 で追加 */
  notificationGroups?: NotificationGroupStore
  manufacturerIntegrations?: ManufacturerIntegrationStore
  /** Phase 8: 確認・運用メモの記録 */
  checkins?: DashboardCheckinStore
  sensorNotes?: SensorNoteStore
  /** Phase 9.5: グループ・保存フィルタ */
  sensorGroups?: SensorGroupStore
  savedFilters?: SavedFilterStore
  /** Phase 9.9: ユーザー定義区分 */
  sensorCategories?: SensorCategoryStore
  /** Phase 9.14: 閾値テンプレート */
  thresholdTemplates?: ThresholdTemplateStore
  /** Phase B / Phase 10: アラートログ（蓄積） */
  alertLogs?: AlertLogStore
  /** Phase G: レポート定期配信 */
  reportSchedules?: ReportScheduleStore
  /** Phase G: ダッシュボード確認リマインド */
  dashboardReminders?: DashboardReminderStore
  /** 銀行振込テナント向けの請求書履歴。クレジット決済の請求は Stripe 側で管理。 */
  invoices?: InvoiceStore
}

const DATE_MARKER = '__d'

function replacer(_key: string, value: unknown): unknown {
  if (value instanceof Date) {
    return { [DATE_MARKER]: value.toISOString() }
  }
  return value
}

function reviver(_key: string, value: unknown): unknown {
  if (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    DATE_MARKER in value &&
    Object.keys(value as object).length === 1
  ) {
    const iso = (value as Record<string, unknown>)[DATE_MARKER]
    if (typeof iso === 'string') return new Date(iso)
  }
  return value
}

export function saveState(state: PersistedState, organizationId: string): void {
  try {
    const json = JSON.stringify(state, replacer)
    localStorage.setItem(tenantKey(organizationId), json)
  } catch (e) {
    // QuotaExceededError などは握りつぶして警告のみ
    console.warn('[miterude] state save failed:', e)
  }
}

/* ---------- Phase F-4 D-2: v5 ⇔ v6 形式変換 ---------- */

/** v5 (sensors+gateways の 1 マップ) → v6 (deviceMaster + sensorProps + gatewayProps) に展開。
 *  既存の Sensor / Gateway が JOIN 済みフィールドを持っているので、
 *  splitSensor / splitGateway でマスター + 固有プロパティに分解する。 */
function convertV5ToV6(v5: PersistedStateV5): PersistedState {
  const deviceMaster: DeviceBaseStore = {}
  const sensorProps: SensorPropsStore = {}
  const gatewayProps: GatewayPropsStore = {}

  for (const id of Object.keys(v5.sensors ?? {})) {
    const s = v5.sensors[id]
    if (!s) continue
    const { base, props } = splitSensor(s)
    deviceMaster[id] = base
    sensorProps[id] = props
  }
  for (const id of Object.keys(v5.gateways ?? {})) {
    const g = v5.gateways[id]
    if (!g) continue
    const { base, props } = splitGateway(g)
    deviceMaster[id] = base
    gatewayProps[id] = props
  }

  // sensors / gateways 以外のフィールドはそのまま引き継ぐ
  const {
    // 旧シェイプ専用フィールドは捨てる
    sensors: _sensors,
    gateways: _gateways,
    ...rest
  } = v5
  void _sensors
  void _gateways
  return { ...rest, deviceMaster, sensorProps, gatewayProps }
}

/** v6 → v5 形式（loadState の中で旧マイグレーションパイプラインに通すための内部変換）。
 *  loadState は内部的に v5 シェイプで処理してから convertV5ToV6 で出力する。 */
function v6ToV5InternalShape(v6: PersistedState): PersistedStateV5 {
  const sensors = selectSensors(v6.deviceMaster, v6.sensorProps)
  const gateways = selectGateways(v6.deviceMaster, v6.gatewayProps)
  const {
    deviceMaster: _dm,
    sensorProps: _sp,
    gatewayProps: _gp,
    ...rest
  } = v6
  void _dm
  void _sp
  void _gp
  return { ...rest, sensors, gateways }
}

/** v6 シェイプかどうかを判定する型ガード。 */
function isV6Shape(parsed: unknown): parsed is PersistedState {
  if (!parsed || typeof parsed !== 'object') return false
  const p = parsed as Record<string, unknown>
  return typeof p.deviceMaster === 'object' && p.deviceMaster !== null
}

/* ---------- Backward-compat: 旧 state.sensors / state.gateways ヘルパ ----------
 *  既存の admin / webhook 受信コードは state.sensors / state.gateways を直接参照
 *  していたため、3-store 化後の PersistedState に対しても同じ感覚で扱える
 *  「ビュー取得 + 一括書き戻し」のヘルパを提供する。 */

/** PersistedState からセンサーの JOIN ビューを取得 */
export function sensorsFromState(state: PersistedState): SensorStore {
  return selectSensors(state.deviceMaster, state.sensorProps)
}

/** PersistedState からゲートウェイの JOIN ビューを取得 */
export function gatewaysFromState(state: PersistedState): GatewayStore {
  return selectGateways(state.deviceMaster, state.gatewayProps)
}

/** 新しい SensorStore を PersistedState に書き戻す。
 *  （旧コードの `saveState({ ...state, sensors: newSensors })` の置き換え） */
export function withSensors(
  state: PersistedState,
  nextSensors: SensorStore,
): PersistedState {
  const deviceMaster: DeviceBaseStore = { ...state.deviceMaster }
  const sensorProps: SensorPropsStore = { ...state.sensorProps }
  // 削除されたセンサーを deviceMaster / sensorProps から落とす
  for (const id of Object.keys(deviceMaster)) {
    const base = deviceMaster[id] as DeviceBase | undefined
    if (base?.deviceType === 'sensor' && !nextSensors[id]) {
      delete deviceMaster[id]
      delete sensorProps[id]
    }
  }
  // 追加・更新されたセンサーを反映
  for (const id of Object.keys(nextSensors)) {
    const s = nextSensors[id]
    const { base, props } = splitSensor(s)
    deviceMaster[id] = base
    sensorProps[id] = props
  }
  return { ...state, deviceMaster, sensorProps }
}

/** 新しい GatewayStore を PersistedState に書き戻す */
export function withGateways(
  state: PersistedState,
  nextGateways: GatewayStore,
): PersistedState {
  const deviceMaster: DeviceBaseStore = { ...state.deviceMaster }
  const gatewayProps: GatewayPropsStore = { ...state.gatewayProps }
  for (const id of Object.keys(deviceMaster)) {
    const base = deviceMaster[id] as DeviceBase | undefined
    if (base?.deviceType === 'gateway' && !nextGateways[id]) {
      delete deviceMaster[id]
      delete gatewayProps[id]
    }
  }
  for (const id of Object.keys(nextGateways)) {
    const g = nextGateways[id]
    const { base, props } = splitGateway(g)
    deviceMaster[id] = base
    gatewayProps[id] = props
  }
  return { ...state, deviceMaster, gatewayProps }
}

export function loadState(organizationId: string): PersistedState | null {
  try {
    // v2 以前のキーは Phase 9 で互換性を切るため削除
    for (const lk of LEGACY_KEYS) {
      if (localStorage.getItem(lk)) {
        try {
          localStorage.removeItem(lk)
        } catch {
          /* noop */
        }
      }
    }
    // テナント別キー（v6）を優先、なければ v5 → v4 → グローバル旧キーの順でフォールバック
    const v6Key = tenantKey(organizationId)
    const v5Key = legacyTenantKeyV5(organizationId)
    const v4Key = legacyTenantKeyV4(organizationId)
    let raw = localStorage.getItem(v6Key)
    let needsLegacyMigration = false
    if (!raw) {
      raw = localStorage.getItem(v5Key)
      if (raw) needsLegacyMigration = true
    }
    if (!raw) {
      raw = localStorage.getItem(v4Key)
      if (raw) needsLegacyMigration = true
    }
    if (!raw) raw = localStorage.getItem(KEY)
    if (!raw) return null
    const parsedRaw = JSON.parse(raw, reviver) as unknown
    // v6 シェイプで保存されていれば、内部処理用に v5 シェイプへ展開してから
    // 既存マイグレーションパイプラインに通す（最終的に v6 で返す）。
    let parsed: PersistedStateV5
    if (isV6Shape(parsedRaw)) {
      parsed = v6ToV5InternalShape(parsedRaw)
    } else {
      parsed = parsedRaw as PersistedStateV5
    }
    // 互換性チェック：必須フィールドが揃っているか
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      typeof parsed.devices !== 'object' ||
      typeof parsed.sensors !== 'object' ||
      typeof parsed.gateways !== 'object'
    ) {
      return null
    }
    // 日付フィールドの hydration（reviver で取りこぼした場合の保険）
    for (const id of Object.keys(parsed.devices)) {
      const arr = parsed.devices[id]
      if (Array.isArray(arr)) {
        for (const r of arr) {
          if (r) r.measuredAt = ensureDate(r.measuredAt)
        }
      }
    }
    for (const id of Object.keys(parsed.sensors)) {
      const s = parsed.sensors[id]
      if (s) {
        s.lastSeenAt = ensureDate(s.lastSeenAt)
        s.registeredAt = ensureDate(s.registeredAt)
      }
    }
    for (const id of Object.keys(parsed.gateways)) {
      const g = parsed.gateways[id]
      if (!g) continue
      g.registeredAt = ensureDate(g.registeredAt)
      // Phase F-3: Gateway 拡張フィールドの補完
      if (g.lastSeenAt) g.lastSeenAt = ensureDate(g.lastSeenAt)
      if (typeof g.online !== 'boolean') g.online = true
      if (g.deviceNumber == null) g.deviceNumber = g.id
      if (!('groupId' in g)) g.groupId = null
      if (!Array.isArray(g.tags)) g.tags = []
      if (!('notificationGroupId' in g)) g.notificationGroupId = null

      // Phase F-4: deviceType / role / externalKey を補完
      g.deviceType = 'gateway'

      // role: 旧 categoryId（親機 / 中継機）があればそれを優先、なければモデルから推定
      let role: GatewayRole | undefined
      if (g.categoryId === LEGACY_GATEWAY_CATEGORY_IDS.master) role = 'master'
      else if (g.categoryId === LEGACY_GATEWAY_CATEGORY_IDS.relay) role = 'relay'
      if (!role) {
        role = (inferDeviceRoleFromModel(g.model ?? '') as GatewayRole | undefined) ?? 'master'
      }
      g.role = role

      // 旧 親機/中継機 categoryId はもう role に格納したのでクリア
      if (
        g.categoryId === LEGACY_GATEWAY_CATEGORY_IDS.master ||
        g.categoryId === LEGACY_GATEWAY_CATEGORY_IDS.relay
      ) {
        g.categoryId = null
      }

      // externalKey: メーカーごとの規約に従う（Milesight: devEUI, それ以外: serialNumber）
      if (!g.externalKey) {
        const keyField = externalKeyFieldFor(g.manufacturer ?? '')
        g.externalKey =
          keyField === 'devEUI'
            ? g.devEUI || g.serialNumber || g.id
            : g.serialNumber || g.id
      }

      // alertSettings は既定（オフラインのみ）で補う
      if (!g.alertSettings) {
        g.alertSettings = defaultGatewayAlertSettings()
      } else {
        if (!g.alertSettings.notifyChannels) {
          g.alertSettings.notifyChannels = {
            email: true,
            slack: false,
            push: false,
          }
        }
      }
    }

    // マイグレーション: alertSettings が無い古いセンサーに既定値を補う
    // Phase 7: kind / notificationGroupId のデフォルト補完
    // Phase 9.5: groupId / tags のデフォルト補完
    // Phase 9.9: categoryId の補完（後段で実データに応じて自動アサイン）
    // Phase 9.12 → 9.14: thresholds の旧形式から新形式への変換
    for (const id of Object.keys(parsed.sensors)) {
      const s = parsed.sensors[id]
      if (s) {
        // Phase C: 既存 alertSettings に batteryEnabled / batteryThresholdPercent
        //   が無い場合は既定値で補う
        const baseAlert = s.alertSettings ?? defaultAlertSettings()
        const mergedAlert = {
          ...baseAlert,
          batteryEnabled:
            typeof baseAlert.batteryEnabled === 'boolean'
              ? baseAlert.batteryEnabled
              : false,
          batteryThresholdPercent:
            typeof baseAlert.batteryThresholdPercent === 'number'
              ? baseAlert.batteryThresholdPercent
              : 10,
        }
        // Phase F-4: deviceType / role / externalKey を補完
        const inferredRole =
          (inferDeviceRoleFromModel(s.model ?? '') as SensorRole | undefined) ??
          (s.kind as SensorRole | undefined) ??
          'temperature-humidity'
        const keyField = externalKeyFieldFor(s.manufacturer ?? '')
        const externalKey =
          s.externalKey ??
          (keyField === 'devEUI'
            ? s.devEUI || s.serialNumber || s.id
            : s.serialNumber || s.id)

        parsed.sensors[id] = {
          ...s,
          deviceType: 'sensor',
          role: inferredRole,
          externalKey,
          alertSettings: mergedAlert,
          kind: s.kind ?? 'temperature-humidity',
          notificationGroupId: s.notificationGroupId ?? null,
          groupId: s.groupId ?? null,
          tags: Array.isArray(s.tags) ? s.tags : [],
          // categoryId は後段でデフォルト区分に紐付ける
          categoryId: s.categoryId ?? null,
          // 旧形式 thresholds（alertMin/alertMax/warnMin/warnMax）を新形式
          // （alert/warn にネスト）に変換、または不正な形式なら破棄
          thresholds: migrateThresholds(s.thresholds),
        }
      }
    }

    // 通知グループ・メーカー連携ストアの初期化
    if (!parsed.notificationGroups || typeof parsed.notificationGroups !== 'object') {
      parsed.notificationGroups = {}
    } else {
      for (const id of Object.keys(parsed.notificationGroups)) {
        const g = parsed.notificationGroups[id]
        if (g) {
          g.createdAt = ensureDate(g.createdAt)
          g.updatedAt = ensureDate(g.updatedAt)
          // 旧値 'batch-30m' を 'batch-1h' に置き換え
          if ((g.timing as string) === 'batch-30m') {
            g.timing = 'batch-1h'
          }
        }
      }
    }
    if (
      !parsed.manufacturerIntegrations ||
      typeof parsed.manufacturerIntegrations !== 'object'
    ) {
      parsed.manufacturerIntegrations = buildDefaultIntegrations()
    } else {
      for (const id of Object.keys(parsed.manufacturerIntegrations)) {
        const m = parsed.manufacturerIntegrations[id]
        if (m) m.updatedAt = ensureDate(m.updatedAt)
      }
      // 旧バージョンの既定エントリ（Dragino, SenseCAP, Elsys）を片付ける。
      // ユーザーが触っていなければ（シークレット無し）削除。
      for (const id of LEGACY_DROPPED_INTEGRATION_IDS) {
        const i = parsed.manufacturerIntegrations[id]
        if (i && !i.webhookSecret) {
          delete parsed.manufacturerIntegrations[id]
        }
      }
      // IoT Mobile が無ければ追加（連携状態は webhookSecret の有無で判定する設計）
      const iotId = manufacturerIntegrationId('IoT Mobile')
      if (!parsed.manufacturerIntegrations[iotId]) {
        parsed.manufacturerIntegrations[iotId] = {
          id: iotId,
          manufacturer: 'IoT Mobile',
          sensorKinds: ['temperature-humidity'],
          updatedAt: new Date(),
        }
      }
      // 旧データの enabled フィールドが残っていたら除去（型から消えたため）
      for (const id of Object.keys(parsed.manufacturerIntegrations)) {
        const m = parsed.manufacturerIntegrations[id] as
          | (ManufacturerIntegration & { enabled?: unknown })
          | undefined
        if (m && 'enabled' in m) delete (m as { enabled?: unknown }).enabled
      }
    }
    // ダッシュボードフィールド未設定なら空オブジェクト
    if (!parsed.dashboards || typeof parsed.dashboards !== 'object') {
      parsed.dashboards = {}
    } else {
      for (const id of Object.keys(parsed.dashboards)) {
        const d = parsed.dashboards[id]
        if (d) {
          d.createdAt = ensureDate(d.createdAt)
          d.updatedAt = ensureDate(d.updatedAt)
          // Phase 9: 新フィールドの補完（v3 化途上のデータ向け）
          if (!Array.isArray(d.targetSensorIds)) {
            d.targetSensorIds = []
          }
          if (!d.defaultPeriod || typeof d.defaultPeriod !== 'object') {
            d.defaultPeriod = { type: 'day' }
          }
          // Phase F-5: 公開 URL の発行日時は Date 化
          if (d.publicShareIssuedAt) {
            d.publicShareIssuedAt = ensureDate(d.publicShareIssuedAt)
          }
          // マップウィジェットのピンに size / display が無い場合の補完
          if (Array.isArray(d.widgets)) {
            for (const w of d.widgets) {
              if (w && w.type === 'map' && Array.isArray(w.pins)) {
                w.pins = w.pins.map((p) => ({
                  ...p,
                  size: p.size ?? 'md',
                  display: p.display ?? 'both',
                }))
              }
            }
          }
        }
      }
    }

    // Phase 8: チェックイン・メモストアの初期化＋日付ハイドレーション
    if (!parsed.checkins || typeof parsed.checkins !== 'object') {
      parsed.checkins = {}
    } else {
      for (const id of Object.keys(parsed.checkins)) {
        const c = parsed.checkins[id]
        if (c) {
          c.timestamp = ensureDate(c.timestamp)
          if (c.approval) c.approval.approvedAt = ensureDate(c.approval.approvedAt)
          // Phase F-6: snapshot 内の rangeStart/End を Date 化
          if (c.snapshot?.rangeStart) {
            c.snapshot.rangeStart = ensureDate(c.snapshot.rangeStart)
          }
          if (c.snapshot?.rangeEnd) {
            c.snapshot.rangeEnd = ensureDate(c.snapshot.rangeEnd)
          }
        }
      }
    }
    if (!parsed.sensorNotes || typeof parsed.sensorNotes !== 'object') {
      parsed.sensorNotes = {}
    } else {
      for (const id of Object.keys(parsed.sensorNotes)) {
        const n = parsed.sensorNotes[id]
        if (n) {
          n.timestamp = ensureDate(n.timestamp)
          if (n.approval) n.approval.approvedAt = ensureDate(n.approval.approvedAt)
        }
      }
    }

    // Phase 9.5: グループ・保存フィルタの初期化＋日付ハイドレーション
    if (!parsed.sensorGroups || typeof parsed.sensorGroups !== 'object') {
      parsed.sensorGroups = {}
    } else {
      for (const id of Object.keys(parsed.sensorGroups)) {
        const g = parsed.sensorGroups[id]
        if (g) {
          g.createdAt = ensureDate(g.createdAt)
          g.updatedAt = ensureDate(g.updatedAt)
        }
      }
    }
    if (!parsed.savedFilters || typeof parsed.savedFilters !== 'object') {
      parsed.savedFilters = {}
    } else {
      for (const id of Object.keys(parsed.savedFilters)) {
        const f = parsed.savedFilters[id]
        if (f) {
          f.createdAt = ensureDate(f.createdAt)
          f.updatedAt = ensureDate(f.updatedAt)
        }
        // Phase 9.9: 旧 storageKinds は categoryIds に変換できないため破棄。
        // 区分 = ユーザー定義になり、自動推定の StorageKind enum とは
        // 同一視できないため、保存フィルタの整合性を保つには破棄が安全。
        const cond = f?.conditions as
          | (typeof f.conditions & { storageKinds?: unknown })
          | undefined
        if (cond && 'storageKinds' in cond) {
          delete (cond as Record<string, unknown>).storageKinds
        }
      }
    }

    // Phase 9.9: ユーザー定義区分（SensorCategory）の初期化＋日付ハイドレーション
    if (!parsed.sensorCategories || typeof parsed.sensorCategories !== 'object') {
      parsed.sensorCategories = buildDefaultCategories()
    } else {
      for (const id of Object.keys(parsed.sensorCategories)) {
        const c = parsed.sensorCategories[id]
        if (c) {
          c.createdAt = ensureDate(c.createdAt)
          c.updatedAt = ensureDate(c.updatedAt)
        }
      }
      // Phase F-4: 旧「親機 / 中継機」区分は role に移行したので削除する。
      // システム配置の擬似カテゴリだったので、ユーザー編集とは見なさず安全に消せる。
      delete parsed.sensorCategories[LEGACY_GATEWAY_CATEGORY_IDS.master]
      delete parsed.sensorCategories[LEGACY_GATEWAY_CATEGORY_IDS.relay]
      // ストアが空ならデフォルトを投入
      if (Object.keys(parsed.sensorCategories).length === 0) {
        parsed.sensorCategories = buildDefaultCategories()
      }
    }

    // Phase 9.9: 既存センサーの categoryId が未設定なら、
    // 直近月の平均温度から推定した StorageKind に基づいて
    // デフォルト区分（冷凍 / 冷蔵 / 室温）に自動アサインする。
    {
      const validIds = new Set(Object.keys(parsed.sensorCategories))
      for (const id of Object.keys(parsed.sensors)) {
        const s = parsed.sensors[id]
        if (!s) continue
        // 既存の有効な categoryId はそのまま尊重
        if (s.categoryId && validIds.has(s.categoryId)) continue
        const readings = parsed.devices[id] ?? []
        if (readings.length === 0) {
          parsed.sensors[id] = { ...s, categoryId: null }
          continue
        }
        const months = collectYearMonths(readings)
        const lastYm = months[months.length - 1]
        const kind = lastYm ? inferStorageKind(readings, lastYm) : 'other'
        const fallback = defaultCategoryIdForKind(kind)
        parsed.sensors[id] = {
          ...s,
          categoryId: validIds.has(fallback) ? fallback : null,
        }
      }
    }

    // Phase 9.14: 閾値テンプレートの初期化＋日付ハイドレーション
    //              + 旧形式 thresholds の新形式変換
    if (
      !parsed.thresholdTemplates ||
      typeof parsed.thresholdTemplates !== 'object'
    ) {
      parsed.thresholdTemplates = buildDefaultTemplates()
    } else {
      for (const id of Object.keys(parsed.thresholdTemplates)) {
        const t = parsed.thresholdTemplates[id]
        if (t) {
          t.createdAt = ensureDate(t.createdAt)
          t.updatedAt = ensureDate(t.updatedAt)
          // テンプレート内の thresholds も旧形式→新形式に変換。
          //  変換不能（破損）でも、scope.thresholds=true でなければ続行する。
          if (t.thresholds) {
            const migrated = migrateThresholds(t.thresholds)
            if (migrated) {
              t.thresholds = migrated
            } else {
              // 閾値が破損していて scope.thresholds=true なら、
              //  そのテンプレ全体は使い物にならないので破棄。
              if (!t.scope || t.scope.thresholds) {
                delete parsed.thresholdTemplates[id]
                continue
              }
              t.thresholds = undefined
            }
          }
          // scope なし（旧データ）→ scope = { thresholds: true } を補完
          parsed.thresholdTemplates[id] = migrateTemplate(t)
        }
      }
      // ストアが空ならデフォルトを投入（後方互換）
      if (Object.keys(parsed.thresholdTemplates).length === 0) {
        parsed.thresholdTemplates = buildDefaultTemplates()
      }
    }

    // Phase B (Phase 10): アラートログの補完。未存在時は空オブジェクト。
    //   occurredAt を Date 化（reviver でケアされている想定だが念のため）。
    if (!parsed.alertLogs || typeof parsed.alertLogs !== 'object') {
      parsed.alertLogs = {}
    } else {
      for (const id of Object.keys(parsed.alertLogs)) {
        const e = parsed.alertLogs[id]
        if (e) e.occurredAt = ensureDate(e.occurredAt)
      }
    }

    // Phase G: レポート定期配信 / ダッシュボード確認リマインドの補完
    if (!parsed.reportSchedules || typeof parsed.reportSchedules !== 'object') {
      parsed.reportSchedules = {}
    } else {
      for (const id of Object.keys(parsed.reportSchedules)) {
        const r = parsed.reportSchedules[id]
        if (r) {
          r.createdAt = ensureDate(r.createdAt)
          r.updatedAt = ensureDate(r.updatedAt)
        }
      }
    }
    if (
      !parsed.dashboardReminders ||
      typeof parsed.dashboardReminders !== 'object'
    ) {
      parsed.dashboardReminders = {}
    } else {
      for (const id of Object.keys(parsed.dashboardReminders)) {
        const d = parsed.dashboardReminders[id]
        if (d) {
          d.createdAt = ensureDate(d.createdAt)
          d.updatedAt = ensureDate(d.updatedAt)
        }
      }
    }

    // Phase F-4 D-2: 全マイグレーション完了後、内部 v5 シェイプを v6 シェイプに変換して返す
    const result = convertV5ToV6(parsed)

    // 旧キー（v5/v4）から読み込んだ場合は v6 シェイプで保存し直し、旧キーを削除
    if (needsLegacyMigration) {
      try {
        saveState(result, organizationId)
        localStorage.removeItem(v5Key)
        localStorage.removeItem(v4Key)
      } catch (e) {
        console.warn('[miterude] legacy → v6 migration save failed:', e)
      }
    }

    return result
  } catch (e) {
    console.warn('[miterude] state load failed:', e)
    return null
  }
}

export function clearState(): void {
  try {
    localStorage.removeItem(KEY)
  } catch (e) {
    console.warn('[miterude] state clear failed:', e)
  }
}
