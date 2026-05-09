/**
 * センサー設定テンプレート（snapshot 方式）— Phase 9.14 を拡張
 *
 * 設計の要点:
 * - テンプレートは「値の生成器」。適用するとセンサーに値がコピーされ、
 *   それ以降テンプレートを編集してもセンサーには伝搬しない（再適用が必要）。
 * - 種別（SensorKind）が一致するセンサーにのみ適用できる。混在選択時は
 *   一致するものだけ更新し、それ以外はスキップする運用。
 * - 4 種類の設定項目（閾値 / アラート発生条件 / 除外 / 通知）を選択的に
 *   含められる。`scope.X = true` のフィールドだけが実際に上書きされる。
 *
 * ファイル名は歴史的経緯で `thresholdTemplates.ts` のままだが、
 * 中身は SensorSettingsTemplate を扱う。
 */
import type {
  AlertSettingsForTemplate,
  Sensor,
  SensorKind,
  SensorSettingsTemplate,
  SensorSettingsTemplateScope,
  SensorSettingsTemplateStore,
  SensorThresholds,
  TempHumidityThresholds,
} from '../types'
import { hash16 } from './mock'

let counter = 0
function genId(prefix: string): string {
  counter += 1
  return `${prefix}-${hash16(`${Date.now()}-${counter}-${Math.random()}`).slice(0, 8)}`
}

/* ---------- スコープ既定 ---------- */

/** 古いデータ（thresholds のみ持つ）を読み込んだとき用の既定スコープ。 */
export const DEFAULT_SCOPE_THRESHOLDS_ONLY: SensorSettingsTemplateScope = {
  thresholds: true,
  alertSettings: false,
  exclusions: false,
  notification: false,
}

/** 新規作成時の既定スコープ（閾値だけ ON、後でユーザがチェックを増やす想定）。 */
export const DEFAULT_SCOPE_NEW: SensorSettingsTemplateScope = {
  thresholds: true,
  alertSettings: false,
  exclusions: false,
  notification: false,
}

/** ロード時マイグレーション。古いテンプレ（scope なし）を新しい形へ補完する。
 *  破壊的変更を避けるため呼び出し側で再保存はしない（load 時の純粋変換）。 */
export function migrateTemplate(
  raw: SensorSettingsTemplate | (Omit<SensorSettingsTemplate, 'scope'> & { scope?: SensorSettingsTemplateScope }),
): SensorSettingsTemplate {
  if (raw.scope) return raw as SensorSettingsTemplate
  return {
    ...(raw as Omit<SensorSettingsTemplate, 'scope'>),
    scope: { ...DEFAULT_SCOPE_THRESHOLDS_ONLY },
  }
}

export function migrateTemplateStore(
  store: SensorSettingsTemplateStore | undefined,
): SensorSettingsTemplateStore {
  if (!store) return {}
  const out: SensorSettingsTemplateStore = {}
  for (const [k, v] of Object.entries(store)) {
    out[k] = migrateTemplate(v)
  }
  return out
}

/* ---------- CRUD ---------- */

/** テンプレートを新規作成する。
 *  互換のため従来の `{ name, description, targetKind, thresholds }` も受け付け、
 *  その場合は scope = { thresholds: true } として作る。 */
export function createTemplate(opts: {
  name: string
  description?: string
  targetKind: SensorKind
  scope?: SensorSettingsTemplateScope
  thresholds?: SensorThresholds
  alertSettings?: AlertSettingsForTemplate
  exclusionWindows?: SensorSettingsTemplate['exclusionWindows']
  exclusionDates?: SensorSettingsTemplate['exclusionDates']
  notificationGroupId?: string | null
}): SensorSettingsTemplate {
  const scope: SensorSettingsTemplateScope =
    opts.scope ?? {
      ...DEFAULT_SCOPE_NEW,
      thresholds: !!opts.thresholds,
    }
  return {
    id: genId('tpl'),
    name: opts.name.trim() || '無題のテンプレート',
    description: opts.description?.trim() || undefined,
    targetKind: opts.targetKind,
    scope,
    thresholds: opts.thresholds,
    alertSettings: opts.alertSettings,
    exclusionWindows: opts.exclusionWindows,
    exclusionDates: opts.exclusionDates,
    notificationGroupId: opts.notificationGroupId,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

export function upsertTemplate(
  store: SensorSettingsTemplateStore,
  template: SensorSettingsTemplate,
): SensorSettingsTemplateStore {
  return { ...store, [template.id]: { ...template, updatedAt: new Date() } }
}

export function removeTemplate(
  store: SensorSettingsTemplateStore,
  id: string,
): SensorSettingsTemplateStore {
  if (!(id in store)) return store
  const next = { ...store }
  delete next[id]
  return next
}

/* ---------- 既定テンプレート ---------- */

/** 冷蔵庫: 注意レベルが OK 範囲（0〜10℃）、危険レベルがその外側（-5〜15℃）。
 *  - 値が 0〜10℃: 正常
 *  - 値が -5〜0℃ または 10〜15℃: 注意
 *  - 値が -5℃ 未満 または 15℃ 超: 危険
 */
const REFRIG_DEFAULT: TempHumidityThresholds = {
  kind: 'temperature-humidity',
  temperature: {
    alert: { enabled: true, min: -5, max: 15 },
    warn: { enabled: true, min: 0, max: 10 },
  },
  humidity: {
    alert: { enabled: false },
    warn: { enabled: false },
  },
}

/** 冷凍庫: 注意は -35〜-10℃ の範囲、危険は「0℃ 超」のみ（下限なし）。
 *  - 値が -35〜-10℃: 正常
 *  - 値が -35℃ 未満 または -10℃〜0℃: 注意
 *  - 値が 0℃ 超: 危険
 *  下限を「なし」にすることで「冷えすぎても危険にはならない」ことを表現。
 */
const FREEZER_DEFAULT: TempHumidityThresholds = {
  kind: 'temperature-humidity',
  temperature: {
    alert: { enabled: true, max: 0 },
    warn: { enabled: true, min: -35, max: -10 },
  },
  humidity: {
    alert: { enabled: false },
    warn: { enabled: false },
  },
}

/** 既定テンプレートの固定 ID（マイグレーションで参照する） */
export const DEFAULT_TEMPLATE_IDS = {
  refrigerator: 'tpl-default-refrigerator',
  freezer: 'tpl-default-freezer',
} as const

/** 新規テナント用の初期テンプレート。冷蔵庫・冷凍庫の 2 件のみ。
 *  scope は閾値のみ ON にして、ユーザが必要に応じて他項目を ON にする想定。 */
export function buildDefaultTemplates(): SensorSettingsTemplateStore {
  const now = new Date()
  return {
    [DEFAULT_TEMPLATE_IDS.refrigerator]: {
      id: DEFAULT_TEMPLATE_IDS.refrigerator,
      name: '冷蔵庫',
      description: '注意：0℃未満 10℃より高温 / 危険：-5℃未満 15℃より高温',
      targetKind: 'temperature-humidity',
      scope: { ...DEFAULT_SCOPE_THRESHOLDS_ONLY },
      thresholds: REFRIG_DEFAULT,
      createdAt: now,
      updatedAt: now,
    },
    [DEFAULT_TEMPLATE_IDS.freezer]: {
      id: DEFAULT_TEMPLATE_IDS.freezer,
      name: '冷凍庫',
      description: '注意：-35℃未満 -10℃より高温 / 危険：0℃より高温',
      targetKind: 'temperature-humidity',
      scope: { ...DEFAULT_SCOPE_THRESHOLDS_ONLY },
      thresholds: FREEZER_DEFAULT,
      createdAt: now,
      updatedAt: now,
    },
  }
}

/* ---------- 適用ヘルパ ---------- */

/** テンプレートをセンサーに適用できるか（種別一致チェック） */
export function isTemplateApplicableToKind(
  template: SensorSettingsTemplate,
  sensorKind: SensorKind | undefined,
): boolean {
  // sensor.kind が undefined の場合は 'temperature-humidity' とみなす
  const k = sensorKind ?? 'temperature-humidity'
  return template.targetKind === k
}

/** SensorThresholds の deep clone（参照を切り離して保存） */
export function cloneThresholds(t: SensorThresholds): SensorThresholds {
  if (t.kind === 'temperature-humidity') {
    return {
      kind: 'temperature-humidity',
      temperature: { ...t.temperature },
      humidity: { ...t.humidity },
    }
  }
  // 他の kind が増えたらここで分岐する。今は素通し。
  return JSON.parse(JSON.stringify(t)) as SensorThresholds
}

/** テンプレートに含まれる scope 項目だけを sensor に適用した結果を返す。
 *  - sensor.kind が template.targetKind と一致しない場合は何もせず元の sensor を返す
 *  - 各項目は scope が true のものだけが上書きされる
 *  - 通知グループはセンサーの notificationGroupId フィールドに反映する */
export function applyTemplateToSensor(
  sensor: Sensor,
  template: SensorSettingsTemplate,
): Sensor {
  if (!isTemplateApplicableToKind(template, sensor.kind)) return sensor
  let next = sensor
  if (template.scope.thresholds && template.thresholds) {
    next = { ...next, thresholds: cloneThresholds(template.thresholds) }
  }
  if (template.scope.alertSettings && template.alertSettings) {
    // exclusion 系は別フィールド扱いなので保持する
    next = {
      ...next,
      alertSettings: {
        ...template.alertSettings,
        exclusionWindows: next.alertSettings.exclusionWindows,
        exclusionDates: next.alertSettings.exclusionDates,
      },
    }
  }
  if (template.scope.exclusions) {
    next = {
      ...next,
      alertSettings: {
        ...next.alertSettings,
        exclusionWindows: template.exclusionWindows
          ? template.exclusionWindows.map((w) => ({ ...w }))
          : [],
        exclusionDates: template.exclusionDates
          ? template.exclusionDates.map((d) => ({ ...d }))
          : [],
      },
    }
  }
  if (template.scope.notification) {
    next = { ...next, notificationGroupId: template.notificationGroupId ?? null }
  }
  return next
}

/** テンプレートに含まれる項目数（UI 表示用）。 */
export function countScope(scope: SensorSettingsTemplateScope): number {
  return (
    (scope.thresholds ? 1 : 0) +
    (scope.alertSettings ? 1 : 0) +
    (scope.exclusions ? 1 : 0) +
    (scope.notification ? 1 : 0)
  )
}

/** スコープのラベル文字列（UI 表示用、例: "閾値 + アラート発生条件"）。 */
export function describeScope(scope: SensorSettingsTemplateScope): string {
  const parts: string[] = []
  if (scope.thresholds) parts.push('閾値判定')
  if (scope.alertSettings) parts.push('アラート発生条件')
  if (scope.exclusions) parts.push('除外時間・日')
  if (scope.notification) parts.push('通知設定')
  if (parts.length === 0) return '何も含まれていません'
  return parts.join(' + ')
}
