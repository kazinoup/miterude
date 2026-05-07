/**
 * ゲートウェイ一覧の列表示・並び順設定 — Phase: センサー一覧と同等の列カスタマイズを提供。
 *
 * 「名前」は固定表示（必須）。それ以外の列は表示／非表示・並び順を localStorage に永続化する。
 * パターンは sensorColumns.ts と揃えてあるので、両者を見比べると差分が分かりやすい。
 */

export type GatewayColumnKey =
  | 'id' // ゲートウェイ ID
  | 'manufacturer' // メーカー
  | 'model' // モデル
  | 'serialNumber' // シリアル番号
  | 'location' // 設置場所
  | 'linkedCount' // 接続センサー台数

export type GatewayColumnVisibility = Record<GatewayColumnKey, boolean>

export type GatewayColumnDef = {
  key: GatewayColumnKey
  label: string
  /** 列の説明（ダイアログのチェックボックスに表示） */
  hint?: string
  /** 既定で表示するか */
  defaultVisible: boolean
  /** 数値・カウント列（右寄せ） */
  numeric?: boolean
}

/** 列定義（順序が一覧の表示順になる） */
export const GATEWAY_COLUMN_DEFS: GatewayColumnDef[] = [
  {
    key: 'id',
    label: 'ID',
    hint: 'ゲートウェイ識別子',
    defaultVisible: true,
  },
  {
    key: 'manufacturer',
    label: 'メーカー',
    hint: 'メーカー名（例: Milesight）',
    defaultVisible: true,
  },
  {
    key: 'model',
    label: 'モデル',
    hint: '機種名（例: UG65）',
    defaultVisible: true,
  },
  {
    key: 'serialNumber',
    label: 'シリアル番号',
    hint: '16 桁 HEX のシリアル番号',
    defaultVisible: true,
  },
  {
    key: 'location',
    label: '設置場所',
    hint: 'メモ的な設置場所（例: 1F、厨房）',
    defaultVisible: true,
  },
  {
    key: 'linkedCount',
    label: '接続センサー',
    hint: '接続されているセンサーの台数',
    defaultVisible: true,
    numeric: true,
  },
]

const STORAGE_KEY = 'miterude:gateways:columns:v1'
const ORDER_KEY = 'miterude:gateways:columnOrder:v1'

export function defaultColumnVisibility(): GatewayColumnVisibility {
  const out = {} as GatewayColumnVisibility
  for (const def of GATEWAY_COLUMN_DEFS) {
    out[def.key] = def.defaultVisible
  }
  return out
}

export function loadColumnVisibility(): GatewayColumnVisibility {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultColumnVisibility()
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return defaultColumnVisibility()
    const out = defaultColumnVisibility()
    for (const k of Object.keys(out) as GatewayColumnKey[]) {
      if (typeof parsed[k] === 'boolean') out[k] = parsed[k]
    }
    return out
  } catch {
    return defaultColumnVisibility()
  }
}

export function saveColumnVisibility(v: GatewayColumnVisibility): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(v))
  } catch {
    /* noop */
  }
}

export function defaultColumnOrder(): GatewayColumnKey[] {
  return GATEWAY_COLUMN_DEFS.map((d) => d.key)
}

export function loadColumnOrder(): GatewayColumnKey[] {
  const def = defaultColumnOrder()
  try {
    const raw = localStorage.getItem(ORDER_KEY)
    if (!raw) return def
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return def
    const validSet = new Set<GatewayColumnKey>(def)
    const seen = new Set<GatewayColumnKey>()
    const valid: GatewayColumnKey[] = []
    for (const k of parsed) {
      if (
        typeof k === 'string' &&
        validSet.has(k as GatewayColumnKey) &&
        !seen.has(k as GatewayColumnKey)
      ) {
        valid.push(k as GatewayColumnKey)
        seen.add(k as GatewayColumnKey)
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

export function saveColumnOrder(order: GatewayColumnKey[]): void {
  try {
    localStorage.setItem(ORDER_KEY, JSON.stringify(order))
  } catch {
    /* noop */
  }
}
