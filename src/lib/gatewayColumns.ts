/**
 * ゲートウェイ一覧の列表示・並び順設定 — Phase F-3 改訂
 *
 * 「名称」（旧「名前」）は左端固定（必須）。
 * それ以外の列は表示／非表示・並び順を localStorage に永続化する。
 *
 * センサー一覧と同じパターンで作ってあるので sensorColumns.ts と見比べると
 * 差分が分かりやすい（ゲートウェイには温湿度・バッテリーが無いため、
 * 関連列は省略する）。
 */

export type GatewayColumnKey =
  | 'deviceNumber' // デバイス番号
  | 'serialNumber' // 製造シリアル
  | 'devEUI' // LoRaWAN 識別子
  | 'model' // モデル名
  | 'manufacturer' // メーカー
  | 'category' // 区分（親機 / 中継機）
  | 'group' // グループ / 設置場所
  | 'tags' // タグ
  | 'status' // オンライン / オフライン
  | 'offlineAlert' // オフラインアラート設定
  | 'silentTimeRanges' // アラート停止時間帯
  | 'silentDates' // アラート停止日
  | 'notificationSetting' // 通知設定（紐付き通知グループ名）
  | 'registeredAt' // 登録日

export type GatewayColumnVisibility = Record<GatewayColumnKey, boolean>

export type GatewayColumnDef = {
  key: GatewayColumnKey
  label: string
  hint?: string
  defaultVisible: boolean
  /** 数値・カウント列（右寄せ） */
  numeric?: boolean
}

/** 列定義（順序が一覧の表示順になる）。
 *  v2 で「名称」固定列 + DevEUI / 区分 / グループ / タグ / 状態 /
 *  アラート設定詳細 / 登録日 を追加した。 */
export const GATEWAY_COLUMN_DEFS: GatewayColumnDef[] = [
  // 表示既定 ON
  {
    key: 'deviceNumber',
    label: 'デバイス番号',
    hint: 'GW-001 形式のデバイスID',
    defaultVisible: true,
  },
  {
    key: 'serialNumber',
    label: 'シリアル番号',
    hint: '製造シリアル',
    defaultVisible: true,
  },
  {
    key: 'devEUI',
    label: 'DevEUI',
    hint: 'LoRaWAN 識別子（16 字 HEX）',
    defaultVisible: true,
  },
  {
    key: 'category',
    label: '区分',
    hint: '親機 / 中継機',
    defaultVisible: true,
  },
  {
    key: 'group',
    label: 'グループ / 設置場所',
    defaultVisible: true,
  },
  {
    key: 'tags',
    label: 'タグ',
    defaultVisible: true,
  },
  {
    key: 'status',
    label: '状態',
    hint: 'オンライン / オフライン',
    defaultVisible: true,
  },

  // 表示既定 OFF
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
  {
    key: 'offlineAlert',
    label: 'オフラインアラート',
    hint: 'オフライン通知の有効/無効と判定時間',
    defaultVisible: false,
  },
  {
    key: 'silentTimeRanges',
    label: 'アラート停止時間帯',
    hint: '通知を抑制する時間帯の件数',
    defaultVisible: false,
    numeric: true,
  },
  {
    key: 'silentDates',
    label: 'アラート停止日',
    hint: '通知を抑制する特定日付範囲の件数',
    defaultVisible: false,
    numeric: true,
  },
  {
    key: 'notificationSetting',
    label: '通知設定',
    hint: '紐付いている通知グループ名',
    defaultVisible: false,
  },
  {
    key: 'registeredAt',
    label: '登録日',
    hint: 'このゲートウェイを登録した日付',
    defaultVisible: false,
  },
]

/** v2 で列キーを大幅変更したため、古い v1 永続化は捨てる。 */
const STORAGE_KEY = 'miterude:gateways:columns:v2'
const ORDER_KEY = 'miterude:gateways:columnOrder:v2'

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
