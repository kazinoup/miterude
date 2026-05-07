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
  DeviceStore,
  GatewayStore,
  ManufacturerIntegrationStore,
  NotificationGroupStore,
  ReportScheduleStore,
  SavedFilterStore,
  SensorCategoryStore,
  SensorGroupStore,
  SensorNoteStore,
  SensorStore,
  ThresholdTemplateStore,
} from '../types'
import { defaultAlertSettings, ensureDate } from './mock'
import {
  buildDefaultIntegrations,
  LEGACY_DROPPED_INTEGRATION_IDS,
  manufacturerIntegrationId,
} from './notify'
import {
  buildDefaultCategories,
  defaultCategoryIdForKind,
} from './categories'
import { buildDefaultTemplates } from './thresholdTemplates'
import { collectYearMonths, inferStorageKind } from './report'

/** 旧グローバル単一テナント用キー（Phase A-1 でテナント別に移行済）。
 *  ensureSeedData() で demo 組織の tenantStateKey() にコピーされる。 */
const KEY = 'miterude:state:v3'

/** テナント別の永続化キー。Phase A-1 から導入。
 *  loadState / saveState がこの形式で読み書きする。 */
function tenantKey(organizationId: string): string {
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

export type PersistedState = {
  devices: DeviceStore
  sensors: SensorStore
  gateways: GatewayStore
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
    // テナント別キーを優先、なければ旧グローバルキー（フォールバック）
    const raw =
      localStorage.getItem(tenantKey(organizationId)) ??
      localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw, reviver) as PersistedState
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
      if (g) g.registeredAt = ensureDate(g.registeredAt)
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
        parsed.sensors[id] = {
          ...s,
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
      // ユーザーが触っていなければ（OFF かつシークレット無し）削除。
      for (const id of LEGACY_DROPPED_INTEGRATION_IDS) {
        const i = parsed.manufacturerIntegrations[id]
        if (i && !i.enabled && !i.webhookSecret) {
          delete parsed.manufacturerIntegrations[id]
        }
      }
      // IoT Mobile が無ければ追加
      const iotId = manufacturerIntegrationId('IoT Mobile')
      if (!parsed.manufacturerIntegrations[iotId]) {
        parsed.manufacturerIntegrations[iotId] = {
          id: iotId,
          manufacturer: 'IoT Mobile',
          enabled: false,
          sensorKinds: ['temperature-humidity'],
          updatedAt: new Date(),
        }
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
          //  変換不能（破損）なら、テンプレ自体を破棄する。
          const migrated = migrateThresholds(t.thresholds)
          if (!migrated) {
            delete parsed.thresholdTemplates[id]
            continue
          }
          t.thresholds = migrated
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

    return parsed
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
