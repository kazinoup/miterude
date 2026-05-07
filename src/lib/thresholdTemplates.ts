/**
 * 閾値テンプレート（snapshot 方式）— Phase 9.14
 *
 * 設計の要点:
 * - テンプレートは「値の生成器」。適用するとセンサーに値がコピーされ、
 *   それ以降テンプレートを編集してもセンサーには伝搬しない（再適用が必要）。
 * - 種別（SensorKind）が一致するセンサーにのみ適用できる。混在選択時は
 *   一致するものだけ更新し、それ以外はスキップする運用。
 * - 既存のセンサー個別設定（sensor.thresholds）と完全に同一の構造を持つ。
 */
import type {
  SensorKind,
  SensorThresholds,
  TempHumidityThresholds,
  ThresholdTemplate,
  ThresholdTemplateStore,
} from '../types'
import { hash16 } from './mock'

let counter = 0
function genId(prefix: string): string {
  counter += 1
  return `${prefix}-${hash16(`${Date.now()}-${counter}-${Math.random()}`).slice(0, 8)}`
}

/* ---------- CRUD ---------- */

export function createTemplate(opts: {
  name: string
  description?: string
  targetKind: SensorKind
  thresholds: SensorThresholds
}): ThresholdTemplate {
  return {
    id: genId('tpl'),
    name: opts.name.trim() || '無題のテンプレート',
    description: opts.description?.trim() || undefined,
    targetKind: opts.targetKind,
    thresholds: opts.thresholds,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

export function upsertTemplate(
  store: ThresholdTemplateStore,
  template: ThresholdTemplate,
): ThresholdTemplateStore {
  return { ...store, [template.id]: { ...template, updatedAt: new Date() } }
}

export function removeTemplate(
  store: ThresholdTemplateStore,
  id: string,
): ThresholdTemplateStore {
  if (!(id in store)) return store
  const next = { ...store }
  delete next[id]
  return next
}

/* ---------- 既定テンプレート ---------- */

const REFRIG_DEFAULT: TempHumidityThresholds = {
  kind: 'temperature-humidity',
  temperature: {
    alert: { enabled: true, min: 0, max: 10 },
    warn: { enabled: false },
  },
  humidity: {
    alert: { enabled: true, min: 40, max: 85 },
    warn: { enabled: false },
  },
}

const FREEZER_DEFAULT: TempHumidityThresholds = {
  kind: 'temperature-humidity',
  temperature: {
    alert: { enabled: true, min: -30, max: -10 },
    warn: { enabled: false },
  },
  humidity: {
    alert: { enabled: true, min: 40, max: 85 },
    warn: { enabled: false },
  },
}

/** 既定テンプレートの固定 ID（マイグレーションで参照する） */
export const DEFAULT_TEMPLATE_IDS = {
  refrigerator: 'tpl-default-refrigerator',
  freezer: 'tpl-default-freezer',
} as const

/** 新規テナント用の初期テンプレート。冷蔵庫・冷凍庫の 2 件のみ。 */
export function buildDefaultTemplates(): ThresholdTemplateStore {
  const now = new Date()
  return {
    [DEFAULT_TEMPLATE_IDS.refrigerator]: {
      id: DEFAULT_TEMPLATE_IDS.refrigerator,
      name: '冷蔵庫の管理',
      description: '0〜10℃ / 湿度 40〜85%（標準セット）',
      targetKind: 'temperature-humidity',
      thresholds: REFRIG_DEFAULT,
      createdAt: now,
      updatedAt: now,
    },
    [DEFAULT_TEMPLATE_IDS.freezer]: {
      id: DEFAULT_TEMPLATE_IDS.freezer,
      name: '冷凍庫の管理',
      description: '-30〜-10℃ / 湿度 40〜85%（標準セット）',
      targetKind: 'temperature-humidity',
      thresholds: FREEZER_DEFAULT,
      createdAt: now,
      updatedAt: now,
    },
  }
}

/* ---------- 適用ヘルパ ---------- */

/** テンプレートをセンサーに適用できるか（種別一致チェック） */
export function isTemplateApplicableToKind(
  template: ThresholdTemplate,
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
