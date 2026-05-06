/**
 * センサー区分（SensorCategory）操作ヘルパ — Phase 9.9
 *
 * 区分は「1 センサー = 1 区分」のユーザー定義分類軸。
 * デフォルトでは「冷凍 / 冷蔵 / 室温」の 3 つを用意し、
 * 既存センサーは inferStorageKind の結果に応じて自動アサインする。
 */
import type {
  CategoryIconKey,
  SensorCategory,
  SensorCategoryStore,
  SensorStore,
  StorageKind,
} from '../types'
import { hash16 } from './mock'

let counter = 0
function genId(prefix: string): string {
  counter += 1
  return `${prefix}-${hash16(`${Date.now()}-${counter}-${Math.random()}`).slice(0, 8)}`
}

/* ---------- アイコン ---------- */

import {
  Snowflake,
  Refrigerator,
  Home,
  Flame,
  Thermometer,
  Droplets,
  Zap,
  DoorOpen,
  Package,
  Wheat,
  Wind,
  Gauge,
  Box,
  Tag,
  Activity,
  Star,
  type LucideIcon,
} from 'lucide-react'

/** lucide アイコンキー → コンポーネントのマップ */
export const CATEGORY_ICON_COMPONENTS: Record<CategoryIconKey, LucideIcon> = {
  snowflake: Snowflake,
  refrigerator: Refrigerator,
  home: Home,
  flame: Flame,
  thermometer: Thermometer,
  droplets: Droplets,
  zap: Zap,
  'door-open': DoorOpen,
  package: Package,
  wheat: Wheat,
  wind: Wind,
  gauge: Gauge,
  box: Box,
  tag: Tag,
  activity: Activity,
  star: Star,
}

/** アイコンキー → 日本語ラベル（補助、ピッカー表示用） */
export const CATEGORY_ICON_LABELS: Record<CategoryIconKey, string> = {
  snowflake: '雪',
  refrigerator: '冷蔵庫',
  home: '家',
  flame: '炎',
  thermometer: '温度計',
  droplets: '水滴',
  zap: '電気',
  'door-open': '扉',
  package: '荷物',
  wheat: '小麦',
  wind: '風',
  gauge: 'メーター',
  box: '箱',
  tag: 'タグ',
  activity: '波形',
  star: '星',
}

/* ---------- CRUD ---------- */

export function createCategory(opts: {
  name: string
  icon: CategoryIconKey
  description?: string
}): SensorCategory {
  return {
    id: genId('cat'),
    name: opts.name.trim() || '無題の区分',
    icon: opts.icon,
    description: opts.description?.trim() || undefined,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

export function upsertCategory(
  store: SensorCategoryStore,
  cat: SensorCategory,
): SensorCategoryStore {
  return { ...store, [cat.id]: { ...cat, updatedAt: new Date() } }
}

export function removeCategory(
  store: SensorCategoryStore,
  id: string,
): SensorCategoryStore {
  if (!(id in store)) return store
  const next = { ...store }
  delete next[id]
  return next
}

/* ---------- デフォルト区分 ---------- */

/** デフォルト区分の固定 ID（マイグレーションでも参照する） */
export const DEFAULT_CATEGORY_IDS = {
  freezer: 'cat-default-freezer',
  refrigerator: 'cat-default-refrigerator',
  other: 'cat-default-other',
} as const

/** 初期データとして用意する区分（冷凍 / 冷蔵 / 室温） */
export function buildDefaultCategories(): SensorCategoryStore {
  const now = new Date()
  return {
    [DEFAULT_CATEGORY_IDS.freezer]: {
      id: DEFAULT_CATEGORY_IDS.freezer,
      name: '冷凍',
      icon: 'snowflake',
      description: '冷凍庫・フリーザー（標準セット）',
      createdAt: now,
      updatedAt: now,
    },
    [DEFAULT_CATEGORY_IDS.refrigerator]: {
      id: DEFAULT_CATEGORY_IDS.refrigerator,
      name: '冷蔵',
      icon: 'refrigerator',
      description: '冷蔵庫・チルド（標準セット）',
      createdAt: now,
      updatedAt: now,
    },
    [DEFAULT_CATEGORY_IDS.other]: {
      id: DEFAULT_CATEGORY_IDS.other,
      name: '室温',
      icon: 'home',
      description: '室温・常温保管（標準セット）',
      createdAt: now,
      updatedAt: now,
    },
  }
}

/** StorageKind → デフォルト区分ID への対応 */
export function defaultCategoryIdForKind(kind: StorageKind): string {
  switch (kind) {
    case 'freezer':
      return DEFAULT_CATEGORY_IDS.freezer
    case 'refrigerator':
      return DEFAULT_CATEGORY_IDS.refrigerator
    default:
      return DEFAULT_CATEGORY_IDS.other
  }
}

/** ストアに「デフォルトの 3 区分」が含まれているかどうか */
export function hasDefaultCategories(store: SensorCategoryStore): boolean {
  return (
    DEFAULT_CATEGORY_IDS.freezer in store ||
    DEFAULT_CATEGORY_IDS.refrigerator in store ||
    DEFAULT_CATEGORY_IDS.other in store
  )
}

/** デフォルトの 3 区分を「無ければだけ」追加する。既存ユーザー編集は壊さない。 */
export function ensureDefaultCategories(
  store: SensorCategoryStore,
): SensorCategoryStore {
  if (Object.keys(store).length > 0) return store
  return buildDefaultCategories()
}

/* ---------- 検索ユーティリティ ---------- */

/** 区分IDの集計（センサー数）。未設定は '__none__' に積む。 */
export function categorySensorCounts(
  sensors: SensorStore,
): Map<string, number> {
  const counts = new Map<string, number>()
  for (const s of Object.values(sensors)) {
    const key = s.categoryId ?? '__none__'
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}
