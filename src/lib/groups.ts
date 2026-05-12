/**
 * センサーグループ・タグ・保存フィルタの操作ヘルパ — Phase 9.5
 */
import type {
  FilterConditions,
  SavedFilter,
  SavedFilterStore,
  Sensor,
  SensorGroup,
  SensorGroupStore,
  SensorStore,
} from '../types'
/** Supabase の uuid カラムに合わせて UUID で採番する。 */
function genId(_prefix: string): string {
  return crypto.randomUUID()
}

/* ---------- グループ ---------- */

export function createGroup(opts: {
  name: string
  description?: string
  color?: string
}): SensorGroup {
  return {
    id: genId('grp'),
    name: opts.name.trim() || '無題のグループ',
    description: opts.description?.trim() || undefined,
    color: opts.color,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

export function upsertGroup(
  store: SensorGroupStore,
  group: SensorGroup,
): SensorGroupStore {
  return { ...store, [group.id]: { ...group, updatedAt: new Date() } }
}

export function removeGroup(store: SensorGroupStore, id: string): SensorGroupStore {
  if (!(id in store)) return store
  const next = { ...store }
  delete next[id]
  return next
}

/* ---------- タグユーティリティ ---------- */

export function normalizeTag(t: string): string {
  return t.trim().toLowerCase().replace(/\s+/g, ' ')
}

export function uniqueTags(tags: string[]): string[] {
  const set = new Set<string>()
  const out: string[] = []
  for (const t of tags) {
    const n = normalizeTag(t)
    if (!n) continue
    if (set.has(n)) continue
    set.add(n)
    out.push(n)
  }
  return out
}

export function addTag(sensor: Sensor, tag: string): Sensor {
  const normalized = normalizeTag(tag)
  if (!normalized) return sensor
  const cur = sensor.tags ?? []
  if (cur.includes(normalized)) return sensor
  return { ...sensor, tags: [...cur, normalized] }
}

export function removeTag(sensor: Sensor, tag: string): Sensor {
  const normalized = normalizeTag(tag)
  const cur = sensor.tags ?? []
  if (!cur.includes(normalized)) return sensor
  return { ...sensor, tags: cur.filter((t) => t !== normalized) }
}

/** 全センサーから出現するタグを集計（出現回数つき・降順） */
export function collectAllTags(sensors: SensorStore): { tag: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const s of Object.values(sensors)) {
    for (const t of s.tags ?? []) {
      counts.set(t, (counts.get(t) ?? 0) + 1)
    }
  }
  return Array.from(counts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
}

/* ---------- 保存フィルタ ---------- */

export function createSavedFilter(opts: {
  name: string
  description?: string
  conditions: FilterConditions
}): SavedFilter {
  return {
    id: genId('flt'),
    name: opts.name.trim() || '保存フィルタ',
    description: opts.description?.trim() || undefined,
    conditions: opts.conditions,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

export function upsertSavedFilter(
  store: SavedFilterStore,
  filter: SavedFilter,
): SavedFilterStore {
  return { ...store, [filter.id]: { ...filter, updatedAt: new Date() } }
}

export function removeSavedFilter(
  store: SavedFilterStore,
  id: string,
): SavedFilterStore {
  if (!(id in store)) return store
  const next = { ...store }
  delete next[id]
  return next
}

/* ---------- フィルタ評価 ---------- */

function matchesText(sensor: Sensor, q: string): boolean {
  const needle = q.trim().toLowerCase()
  if (!needle) return true
  const haystack = [
    sensor.id,
    sensor.deviceNumber,
    sensor.serialNumber,
    sensor.model,
    sensor.manufacturer,
    ...(sensor.tags ?? []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  return haystack.includes(needle)
}

/** 1 つのセンサーが条件式にマッチするか */
export function sensorMatches(sensor: Sensor, c: FilterConditions): boolean {
  if (c.search && !matchesText(sensor, c.search)) return false

  if (c.groupIds && c.groupIds.length > 0) {
    const set = new Set(c.groupIds)
    if (set.has('__none__')) {
      // 未分類を許可。明示されたグループに所属しているかも OR で許可
      if (sensor.groupId && !set.has(sensor.groupId)) return false
    } else {
      if (!sensor.groupId || !set.has(sensor.groupId)) return false
    }
  }

  if (c.categoryIds && c.categoryIds.length > 0) {
    const set = new Set(c.categoryIds)
    if (set.has('__none__')) {
      // 未設定を許可。明示された区分に所属しているかも OR で許可
      if (sensor.categoryId && !set.has(sensor.categoryId)) return false
    } else {
      if (!sensor.categoryId || !set.has(sensor.categoryId)) return false
    }
  }

  const tags = sensor.tags ?? []

  if (c.tagsAnd && c.tagsAnd.length > 0) {
    for (const t of c.tagsAnd) {
      if (!tags.includes(t)) return false
    }
  }
  if (c.tagsOr && c.tagsOr.length > 0) {
    if (!c.tagsOr.some((t) => tags.includes(t))) return false
  }
  if (c.tagsNot && c.tagsNot.length > 0) {
    if (c.tagsNot.some((t) => tags.includes(t))) return false
  }

  if (c.onlineStatus === 'online' && !sensor.online) return false
  if (c.onlineStatus === 'offline' && sensor.online) return false

  if (c.gatewayIds && c.gatewayIds.length > 0) {
    if (!sensor.gatewayId || !c.gatewayIds.includes(sensor.gatewayId)) return false
  }

  if (c.sensorIdsExclude && c.sensorIdsExclude.includes(sensor.id)) return false

  // sensorIdsInclude は条件式に追加で OR される（フィルタにマッチしない場合でも個別追加）
  // → resolveFilter 側で別途処理
  return true
}

/** 条件式に一致するセンサーIDを返す（sensorIdsInclude / Exclude もここで反映） */
export function resolveFilter(
  conditions: FilterConditions,
  sensors: SensorStore,
): string[] {
  const out = new Set<string>()
  for (const s of Object.values(sensors)) {
    if (sensorMatches(s, conditions)) {
      out.add(s.id)
    }
  }
  if (conditions.sensorIdsInclude) {
    for (const id of conditions.sensorIdsInclude) {
      if (sensors[id]) out.add(id)
    }
  }
  if (conditions.sensorIdsExclude) {
    for (const id of conditions.sensorIdsExclude) {
      out.delete(id)
    }
  }
  return Array.from(out).sort()
}

/** 2 つの条件式が（実質的に）同じかどうか判定する。
 *  - undefined / 空配列 / 空文字 はすべて「未指定」として揃える
 *  - 配列はソート後に比較
 */
export function conditionsEqual(a: FilterConditions, b: FilterConditions): boolean {
  return JSON.stringify(normalizeConditions(a)) === JSON.stringify(normalizeConditions(b))
}

function sortedOrUndef(arr: string[] | undefined): string[] | undefined {
  if (!arr || arr.length === 0) return undefined
  return [...arr].sort()
}

function normalizeConditions(c: FilterConditions): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (c.search?.trim()) out.search = c.search.trim()
  const g = sortedOrUndef(c.groupIds)
  if (g) out.groupIds = g
  const ta = sortedOrUndef(c.tagsAnd)
  if (ta) out.tagsAnd = ta
  const to = sortedOrUndef(c.tagsOr)
  if (to) out.tagsOr = to
  const tn = sortedOrUndef(c.tagsNot)
  if (tn) out.tagsNot = tn
  const si = sortedOrUndef(c.sensorIdsInclude)
  if (si) out.sensorIdsInclude = si
  const se = sortedOrUndef(c.sensorIdsExclude)
  if (se) out.sensorIdsExclude = se
  const ci = sortedOrUndef(c.categoryIds)
  if (ci) out.categoryIds = ci
  if (c.onlineStatus) out.onlineStatus = c.onlineStatus
  const gw = sortedOrUndef(c.gatewayIds)
  if (gw) out.gatewayIds = gw
  return out
}

/** 条件式が空かどうか（保存ボタンの活性判定など） */
export function isEmptyConditions(c: FilterConditions): boolean {
  if (c.search?.trim()) return false
  if (c.groupIds?.length) return false
  if (c.tagsAnd?.length) return false
  if (c.tagsOr?.length) return false
  if (c.tagsNot?.length) return false
  if (c.sensorIdsInclude?.length) return false
  if (c.sensorIdsExclude?.length) return false
  if (c.categoryIds?.length) return false
  if (c.onlineStatus) return false
  if (c.gatewayIds?.length) return false
  return true
}
