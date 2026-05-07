/**
 * センサー一覧の列表示設定 — Phase 9.10
 *
 * 「名前」は固定表示（必須）。それ以外の列は表示／非表示を localStorage に永続化する。
 * 多種多様なセンサー（温湿度・PPM・kW など）を 1 つの一覧で扱えるよう、
 * 「最新値」は単一カラムにまとめ、温湿度なら "25.0℃ 50%" のように
 * スペース区切りで表示する設計を前提にしている。
 */

export type SensorColumnKey =
  | 'deviceNumber' // EUI / DV-001 形式
  | 'serialNumber' // 16 桁 HEX
  | 'model' // モデル名
  | 'manufacturer' // メーカー名
  | 'category' // 区分
  | 'group' // グループ
  | 'gateway' // 接続ゲートウェイ
  | 'tags' // タグ
  | 'status' // オンライン / オフライン
  | 'battery' // バッテリー
  | 'lastUpdated' // 最終更新（経過時刻）
  | 'latestValue' // 最新値（温湿度など）
  | 'threshold' // 逸脱設定（閾値）

export type SensorColumnVisibility = Record<SensorColumnKey, boolean>

export type SensorColumnDef = {
  key: SensorColumnKey
  label: string
  /** 列の説明（ダイアログのチェックボックスに表示） */
  hint?: string
  /** 既定で表示するか */
  defaultVisible: boolean
  /** 表示設定でのグルーピング */
  group: 'identity' | 'classify' | 'status'
}

/** 列定義（順序が一覧の表示順になる）— Phase F-3 で並び順を固定し、
 *  全列を既定で表示するように変更。 */
export const SENSOR_COLUMN_DEFS: SensorColumnDef[] = [
  {
    key: 'deviceNumber',
    label: 'デバイス番号',
    hint: 'DV-001 形式のデバイスID（EUI）',
    defaultVisible: true,
    group: 'identity',
  },
  {
    key: 'serialNumber',
    label: 'シリアル番号',
    hint: '16 桁 HEX のシリアル番号',
    defaultVisible: true,
    group: 'identity',
  },
  {
    key: 'manufacturer',
    label: 'メーカー',
    hint: 'メーカー名',
    defaultVisible: true,
    group: 'identity',
  },
  {
    key: 'model',
    label: 'モデル',
    hint: '機種名（例: EM320-TH）',
    defaultVisible: true,
    group: 'identity',
  },
  {
    key: 'category',
    label: '区分',
    defaultVisible: true,
    group: 'classify',
  },
  {
    key: 'group',
    label: 'グループ',
    defaultVisible: true,
    group: 'classify',
  },
  {
    key: 'tags',
    label: 'タグ',
    defaultVisible: true,
    group: 'classify',
  },
  {
    key: 'status',
    label: '状態',
    hint: 'オンライン / オフライン',
    defaultVisible: true,
    group: 'status',
  },
  {
    key: 'gateway',
    label: 'ゲートウェイ',
    hint: '接続されている親機（ゲートウェイ）名',
    defaultVisible: true,
    group: 'classify',
  },
  {
    key: 'latestValue',
    label: '最新値',
    hint: '温湿度なら "25.0℃ 50%" のように 1 列にまとめて表示',
    defaultVisible: true,
    group: 'status',
  },
  {
    key: 'threshold',
    label: '逸脱設定（閾値）',
    hint: '現在のセンサーで使われている逸脱判定の上下限',
    defaultVisible: true,
    group: 'status',
  },
  {
    key: 'battery',
    label: 'バッテリー',
    defaultVisible: true,
    group: 'status',
  },
  {
    key: 'lastUpdated',
    label: '最終更新',
    hint: '直近の受信からの経過時間',
    defaultVisible: true,
    group: 'status',
  },
]

/** Phase F-3 で既定列順を全更新。古い v1 永続化は無視して v2 から始める。 */
const STORAGE_KEY = 'miterude:sensors:columns:v2'

export function defaultColumnVisibility(): SensorColumnVisibility {
  const out = {} as SensorColumnVisibility
  for (const def of SENSOR_COLUMN_DEFS) {
    out[def.key] = def.defaultVisible
  }
  return out
}

export function loadColumnVisibility(): SensorColumnVisibility {
  const def = defaultColumnVisibility()
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return def
    const parsed = JSON.parse(raw) as Partial<SensorColumnVisibility>
    if (!parsed || typeof parsed !== 'object') return def
    const out = { ...def }
    for (const k of Object.keys(def) as SensorColumnKey[]) {
      if (typeof parsed[k] === 'boolean') out[k] = parsed[k] as boolean
    }
    return out
  } catch {
    return def
  }
}

export function saveColumnVisibility(v: SensorColumnVisibility): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(v))
  } catch {
    /* noop */
  }
}

/* ---------- Phase B: ワイド表示モード ---------- */

const WIDE_KEY = 'miterude:sensors:wide:v1'

export function loadWideMode(): boolean {
  try {
    const raw = localStorage.getItem(WIDE_KEY)
    return raw === '1' || raw === 'true'
  } catch {
    return false
  }
}

export function saveWideMode(v: boolean): void {
  try {
    localStorage.setItem(WIDE_KEY, v ? '1' : '0')
  } catch {
    /* noop */
  }
}

/* ---------- Phase 9.13: 列の並び順 ---------- */

/** Phase F-3 で既定列順を全更新。古い v1 永続化は無視して v2 から始める。 */
const ORDER_KEY = 'miterude:sensors:columnOrder:v2'

/** 既定の列順序（SENSOR_COLUMN_DEFS の宣言順） */
export function defaultColumnOrder(): SensorColumnKey[] {
  return SENSOR_COLUMN_DEFS.map((d) => d.key)
}

/** 永続化された列順序を読み込む。
 *  破損していれば既定値、未知のキーは無視、未含有のキーは末尾に追加（後方互換）。 */
export function loadColumnOrder(): SensorColumnKey[] {
  const def = defaultColumnOrder()
  try {
    const raw = localStorage.getItem(ORDER_KEY)
    if (!raw) return def
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return def
    const validSet = new Set<SensorColumnKey>(def)
    const seen = new Set<SensorColumnKey>()
    const valid: SensorColumnKey[] = []
    for (const k of parsed) {
      if (typeof k === 'string' && validSet.has(k as SensorColumnKey) && !seen.has(k as SensorColumnKey)) {
        valid.push(k as SensorColumnKey)
        seen.add(k as SensorColumnKey)
      }
    }
    // 未含有のキー（新規追加された列など）を末尾に補完
    for (const k of def) {
      if (!seen.has(k)) valid.push(k)
    }
    return valid
  } catch {
    return def
  }
}

export function saveColumnOrder(order: SensorColumnKey[]): void {
  try {
    localStorage.setItem(ORDER_KEY, JSON.stringify(order))
  } catch {
    /* noop */
  }
}
