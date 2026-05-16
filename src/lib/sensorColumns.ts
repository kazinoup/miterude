/**
 * センサー一覧の列表示・並び順設定 — Phase F-3 改訂
 *
 * 「名称」（旧「名前」）は左端固定（必須）。
 * それ以外の列は表示／非表示・並び順を localStorage に永続化する。
 *
 * 多種多様なセンサー（温湿度・PPM・kW など）を 1 つの一覧で扱えるよう、
 * 「最新値」は単一カラムにまとめ、温湿度なら "25.0℃ 50%" のように
 * スペース区切りで表示する設計を前提にしている。
 */

export type SensorColumnKey =
  | 'deviceNumber' // EUI / DV-001 形式
  | 'serialNumber' // 16 桁 HEX
  | 'devEUI' // LoRaWAN 識別子
  | 'model' // モデル名
  | 'manufacturer' // メーカー名
  | 'category' // 区分
  | 'group' // グループ / 設置場所
  | 'gateway' // 接続ゲートウェイ
  | 'tags' // タグ
  | 'status' // オンライン / オフライン
  | 'battery' // バッテリー残量
  | 'lastUpdated' // 最新受信日時
  | 'latestValue' // 最新値（温湿度など）
  | 'threshold' // 逸脱設定（閾値）
  | 'deviationAlert' // 連続逸脱アラート設定
  | 'offlineAlert' // オフラインアラート設定
  | 'batteryAlert' // バッテリーアラート設定
  | 'silentTimeRanges' // アラート停止時間帯
  | 'silentDates' // アラート停止日
  | 'notificationSetting' // 通知設定（紐付き通知グループ名）
  | 'registeredAt' // 登録日

export type SensorColumnVisibility = Record<SensorColumnKey, boolean>

export type SensorColumnDef = {
  key: SensorColumnKey
  label: string
  /** 列の説明（ダイアログのチェックボックスに表示） */
  hint?: string
  /** 既定で表示するか */
  defaultVisible: boolean
  /** 表示設定でのグルーピング */
  group: 'identity' | 'classify' | 'status' | 'alert'
}

/** 列定義（順序が一覧の表示順になる）。
 *  v3 で「名称」固定列、DevEUI / 登録日 / アラート設定詳細列を追加し、
 *  既定の表示順を仕様に合わせて再構成した。 */
export const SENSOR_COLUMN_DEFS: SensorColumnDef[] = [
  // 表示既定 ON（左から）
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
    key: 'devEUI',
    label: 'DevEUI',
    hint: 'LoRaWAN 識別子（16 字 HEX 大文字）',
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
    label: 'グループ / 設置場所',
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
    key: 'latestValue',
    label: '最新値',
    hint: '温湿度なら "25.0℃ 50%" のように 1 列にまとめて表示',
    defaultVisible: true,
    group: 'status',
  },
  {
    key: 'lastUpdated',
    label: '最新受信日時',
    hint: '直近の受信日時（経過時間）',
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
    key: 'threshold',
    label: '逸脱設定（閾値）',
    hint: '現在のセンサーで使われている逸脱判定の上下限',
    defaultVisible: true,
    group: 'status',
  },

  // 表示既定 OFF
  {
    key: 'gateway',
    label: 'ゲートウェイ',
    hint: '接続されている親機（ゲートウェイ）名',
    defaultVisible: false,
    group: 'classify',
  },
  {
    key: 'manufacturer',
    label: 'メーカー',
    hint: 'メーカー名',
    defaultVisible: false,
    group: 'identity',
  },
  {
    key: 'model',
    label: 'モデル',
    hint: '機種名（例: EM320-TH）',
    defaultVisible: false,
    group: 'identity',
  },
  {
    key: 'deviationAlert',
    label: '連続逸脱アラート',
    hint: '連続逸脱通知の有効/無効と発火条件',
    defaultVisible: false,
    group: 'alert',
  },
  {
    key: 'offlineAlert',
    label: 'オフラインアラート',
    hint: 'オフライン通知の有効/無効と判定時間',
    defaultVisible: false,
    group: 'alert',
  },
  {
    key: 'batteryAlert',
    label: 'バッテリーアラート',
    hint: 'バッテリー残量低下通知の有効/無効と閾値',
    defaultVisible: false,
    group: 'alert',
  },
  {
    key: 'silentTimeRanges',
    label: 'アラート停止時間帯',
    hint: '通知を抑制する時間帯（曜日 + HH:MM〜HH:MM）の件数',
    defaultVisible: false,
    group: 'alert',
  },
  {
    key: 'silentDates',
    label: 'アラート停止日',
    hint: '通知を抑制する特定日付範囲の件数',
    defaultVisible: false,
    group: 'alert',
  },
  {
    key: 'notificationSetting',
    label: '通知設定',
    hint: '紐付いている通知グループ名',
    defaultVisible: false,
    group: 'alert',
  },
  {
    key: 'registeredAt',
    label: '登録日',
    hint: 'このセンサーを登録した日付',
    defaultVisible: false,
    group: 'identity',
  },
]

/** Phase F-3 改訂で列キーを大幅追加したため v3 へ。
 *  古い v1/v2 永続化は捨てて新しい既定を採用する。 */
const STORAGE_KEY = 'miterude:sensors:columns:v3'

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

/* ---------- Phase 9.13: 列の並び順 ---------- */

const ORDER_KEY = 'miterude:sensors:columnOrder:v3'

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
