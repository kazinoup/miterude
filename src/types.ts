/** 1行のセンサー計測（CSV取込後） */
export type SensorReading = {
  deviceId: string
  measuredAt: Date
  temperature: number
  humidity: number
  battery?: number
}

/** デバイスごとの疑似DB */
export type DeviceStore = Record<string, SensorReading[]>

/** 当月の平均温度から推定する庫内区分（レポートのラベル等の表示用に残置）。
 *  Phase 9.11 以降、逸脱判定は各センサーの thresholds を直接参照するため、
 *  この値は閾値判定には関与しない。 */
export type StorageKind = 'refrigerator' | 'freezer' | 'other'

/* ---------- センサー個別の閾値 (Phase 9.11) ----------
 * 旧 ReportThresholds（区分別の共通閾値）は廃止し、各センサーが自分の閾値を持つ。
 * 「未設定」(thresholds: undefined) のセンサーは逸脱判定を行わない。
 * 警告レベルは 2 段階で、注意 (warn) はオレンジ、危険 (alert) は赤で表示する。
 */

/** 1 段階の閾値レベル（危険 / 注意 など）。
 *  下限・上限はそれぞれ独立に設定でき、片方だけ／両方／どちらも未設定を表現できる。
 *  下限のみ → 「N℃ 以下なら NG」
 *  上限のみ → 「N℃ 以上なら NG」
 *  両方     → 範囲外で NG
 *  どちらもなし → そのレベルでは判定しない（enabled=false と同義）
 */
export type ThresholdLevel = {
  /** false のときこのレベルは判定しない */
  enabled: boolean
  /** 下限（任意）— これを下回るとこのレベル */
  min?: number
  /** 上限（任意）— これを超えるとこのレベル */
  max?: number
}

/** 1 つの計測指標（温度・湿度・電流など）の閾値 — 危険 + 注意 の 2 レベル */
export type ThresholdMetric = {
  /** 危険レベル（赤） */
  alert: ThresholdLevel
  /** 注意レベル（オレンジ） */
  warn: ThresholdLevel
}

/** 温湿度センサー用の閾値 */
export type TempHumidityThresholds = {
  kind: 'temperature-humidity'
  temperature: ThresholdMetric
  humidity: ThresholdMetric
}

/** 将来追加予定: 電流センサー用 */
export type CurrentSensorThresholds = {
  kind: 'current'
  /** 雛形のみ。実装時に設計する */
  current: ThresholdMetric
}

/** 将来追加予定: ドアセンサー用（開閉時間など） */
export type DoorSensorThresholds = {
  kind: 'door'
  /** 雛形のみ */
}

/** 将来追加予定: 水位センサー用 */
export type WaterLevelSensorThresholds = {
  kind: 'water-level'
  level: ThresholdMetric
}

/** 将来追加予定: アナログメーター用 */
export type AnalogMeterSensorThresholds = {
  kind: 'analog-meter'
  value: ThresholdMetric
}

/** センサー閾値の discriminated union（種別ごとに構造が異なる） */
export type SensorThresholds =
  | TempHumidityThresholds
  | CurrentSensorThresholds
  | DoorSensorThresholds
  | WaterLevelSensorThresholds
  | AnalogMeterSensorThresholds

/** 逸脱判定結果のレベル
 *  - 'alert': 危険（赤）
 *  - 'warn':  注意（オレンジ）
 *  - 'normal': 正常
 *  - null: 判定対象外（thresholds 未設定 / enabled=false / 値が無い）
 */
export type DeviationLevel = 'alert' | 'warn' | 'normal' | null

/* ---------- 閾値テンプレート (Phase 9.14) ----------
 *  「冷蔵 標準」「冷凍 標準」など、よく使う閾値の組み合わせを保存しておき、
 *  センサー一覧 / 詳細から呼び出して適用する。
 *
 *  スナップショット方式: テンプレを適用すると値がコピーされ、その後
 *  テンプレを編集してもセンサー側には伝搬しない。再適用が必要。
 */
export type ThresholdTemplate = {
  id: string
  name: string
  description?: string
  /** 対象センサー種別（誤適用防止のために記録） */
  targetKind: SensorKind
  /** スナップショット元の閾値。targetKind と整合する kind を持つ */
  thresholds: SensorThresholds
  createdAt: Date
  updatedAt: Date
}

export type ThresholdTemplateStore = Record<string, ThresholdTemplate>

export type YearMonth = { year: number; month: number }

/** 年月キー "2025-12" */
export type YearMonthKey = string

export function yearMonthKey(ym: YearMonth): YearMonthKey {
  return `${ym.year}-${String(ym.month).padStart(2, '0')}`
}

export function parseYearMonthKey(key: YearMonthKey): YearMonth {
  const [y, m] = key.split('-').map(Number)
  return { year: y, month: m }
}

/** レポートの粒度（月報 / 週報） */
export type ReportKind = 'monthly' | 'weekly'

/** 画面ビュー識別子 */
export type ViewKey =
  | 'dashboard'
  | 'sensors'
  | 'sensor-detail'
  | 'gateways'
  | 'gateway-detail'
  | 'report'
  | 'records'
  | 'settings'

/* ---------- センサー種別（Phase 7） ---------- */
/** 将来複数種類のセンサーに対応するためのタイプ識別子 */
export type SensorKind =
  | 'temperature-humidity'
  | 'analog-meter'
  | 'door'
  | 'water-level'
  | 'current'

export const SENSOR_KIND_DEFS: Record<
  SensorKind,
  { label: string; description: string; supported: boolean }
> = {
  'temperature-humidity': {
    label: '温湿度',
    description: '冷蔵・冷凍庫や室内の温度と湿度を計測。',
    supported: true,
  },
  'analog-meter': {
    label: 'アナログメーター',
    description: '針式メーターを撮影して数値を読み取る。',
    supported: false,
  },
  door: {
    label: 'ドア開閉',
    description: '扉や窓の開閉状態を検知する接点センサー。',
    supported: false,
  },
  'water-level': {
    label: '水位',
    description: 'タンクや溝の水位を計測する。',
    supported: false,
  },
  current: {
    label: '電流',
    description: '機器の消費電流（CT クランプなど）を計測する。',
    supported: false,
  },
}

/* ---------- 通知グループ（Phase 7） ---------- */
export type NotificationTiming =
  | 'immediate'
  | 'batch-1h'
  | 'batch-6h'
  | 'batch-12h'
  | 'batch-24h'

/** 詳細表示用の長い表記（センサー設定の選択肢など） */
export const NOTIFICATION_TIMING_LABELS: Record<NotificationTiming, string> = {
  immediate: '即時通知',
  'batch-1h': '1 時間ごとにまとめて通知',
  'batch-6h': '6 時間ごとにまとめて通知',
  'batch-12h': '12 時間ごとにまとめて通知',
  'batch-24h': '1 日ごとにまとめて通知',
}

/** 通知グループ編集ダイアログのラジオカード用、短い表記 */
export const NOTIFICATION_TIMING_SHORT_LABELS: Record<NotificationTiming, string> = {
  immediate: '即時',
  'batch-1h': '1 時間',
  'batch-6h': '6 時間',
  'batch-12h': '12 時間',
  'batch-24h': '1 日',
}

export type NotificationChannelKind = 'email' | 'slack' | 'webhook'

export type NotificationChannel = {
  /** UI 上で行を識別するための ID */
  id: string
  kind: NotificationChannelKind
  /** メールアドレス / Slack Webhook URL / 任意の URL */
  target: string
  label?: string
}

export type NotificationGroup = {
  id: string
  name: string
  description?: string
  timing: NotificationTiming
  channels: NotificationChannel[]
  createdAt: Date
  updatedAt: Date
}

export type NotificationGroupStore = Record<string, NotificationGroup>

/* ---------- メーカー連携（Phase 7） ---------- */
export type ManufacturerIntegration = {
  id: string
  manufacturer: string
  enabled: boolean
  /** Webhook 受信用シークレット（モック表示用） */
  webhookSecret?: string
  /** 取り扱うセンサー種別 */
  sensorKinds: SensorKind[]
  updatedAt: Date
}

export type ManufacturerIntegrationStore = Record<string, ManufacturerIntegration>

/* ---------- ユーザーセッション（Clerk モック） ---------- */
export type UserSession = {
  organizationName: string
  userName: string
  email: string
}

/* ---------- 記録（Phase 8） ---------- */

/** レコードへの承認情報（チェックイン・メモ共通） */
export type RecordApproval = {
  approvedById: string
  approvedByName: string
  approvedAt: Date
  comment?: string
}

/** 確認チェックイン時に個別の逸脱セグメントへ残すメモ */
export type CheckinSegmentComment = {
  metric: 'temperature' | 'humidity'
  direction: 'above' | 'below' | 'mixed'
  /** スロット開始（30分単位） */
  start: Date
  /** スロット終了（30分単位） */
  end: Date
  slotCount: number
  extremeValue: number
  memo: string
}

/** ダッシュボード確認時に各センサーへ残すメモ */
export type CheckinSensorComment = {
  sensorId: string
  sensorName: string
  /** 逸脱があった指標（温度・湿度の組み合わせ） */
  deviationKinds: ('temperature' | 'humidity')[]
  detectedTemp?: number
  detectedHum?: number
  /** センサー単位のメモ（時間帯を細かく分けない場合） */
  comment: string
  /** 個別セグメント単位のメモ（展開して個別記録した場合） */
  segmentComments?: CheckinSegmentComment[]
}

/** 確認の総合判定（人間の判断） */
export type DashboardCheckinStatus = 'no-issue' | 'has-issue'

/** ダッシュボードの確認チェックイン（証跡） */
export type DashboardCheckin = {
  id: string
  dashboardId: string
  /** ダッシュボード名のスナップショット（削除されても履歴で読める） */
  dashboardName: string
  userId: string
  userName: string
  timestamp: Date
  /** 異常の有無（人間の判断）。古いデータでは undefined */
  status?: DashboardCheckinStatus
  /** 全体メモ（任意） */
  comment?: string
  sensorComments: CheckinSensorComment[]
  snapshot: {
    sensorCount: number
    onlineCount: number
    deviationSensorCount: number
    /** 集計に使った遡及時間（時間単位）。新しいデータでは「期間ラベル」のみ保存することも */
    lookbackHours: number
    /** 期間表示用ラベル（例: "直近 1 日"、"前回確認 (24h前) からの差分"） */
    periodLabel?: string
    rangeStart?: Date
    rangeEnd?: Date
  }
  approval?: RecordApproval
}

export type DashboardCheckinStore = Record<string, DashboardCheckin>

/** センサー運用メモのカテゴリ */
export type SensorNoteCategory =
  | 'install'
  | 'move'
  | 'calibration'
  | 'maintenance'
  | 'config'
  | 'incident'
  | 'other'

export const SENSOR_NOTE_CATEGORY_LABELS: Record<SensorNoteCategory, string> = {
  install: '設置・初期設定',
  move: '移動・配置変更',
  calibration: '校正',
  maintenance: 'メンテナンス',
  config: '設定変更',
  incident: '異常対応・修理',
  other: 'その他',
}

export type SensorNote = {
  id: string
  sensorId: string
  sensorName: string
  authorId: string
  authorName: string
  timestamp: Date
  body: string
  category: SensorNoteCategory
  approval?: RecordApproval
}

export type SensorNoteStore = Record<string, SensorNote>

/** 通知チャンネル */
export type NotifyChannels = {
  email: boolean
  slack: boolean
  push: boolean
}

/** アラート設定（センサーごとに保持） */
export type AlertSettings = {
  /** オフライン通知の有効化 */
  offlineEnabled: boolean
  /** オフラインと判定するまでの分数（30 / 60 / 360 / 1440 など） */
  offlineThresholdMinutes: number
  /** 連続逸脱通知の有効化 */
  deviationEnabled: boolean
  /** 何回連続で逸脱したら通知するか */
  deviationConsecutiveCount: number
  /** 通知チャンネル */
  notifyChannels: NotifyChannels
}

/** センサー（IoT デバイス）のメタデータ */
export type Sensor = {
  /** CSV ファイル名（拡張子除く）= デバイスID（不変。表示名は name を優先） */
  id: string
  /** 表示名（任意。未設定なら id を表示。基本情報画面で編集可） */
  name?: string
  /** 一覧表示用の連番（DV-001 形式） */
  deviceNumber: string
  /** 16桁 HEX 大文字（例: 6785F03951170020） */
  serialNumber: string
  /** モデル名（例: EM320-TH） */
  model: string
  /** メーカー名（例: Milesight） */
  manufacturer: string
  /** 接続先ゲートウェイID */
  gatewayId: string
  /** バッテリー残量（0-100） */
  battery: number
  /** オンライン状態（最終受信から24時間以内なら true） */
  online: boolean
  /** 最終受信日時 */
  lastSeenAt: Date
  /** 登録日時（モック上での「初回認識日時」） */
  registeredAt: Date
  /** アラート設定 */
  alertSettings: AlertSettings
  /** センサー種別（既存データは 'temperature-humidity' とみなす） */
  kind?: SensorKind
  /** 通知グループID（紐付けがあれば、その設定で通知を行う） */
  notificationGroupId?: string | null
  /** Phase 9.5: 物理グループID（1階層、未所属は null）*/
  groupId?: string | null
  /** Phase 9.5: 自由タグ（小文字正規化、複数付与可）*/
  tags?: string[]
  /** Phase 9.9: ユーザー定義区分ID（1:1、未設定は null） */
  categoryId?: string | null
  /** Phase 9.11: センサー個別の逸脱判定閾値。未設定なら判定なし。 */
  thresholds?: SensorThresholds
}

export type SensorStore = Record<string, Sensor>

/** ゲートウェイ（親機） */
export type Gateway = {
  id: string
  name: string
  serialNumber: string
  model: string
  manufacturer: string
  /** 設置場所のメモ（例: 1F、厨房など） */
  location: string
  registeredAt: Date
}

export type GatewayStore = Record<string, Gateway>

/* ---------- ダッシュボード（Phase 5） ---------- */

export type WidgetSpan = 'half' | 'full'

/** タイル群: 選択センサーの最新値を並べる */
export type TileWidget = {
  id: string
  type: 'tiles'
  title: string
  sensorIds: string[]
  span: WidgetSpan
}

export type ChartMetric = 'temperature' | 'humidity'
export type ChartPeriodType = 'day' | 'week' | 'month'

/** 折れ線グラフ: 1グラフに複数センサーを重ね描画。1指標のみ。
 *  期間はダッシュボードから継承。 */
export type ChartWidget = {
  id: string
  type: 'chart'
  title: string
  sensorIds: string[]
  metric: ChartMetric
  span: WidgetSpan
}

/** 逸脱ピックアップウィジェット: 期間内に逸脱があったセンサーの連続セグメントを表示 */
export type DeviationWidget = {
  id: string
  type: 'deviation'
  title: string
  /** ダッシュボード対象の絞り込み（空配列ならダッシュボード全部） */
  sensorIds: string[]
  span: WidgetSpan
}

export type PinSize = 'sm' | 'md' | 'lg'
export type PinDisplay = 'both' | 'temperature' | 'humidity'

/** 図面マップウィジェット用: センサーをマップ上の相対座標に配置 */
export type SensorPin = {
  sensorId: string
  /** 0.0 〜 1.0（横方向の相対位置） */
  x: number
  /** 0.0 〜 1.0（縦方向の相対位置） */
  y: number
  /** ピンサイズ（小・中・大） */
  size: PinSize
  /** 表示する指標（温度のみ／湿度のみ／両方） */
  display: PinDisplay
}

/** フロアマップ: 画像（data URL）の上にセンサーピンを配置 */
export type MapWidget = {
  id: string
  type: 'map'
  title: string
  /** アップロードされた画像の data URL（無ければ未設定状態） */
  imageUrl: string
  sensorIds: string[]
  pins: SensorPin[]
  span: WidgetSpan
}

export type Widget = TileWidget | ChartWidget | MapWidget | DeviationWidget
export type WidgetType = Widget['type']

/** ダッシュボード既定期間（時系列ウィジェットおよび確認ダイアログのデフォルト） */
export type DashboardDefaultPeriod =
  | { type: 'day' }
  | { type: 'week' }
  | { type: 'month' }

/** ダッシュボード上で「いまどの期間モードを使っているか」 */
export type DashboardPeriodMode = 'fixed' | 'since-last-checkin'

export type Dashboard = {
  id: string
  name: string
  description?: string
  widgets: Widget[]
  /** ダッシュボード対象センサー（全ウィジェットの選択肢の母集合） */
  targetSensorIds: string[]
  /** 既定の対象期間（固定期間モード時） */
  defaultPeriod: DashboardDefaultPeriod
  createdAt: Date
  updatedAt: Date
}

export type DashboardStore = Record<string, Dashboard>

/* ---------- センサーグループ・タグ・保存フィルタ（Phase 9.5） ---------- */

/** 1 階層フラットなセンサーグループ（フロア／部屋などの物理単位） */
export type SensorGroup = {
  id: string
  name: string
  description?: string
  /** UI 上の色アクセント（任意） */
  color?: string
  createdAt: Date
  updatedAt: Date
}

export type SensorGroupStore = Record<string, SensorGroup>

/* ---------- センサー区分（Phase 9.9） ----------
 * 区分は「1 センサー = 1 区分」のユーザー定義分類軸。
 * グループ（場所）と並ぶ独立した軸で、ダッシュボード／一覧での視認性のため
 * アイコン（CategoryIconKey）を 1 つ選んで紐付けられる。
 */

/** 区分に紐付けられる lucide アイコンキー（固定セット） */
export type CategoryIconKey =
  | 'snowflake'
  | 'refrigerator'
  | 'home'
  | 'flame'
  | 'thermometer'
  | 'droplets'
  | 'zap'
  | 'door-open'
  | 'package'
  | 'wheat'
  | 'wind'
  | 'gauge'
  | 'box'
  | 'tag'
  | 'activity'
  | 'star'

export const CATEGORY_ICON_KEYS: CategoryIconKey[] = [
  'snowflake',
  'refrigerator',
  'home',
  'flame',
  'thermometer',
  'droplets',
  'zap',
  'door-open',
  'package',
  'wheat',
  'wind',
  'gauge',
  'box',
  'tag',
  'activity',
  'star',
]

export type SensorCategory = {
  id: string
  name: string
  /** lucide アイコンキー */
  icon: CategoryIconKey
  description?: string
  createdAt: Date
  updatedAt: Date
}

export type SensorCategoryStore = Record<string, SensorCategory>

/** 動的フィルタの条件式 */
export type FilterConditions = {
  /** いずれかのグループに所属（OR）。'__none__' は未分類。 */
  groupIds?: string[]
  /** すべてのタグを持つ（AND） */
  tagsAnd?: string[]
  /** いずれかのタグを持つ（OR） */
  tagsOr?: string[]
  /** いずれかのタグを持たない（NOT） */
  tagsNot?: string[]
  /** 個別に追加するセンサーID */
  sensorIdsInclude?: string[]
  /** 個別に除外するセンサーID */
  sensorIdsExclude?: string[]
  /** フリーテキスト（名前 / デバイス番号 / シリアル / モデル / メーカー / タグ に対する部分一致） */
  search?: string
  /** Phase 9.9: いずれかの区分に所属（OR）。'__none__' は未設定。 */
  categoryIds?: string[]
  /** オンライン／オフライン。未指定なら両方 */
  onlineStatus?: 'online' | 'offline'
  /** いずれかのゲートウェイに接続（OR） */
  gatewayIds?: string[]
}

/** 保存フィルタ（動的グループ） */
export type SavedFilter = {
  id: string
  name: string
  description?: string
  conditions: FilterConditions
  createdAt: Date
  updatedAt: Date
}

export type SavedFilterStore = Record<string, SavedFilter>
