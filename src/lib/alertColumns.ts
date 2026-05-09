/**
 * アラート一覧の列表示・並び順設定 — Phase（センサー一覧と同じ仕組み）
 *
 * 「発生日時」は左端固定（必須）。それ以外の列は表示／非表示・並び順を localStorage に永続化する。
 */

export type AlertColumnKey =
  | 'kind' // アラート種別（バッジ）
  | 'deviceName' // デバイス名
  | 'deviceNumber' // デバイス番号（センサー番号 or シリアル）
  | 'message' // 内容（説明文）
  | 'confirmComment' // 確認メモ（ダッシュボード確認時に記録されるメモ）
  | 'category' // 区分（センサーターゲットのみ）
  | 'group' // グループ / 設置場所（センサーターゲットのみ）
  | 'tags' // タグ（センサーターゲットのみ）
  | 'manufacturer' // メーカー
  | 'model' // モデル

export type AlertColumnVisibility = Record<AlertColumnKey, boolean>

export type AlertColumnDef = {
  key: AlertColumnKey
  label: string
  hint?: string
  defaultVisible: boolean
}

/** 列の並びと既定の表示状態。「発生日時」は左端固定なのでこの配列には含めない。 */
export const ALERT_COLUMN_DEFS: AlertColumnDef[] = [
  {
    key: 'kind',
    label: 'アラート種別',
    hint: '逸脱（危険）/ 逸脱（注意）/ オフライン / バッテリー残量',
    defaultVisible: true,
  },
  {
    key: 'deviceName',
    label: 'デバイス名',
    hint: 'センサー / ゲートウェイの名称',
    defaultVisible: true,
  },
  {
    key: 'deviceNumber',
    label: 'デバイス番号',
    hint: 'センサー番号 / シリアル番号',
    defaultVisible: true,
  },
  {
    key: 'message',
    label: '内容',
    hint: '何がどう逸脱したかの 1 行説明',
    defaultVisible: true,
  },
  {
    key: 'confirmComment',
    label: '確認メモ',
    hint: 'ダッシュボード確認記録から連携されたメモ',
    defaultVisible: true,
  },
  {
    key: 'category',
    label: '区分',
    hint: 'センサー個別の区分（ターゲットがセンサー時のみ）',
    defaultVisible: false,
  },
  {
    key: 'group',
    label: 'グループ / 設置場所',
    hint: 'センサーが属するグループ / 設置場所',
    defaultVisible: false,
  },
  {
    key: 'tags',
    label: 'タグ',
    hint: 'センサーに付与されたタグ',
    defaultVisible: false,
  },
  {
    key: 'manufacturer',
    label: 'メーカー',
    defaultVisible: false,
  },
  {
    key: 'model',
    label: 'モデル',
    defaultVisible: false,
  },
]

/* v2: 列キー再編成（targetDevice → deviceName + deviceNumber、sensorNumber/serialNumber 廃止）に
   伴い、旧キーが localStorage に残っていても読み込み側でフィルタされるよう
   ストレージキーを更新。 */
const STORAGE_KEY = 'miterude:alerts:columns:v2'
const ORDER_KEY = 'miterude:alerts:columnOrder:v2'

export function defaultColumnVisibility(): AlertColumnVisibility {
  const out = {} as AlertColumnVisibility
  for (const def of ALERT_COLUMN_DEFS) {
    out[def.key] = def.defaultVisible
  }
  return out
}

export function loadColumnVisibility(): AlertColumnVisibility {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultColumnVisibility()
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return defaultColumnVisibility()
    const out = defaultColumnVisibility()
    for (const k of Object.keys(out) as AlertColumnKey[]) {
      if (typeof parsed[k] === 'boolean') out[k] = parsed[k]
    }
    return out
  } catch {
    return defaultColumnVisibility()
  }
}

export function saveColumnVisibility(v: AlertColumnVisibility): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(v))
  } catch {
    /* noop */
  }
}

export function defaultColumnOrder(): AlertColumnKey[] {
  return ALERT_COLUMN_DEFS.map((d) => d.key)
}

export function loadColumnOrder(): AlertColumnKey[] {
  const def = defaultColumnOrder()
  try {
    const raw = localStorage.getItem(ORDER_KEY)
    if (!raw) return def
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return def
    const validSet = new Set<AlertColumnKey>(def)
    const seen = new Set<AlertColumnKey>()
    const valid: AlertColumnKey[] = []
    for (const k of parsed) {
      if (
        typeof k === 'string' &&
        validSet.has(k as AlertColumnKey) &&
        !seen.has(k as AlertColumnKey)
      ) {
        valid.push(k as AlertColumnKey)
        seen.add(k as AlertColumnKey)
      }
    }
    for (const k of def) {
      if (!seen.has(k)) valid.push(k)
    }
    return valid
  } catch {
    return def
  }
}

export function saveColumnOrder(order: AlertColumnKey[]): void {
  try {
    localStorage.setItem(ORDER_KEY, JSON.stringify(order))
  } catch {
    /* noop */
  }
}
