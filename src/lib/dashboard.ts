/**
 * ダッシュボード／ウィジェットの作成・編集ヘルパ — Phase 5 (Phase 9 で再構成)
 *
 * Phase 9 の方針:
 * - ダッシュボード自体が「対象センサー集合 ＋ 既定期間」のテンプレート。
 * - ウィジェットの sensorIds はダッシュボードの targetSensorIds の部分集合として扱う
 *   （空配列なら「ダッシュボードの全センサー」を意味する）。
 */
import type {
  ChartMetric,
  ChartWidget,
  Dashboard,
  DashboardDefaultPeriod,
  DashboardStore,
  DeviationWidget,
  MapWidget,
  SensorPin,
  SensorStore,
  TileWidget,
  Widget,
  WidgetSpan,
} from '../types'
/** Dashboard / Widget の ID。dashboards テーブルが uuid を要求するので
 *  Supabase 整合のため UUID で採番する。widget ID は jsonb 内部なので緩いが、
 *  揃えるためここで一括 UUID 化する。 */
export function genId(_prefix: string): string {
  return crypto.randomUUID()
}

/** ウィジェットに表示する有効なセンサーID集合を返す。
 *  空配列やダッシュボード対象外のものを除外したうえで返す。
 *  ウィジェットの sensorIds が空の場合はダッシュボード全件を返す。
 */
export function effectiveSensorIds(widget: Widget, dashboard: Dashboard): string[] {
  const target = new Set(dashboard.targetSensorIds)
  const filtered = widget.sensorIds.filter((id) => target.has(id))
  if (filtered.length === 0) return [...dashboard.targetSensorIds]
  return filtered
}

export function createTileWidget(opts: {
  sensorIds?: string[]
  title?: string
  span?: WidgetSpan
}): TileWidget {
  return {
    id: genId('w'),
    type: 'tiles',
    title: opts.title?.trim() || '最新計測',
    sensorIds: opts.sensorIds ?? [],
    span: opts.span ?? 'full',
  }
}

export function createChartWidget(opts: {
  sensorIds?: string[]
  metric: ChartMetric
  title?: string
  span?: WidgetSpan
}): ChartWidget {
  return {
    id: genId('w'),
    type: 'chart',
    title:
      opts.title?.trim() ||
      (opts.metric === 'temperature' ? '温度推移' : '湿度推移'),
    sensorIds: opts.sensorIds ?? [],
    metric: opts.metric,
    span: opts.span ?? 'full',
  }
}

export function createDeviationWidget(opts: {
  sensorIds?: string[]
  title?: string
  span?: WidgetSpan
}): DeviationWidget {
  return {
    id: genId('w'),
    type: 'deviation',
    title: opts.title?.trim() || '逸脱ピックアップ',
    sensorIds: opts.sensorIds ?? [],
    span: opts.span ?? 'full',
  }
}

/** ピンのデフォルト配置（グリッド状） */
export function defaultPins(sensorIds: string[]): SensorPin[] {
  if (sensorIds.length === 0) return []
  const cols = Math.max(1, Math.ceil(Math.sqrt(sensorIds.length)))
  const rows = Math.max(1, Math.ceil(sensorIds.length / cols))
  return sensorIds.map((id, i) => {
    const col = i % cols
    const row = Math.floor(i / cols)
    return {
      sensorId: id,
      x: (col + 0.5) / cols,
      y: (row + 0.5) / rows,
      size: 'md' as const,
      display: 'both' as const,
    }
  })
}

export function ensurePinDefaults(p: SensorPin): SensorPin {
  return {
    ...p,
    size: p.size ?? 'md',
    display: p.display ?? 'both',
  }
}

export function syncPins(prevPins: SensorPin[], sensorIds: string[]): SensorPin[] {
  const map = new Map(prevPins.map((p) => [p.sensorId, ensurePinDefaults(p)]))
  const newOnes: string[] = []
  const result: SensorPin[] = []
  for (const id of sensorIds) {
    const existing = map.get(id)
    if (existing) {
      result.push(existing)
    } else {
      newOnes.push(id)
    }
  }
  if (newOnes.length > 0) {
    result.push(...defaultPins(newOnes))
  }
  return result
}

export function createMapWidget(opts: {
  sensorIds?: string[]
  imageUrl?: string
  title?: string
  span?: WidgetSpan
  pins?: SensorPin[]
}): MapWidget {
  const sids = opts.sensorIds ?? []
  return {
    id: genId('w'),
    type: 'map',
    title: opts.title?.trim() || 'フロアマップ',
    imageUrl: opts.imageUrl ?? '',
    sensorIds: sids,
    pins: opts.pins ?? defaultPins(sids),
    span: opts.span ?? 'full',
  }
}

export function createDashboard(opts: {
  name: string
  description?: string
  targetSensorIds?: string[]
  defaultPeriod?: DashboardDefaultPeriod
  widgets?: Widget[]
}): Dashboard {
  return {
    id: genId('d'),
    name: opts.name.trim() || '新しいダッシュボード',
    description: opts.description?.trim() || undefined,
    targetSensorIds: opts.targetSensorIds ?? [],
    defaultPeriod: opts.defaultPeriod ?? { type: 'day' },
    widgets: opts.widgets ?? [],
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

/** 初回登録センサーがある場合の既定ダッシュボード */
export function buildDefaultDashboard(sensors: SensorStore): Dashboard {
  const ids = Object.keys(sensors).sort()
  const widgets: Widget[] = []
  if (ids.length > 0) {
    widgets.push(
      createTileWidget({
        title: '全センサーの最新計測',
        span: 'full',
      }),
    )
    widgets.push(
      createDeviationWidget({
        title: '期間内の逸脱ピックアップ',
        span: 'full',
      }),
    )
    if (ids.length >= 2) {
      widgets.push(
        createChartWidget({
          metric: 'temperature',
          title: '温度推移',
          span: 'full',
        }),
      )
    }
  }
  return createDashboard({
    name: 'メインダッシュボード',
    description: '取り込んだ全センサーの概況です。',
    targetSensorIds: ids,
    defaultPeriod: { type: 'day' },
    widgets,
  })
}

/* ----------- Store 操作（イミュータブル） ----------- */

export function upsertDashboard(
  store: DashboardStore,
  dashboard: Dashboard,
): DashboardStore {
  return { ...store, [dashboard.id]: { ...dashboard, updatedAt: new Date() } }
}

export function deleteDashboard(store: DashboardStore, id: string): DashboardStore {
  if (!(id in store)) return store
  const next = { ...store }
  delete next[id]
  return next
}

export function addWidget(d: Dashboard, w: Widget): Dashboard {
  return { ...d, widgets: [...d.widgets, w], updatedAt: new Date() }
}

export function updateWidget(d: Dashboard, w: Widget): Dashboard {
  return {
    ...d,
    widgets: d.widgets.map((x) => (x.id === w.id ? w : x)),
    updatedAt: new Date(),
  }
}

export function removeWidget(d: Dashboard, widgetId: string): Dashboard {
  return {
    ...d,
    widgets: d.widgets.filter((w) => w.id !== widgetId),
    updatedAt: new Date(),
  }
}

export function moveWidget(d: Dashboard, widgetId: string, delta: -1 | 1): Dashboard {
  const idx = d.widgets.findIndex((w) => w.id === widgetId)
  if (idx < 0) return d
  const target = idx + delta
  if (target < 0 || target >= d.widgets.length) return d
  const widgets = [...d.widgets]
  ;[widgets[idx], widgets[target]] = [widgets[target], widgets[idx]]
  return { ...d, widgets, updatedAt: new Date() }
}

/** センサー削除時にすべてのダッシュボードから参照を取り除く（Phase 9 版）
 *  - targetSensorIds: 無効なIDを除外
 *  - widget.sensorIds: 無効なIDを除外
 *  - map.pins: 無効なIDのピンを除外
 */
export function pruneSensorRefs(
  store: DashboardStore,
  validSensorIds: Set<string>,
): DashboardStore {
  let changed = false
  const next: DashboardStore = {}
  for (const [id, d] of Object.entries(store)) {
    let dashChanged = false
    const filteredTarget = d.targetSensorIds.filter((sid) => validSensorIds.has(sid))
    if (filteredTarget.length !== d.targetSensorIds.length) dashChanged = true

    const nextWidgets: Widget[] = d.widgets.map((w) => {
      const fSensors = w.sensorIds.filter((sid) => validSensorIds.has(sid))
      let nextW: Widget = w
      if (fSensors.length !== w.sensorIds.length) {
        nextW = { ...w, sensorIds: fSensors } as Widget
        dashChanged = true
      }
      if (nextW.type === 'map') {
        const filteredPins = nextW.pins.filter((p) => validSensorIds.has(p.sensorId))
        if (filteredPins.length !== nextW.pins.length) {
          nextW = { ...nextW, pins: filteredPins }
          dashChanged = true
        }
      }
      return nextW
    })

    if (dashChanged) {
      changed = true
      next[id] = {
        ...d,
        targetSensorIds: filteredTarget,
        widgets: nextWidgets,
        updatedAt: new Date(),
      }
    } else {
      next[id] = d
    }
  }
  return changed ? next : store
}
