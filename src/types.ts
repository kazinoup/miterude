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

/* ---------- センサー設定テンプレート (Phase 9.14 → 拡張) ----------
 *  「冷蔵 標準」「冷凍 標準」のような閾値プリセットから始まり、
 *  4 種類の設定項目をまとめてパッケージ化できる仕組みに進化したもの。
 *
 *  パッケージ化対象（scope で個別に ON/OFF できる）:
 *   1. thresholds       — 閾値判定（温度・湿度の上下限）
 *   2. alertSettings    — アラート発生条件（オフライン / 連続逸脱 / バッテリー）
 *   3. exclusions       — 除外時間帯 + 除外日（営業時間外、年末年始など）
 *   4. notification     — 通知グループの紐付け
 *
 *  スナップショット方式: テンプレを適用すると値がコピーされ、その後
 *  テンプレを編集してもセンサー側には伝搬しない。再適用が必要。
 *
 *  古い `ThresholdTemplate` は `SensorSettingsTemplate` のエイリアスとして
 *  残っているので、既存のコード（インポート / 画面構成）は壊れない。
 *  load 時に scope が無いものは「scope = 閾値のみ」で読み込む（移行）。 */

/** テンプレートで何を上書きするかの選択。ON のフィールドだけが適用される。 */
export type SensorSettingsTemplateScope = {
  thresholds: boolean
  alertSettings: boolean
  exclusions: boolean
  notification: boolean
}

/** テンプレートが保持する「アラート発生条件」の値。
 *  exclusion は別フィールドで持つので AlertSettings から除外する。 */
export type AlertSettingsForTemplate = Omit<
  AlertSettings,
  'exclusionWindows' | 'exclusionDates'
>

/** センサー設定テンプレート本体。 */
export type SensorSettingsTemplate = {
  id: string
  name: string
  description?: string
  /** 対象センサー種別（誤適用防止のために記録） */
  targetKind: SensorKind
  /** どの項目を実際に適用するか。false の項目は対応する値があっても無視される。 */
  scope: SensorSettingsTemplateScope
  /** 閾値スナップショット（scope.thresholds=true のとき意味を持つ） */
  thresholds?: SensorThresholds
  /** アラート発生条件（scope.alertSettings=true のとき） */
  alertSettings?: AlertSettingsForTemplate
  /** 除外時間帯（scope.exclusions=true のとき）。時間帯と日付は同時に管理。 */
  exclusionWindows?: AlertExclusionWindow[]
  /** 除外日（scope.exclusions=true のとき） */
  exclusionDates?: AlertExclusionDate[]
  /** 通知グループ ID（scope.notification=true のとき）。null は「通知しない」 */
  notificationGroupId?: string | null
  createdAt: Date
  updatedAt: Date
}

export type SensorSettingsTemplateStore = Record<string, SensorSettingsTemplate>

/** 後方互換用エイリアス。既存のインポート（ThresholdTemplate / ThresholdTemplateStore）を
 *  そのまま動かすために残してある。新規コードでは SensorSettingsTemplate を使う。 */
export type ThresholdTemplate = SensorSettingsTemplate
export type ThresholdTemplateStore = SensorSettingsTemplateStore

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
  | 'alerts'
  | 'settings'
  | 'manual'

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
  /** Milesight 等の Webhook 受信ヘッダ `X-Webhook-Secret` と照合する値。
   *  MDP 上で発行したものを admin が手で入力する（ミテルデ側で自動生成しない）。
   *  この値の有無で「連携中 / 停止中」を判定する（独立した enabled フラグは持たない）。 */
  webhookSecret?: string
  /** Milesight Application の Webhook UUID（例 `665e05dd-...`）。
   *  受信検証の三段目（URL の org_id + secret + UUID 一致）と監査表示に使う。
   *  MDP 上で自動発行されたものを admin が手で入力する。 */
  webhookUuid?: string
  /** 取り扱うセンサー種別 */
  sensorKinds: SensorKind[]
  updatedAt: Date
}

export type ManufacturerIntegrationStore = Record<string, ManufacturerIntegration>

/* ---------- ユーザーセッション（Clerk モック） ---------- */

/** 表示・権限判定用に集約した「実効ロール」。
 *  Phase A-3 から UI 出し分けに使う。 */
export type EffectiveRole =
  | 'super_admin'
  | 'support'
  | 'editor'
  | 'dashboard_confirmer'
  | 'guest'

export type UserSession = {
  organizationName: string
  userName: string
  email: string
  /** Phase A-3: 実効ロール。UI の出し分けに使う */
  effectiveRole: EffectiveRole
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

/** 曜日: 0=日曜 ... 6=土曜（JavaScript の `Date.prototype.getDay()` と同じ規約）。 */
export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6

/** 除外時間帯で「どの種類のアラートを止めるか」。
 *  空配列なら **全種別** を抑制（除外時間中は何も鳴らさない）。 */
export type AlertExclusionTarget = 'deviation' | 'offline' | 'battery'

/** アラート発火を抑制する時間窓。
 *
 *  ユースケース:
 *   - 飲食店: 営業時間外（夜間〜早朝）は冷蔵庫の電源を切るため、温度逸脱で
 *     毎晩アラートが鳴ってしまう。閉店中は鳴らしたくない。
 *   - 食品工場: 夜間は鉄扉を閉める運用で電波が通らないことがあり、
 *     その時間帯のオフラインアラートを抑制したい。
 *
 *  仕様:
 *   - `startTime` / `endTime` は "HH:MM"（24h）。
 *   - `startTime > endTime` のときは **日跨ぎ**（例: 22:00 → 08:00）として扱う。
 *   - `daysOfWeek` が空配列なら毎日適用。
 *   - 日跨ぎ時の曜日判定は **窓の開始日** を基準にする
 *     （22:00→08:00 で月曜日チェック → 月曜の 22:00 から火曜の 08:00 まで抑制）。
 *   - `targets` が空配列なら全アラート種別を抑制。
 */
export type AlertExclusionWindow = {
  id: string
  /** 表示用ラベル（任意。例: "営業時間外", "夜間メンテ" 等） */
  label?: string
  /** 有効化トグル。一時的に止めたいときに OFF にできる。 */
  enabled: boolean
  /** "HH:MM" 24h */
  startTime: string
  /** "HH:MM" 24h */
  endTime: string
  /** 適用する曜日。空配列なら毎日。 */
  daysOfWeek: DayOfWeek[]
  /** 抑制対象のアラート種別。空配列なら全種別。 */
  targets: AlertExclusionTarget[]
}

/** 特定の日付範囲でアラートを止める設定。
 *
 *  ユースケース:
 *   - 年末年始の大型連休中に冷蔵庫・冷凍庫を停止
 *   - 故障修理のため数日センサー停止予定
 *   - 棚卸しなどで一時的にデバイスを動かさない期間
 *
 *  仕様:
 *   - `startDate` / `endDate` は "YYYY-MM-DD"。
 *   - `endDate >= startDate` を要求。1 日だけの場合は両方同じ日。
 *   - 範囲は **両端を含む**（startDate 00:00:00 〜 endDate 23:59:59）。
 *   - `targets` が空配列なら全アラート種別を抑制。
 */
export type AlertExclusionDate = {
  id: string
  /** 表示用ラベル（任意。例: "年末年始", "メンテナンス" 等） */
  label?: string
  /** 有効化トグル */
  enabled: boolean
  /** "YYYY-MM-DD" */
  startDate: string
  /** "YYYY-MM-DD"（startDate 以上） */
  endDate: string
  /** 抑制対象のアラート種別。空配列なら全種別。 */
  targets: AlertExclusionTarget[]
}

/** アラート設定（センサーごとに保持） */
export type AlertSettings = {
  /** オフライン通知の有効化 */
  offlineEnabled: boolean
  /** オフラインと判定するまでの分数（30 / 60 / 360 / 1440 など） */
  offlineThresholdMinutes: number
  /** 連続逸脱通知の有効化（「危険」レベルのみ。「注意」は色変更のみで発火しない） */
  deviationEnabled: boolean
  /** 何回連続で「危険」逸脱したら通知するか */
  deviationConsecutiveCount: number
  /** Phase 1.3a: 同セッション継続中の再アラート設定。
   *  - false (既定): セッション内で 1 回のみ発火、回復するまで再発火しない
   *  - true: reAlertHours 経過するごとに再発火 */
  reAlertEnabled?: boolean
  /** 再アラートを発火させるまでの時間（時間単位、1〜24）。既定 6 */
  reAlertHours?: number
  /** 通知チャンネル */
  notifyChannels: NotifyChannels
  /** Phase C: バッテリー残量低下アラート。
   *  機種がバッテリーを取得できない場合は UI 自体が出ない（保存されてもよい）。
   *  古いデータでは undefined → 既定値（OFF, 10%）にフォールバック。 */
  batteryEnabled?: boolean
  /** バッテリー残量の閾値 (%)。これを下回ったらアラートを送る。既定 10。 */
  batteryThresholdPercent?: number
  /** Phase: 除外時間帯。指定範囲内ではアラートを発火しない。
   *  古いデータでは undefined → 除外なし。 */
  exclusionWindows?: AlertExclusionWindow[]
  /** Phase: 除外日（年末年始や故障修理期間など、特定日付の抑制）。
   *  古いデータでは undefined → 除外なし。 */
  exclusionDates?: AlertExclusionDate[]
}

/** 再アラート設定のデフォルト値 */
export const RE_ALERT_HOURS_DEFAULT = 6
export const RE_ALERT_HOURS_MIN = 1
export const RE_ALERT_HOURS_MAX = 24

/* ============================================================
   Phase F-4 (Block D): デバイステーブル統合
   --------------------------------------------------------------
   センサーとゲートウェイを 1 つの「Device」マスターに統合し、
   それぞれの固有プロパティは別テーブル（SensorProps / GatewayProps）に
   分離する Class Table Inheritance パターン。

   永続化は 3 つのマップで行う（lib/storage.ts）:
     - DeviceStore        : 共通プロパティ（マスター）
     - SensorPropsStore   : センサー固有
     - GatewayPropsStore  : ゲートウェイ固有

   UI 側は JOIN 済みの Sensor / Gateway 型をそのまま受け取る
   （生成は lib/devices.ts の selector で行う）。
   ============================================================ */

/** デバイスの大区分。model から決定し、ユーザーは変更できない。 */
export type DeviceType = 'sensor' | 'gateway'

/** センサーの具体的な役割（model から決定）。 */
export type SensorRole =
  | 'temperature-humidity'
  | 'temperature'
  | 'current'
  | 'co2'
  | 'pressure'
  | 'door'
  | 'other'

/** ゲートウェイの具体的な役割。 */
export type GatewayRole = 'master' | 'relay'

export type DeviceRole = SensorRole | GatewayRole

export const SENSOR_ROLE_LABELS: Record<SensorRole, string> = {
  'temperature-humidity': '温湿度',
  temperature: '温度',
  current: '電流',
  co2: 'CO2',
  pressure: '圧力',
  door: '扉開閉',
  other: 'その他',
}

export const GATEWAY_ROLE_LABELS: Record<GatewayRole, string> = {
  master: '親機',
  relay: '中継機',
}

/** デバイスマスター（共通プロパティ）。
 *  外部識別（メーカー決定・不変）と表示・分類（ユーザー編集可）と
 *  システム管理情報を持つ。固有のセンサー値や閾値などは
 *  SensorProps / GatewayProps に格納する。 */
export type DeviceBase = {
  /** システムが採番する内部 PK（不変） */
  id: string

  /* ---------- 外部識別（メーカー決定、不変） ---------- */
  /** 大区分。model から決定 */
  deviceType: DeviceType
  /** 具体的な役割（温湿度 / 電流 / 親機 / 中継機 など）。model から決定 */
  role: DeviceRole
  /** メーカー名（例: 'Milesight'） */
  manufacturer: string
  /** モデル名（例: 'EM320-TH', 'AM102'） */
  model: string
  /** メーカー発行の一意キー。Webhook 受信時の照合に使う。
   *  値の中身はメーカーごとに異なる（Milesight: devEUI、その他: serialNumber 等）。
   *  一意性は (manufacturer, externalKey) で保証する想定。 */
  externalKey: string
  /** 製造シリアル（参考表示用） */
  serialNumber: string
  /** LoRaWAN 識別子（参考表示用、無いメーカーもある） */
  devEUI?: string

  /* ---------- 表示・分類（ユーザー運用上設定） ---------- */
  /** 表示名 */
  name?: string
  /** 運用ラベル（例: 'DV-001', '厨房-冷凍-01'） */
  deviceNumber: string
  /** 運用区分（冷凍 / 冷蔵 / 室温 など）。役割（role）とは別概念。 */
  categoryId?: string | null
  /** 物理グループ / 設置場所 */
  groupId?: string | null
  /** 自由タグ */
  tags?: string[]
  /** 通知グループID */
  notificationGroupId?: string | null

  /* ---------- システム管理（自動更新） ---------- */
  online: boolean
  lastSeenAt?: Date
  registeredAt: Date
}

/** センサー固有プロパティ。マップキー = device.id。 */
export type SensorProps = {
  /** 個別の逸脱判定閾値 */
  thresholds?: SensorThresholds
  /** バッテリー残量（0-100） */
  battery: number
  /** 接続先ゲートウェイの device.id */
  gatewayId: string
  /** アラート設定（deviation/offline/battery） */
  alertSettings: AlertSettings
}

/** デバイスマスターのストア。
 *  既存の `DeviceStore`（= センサー読み取り値のストア）との混同を避けるため
 *  `DeviceBaseStore` という名前にしている。 */
export type DeviceBaseStore = Record<string, DeviceBase>
export type SensorPropsStore = Record<string, SensorProps>

/** UI 用の JOIN ビュー。
 *  既存コードはこの型を受け取り続ける。生成は lib/devices.ts の selector。
 *  後方互換のため `kind` は role と同義のエイリアスとして併設。 */
export type Sensor = DeviceBase &
  SensorProps & {
    deviceType: 'sensor'
    role: SensorRole
    /** @deprecated role と同義。徐々に role に置換。 */
    kind?: SensorKind
  }

export type SensorStore = Record<string, Sensor>

/** ゲートウェイ専用のアラート設定。
 *  ゲートウェイには温湿度の閾値判定もバッテリー残量もないため、
 *  オフライン通知だけが発火条件として有効。 */
export type GatewayAlertSettings = {
  offlineEnabled: boolean
  offlineThresholdMinutes: number
  notifyChannels: NotifyChannels
  exclusionWindows?: AlertExclusionWindow[]
  exclusionDates?: AlertExclusionDate[]
}

/** ゲートウェイ固有プロパティ。マップキー = device.id。 */
export type GatewayProps = {
  /** アラート設定（offline のみ） */
  alertSettings: GatewayAlertSettings
}

export type GatewayPropsStore = Record<string, GatewayProps>

/** UI 用の JOIN ビュー。生成は lib/devices.ts の selector。
 *  後方互換のため `location` を残す（旧 location は groupId に移行する想定）。 */
export type Gateway = DeviceBase &
  GatewayProps & {
    deviceType: 'gateway'
    role: GatewayRole
    /** @deprecated 旧 location フィールド。groupId に移行予定。 */
    location?: string
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

/** ダッシュボード上で「いまどの期間モードを使っているか」
 *  - fixed: defaultPeriod（1日/1週間/1ヶ月）を「今」基準で表示
 *  - since-last-checkin: 前回確認時刻から「今」までを表示
 *  - custom: 任意の開始日〜終了日を表示（Phase D-1） */
export type DashboardPeriodMode = 'fixed' | 'since-last-checkin' | 'custom'

export type Dashboard = {
  id: string
  name: string
  description?: string
  widgets: Widget[]
  /** ダッシュボード対象センサー（全ウィジェットの選択肢の母集合） */
  targetSensorIds: string[]
  /** 既定の対象期間（固定期間モード時） */
  defaultPeriod: DashboardDefaultPeriod
  /** Phase F-5: 公開 URL のトークン。
   *  値があると `/share/dashboard/<token>` で読み取り専用閲覧できる想定。
   *  未発行 / 取り消し済みは undefined。 */
  publicShareToken?: string
  /** 公開 URL を発行した日時（取り消し時に消す） */
  publicShareIssuedAt?: Date
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

/* ---------- アラートログ（Phase B / Phase 10） ----------
 * センサー / ゲートウェイで発生したアラート事象を蓄積する場所。
 * 通知のまとめ送信（1 日 1 回など）はここから期間で SELECT してまとめる、
 * という前提のデータ層で、画面では「アラート」メニューから一覧確認できる。 */

export type AlertLogKind =
  | 'deviation-alert' // 逸脱・危険（赤）
  | 'deviation-warn'  // 逸脱・注意（オレンジ）
  | 'offline'         // オフライン
  | 'battery'         // バッテリー残量低下（Phase C）

export const ALERT_LOG_KIND_LABELS: Record<AlertLogKind, string> = {
  'deviation-alert': '逸脱（危険）',
  'deviation-warn': '逸脱（注意）',
  offline: 'オフライン',
  battery: 'バッテリー',
}

export type AlertLogTargetKind = 'sensor' | 'gateway'

export type AlertLogEntry = {
  id: string
  /** 発生日時 */
  occurredAt: Date
  /** 対象がセンサーかゲートウェイか */
  targetKind: AlertLogTargetKind
  /** 内部参照 ID（Sensor.id / Gateway.id） */
  targetId: string
  /** 対象のメーカー / モデル / シリアルナンバー / センサー番号（記録時点の値をスナップショット） */
  manufacturer: string
  model: string
  serialNumber: string
  /** ゲートウェイ配下のセンサー番号など、機種固有の補助 ID（任意） */
  sensorNumber?: string
  /** アラート種別 */
  kind: AlertLogKind
  /** 関連する計測項目（温度・湿度・バッテリーなど。種別によっては省略） */
  metric?: 'temperature' | 'humidity' | 'battery'
  /** 計測値（任意。逸脱・バッテリーで利用） */
  value?: number
  /** ユーザ向け 1 行説明（例: "温度 -5.3℃ が下限 -5.0℃ を下回りました"） */
  message: string
  /** Phase 1.3a: 同一の連続逸脱期間を束ねるセッション ID。
   *  初回 = 新規生成、同セッション内の再アラートは同じ ID。
   *  途中で正常値に戻ったら次の発火時に新セッション。 */
  sessionId?: string
  /** Phase 1.3a: 同セッション内で何回目の発火か。0=初回、1, 2, ...=再アラート */
  reAlertIndex?: number
  /** ダッシュボード確認記録から連携されたメモ。
   *  DashboardCheckin の sensorComments / segmentComments を作成すると、
   *  対象期間に該当する AlertLog エントリへ書き戻される。
   *  最新の確認が上書きする方式（履歴を残す場合は別フィールド検討）。 */
  confirmComment?: string
  /** 確認メモを書いた人の名前（スナップショット） */
  confirmedBy?: string
  /** 確認メモが書かれた日時 */
  confirmedAt?: Date
}

export type AlertLogStore = Record<string, AlertLogEntry>

/* ---------- Phase G: 通知設定（レポート定期配信・ダッシュボード確認リマインド） ----------
 * 既存の NotificationGroup（宛先 × 送信タイミング）はそのまま再利用し、
 * レポート / リマインドそれぞれが「どの通知グループ宛に送るか」を選ぶ構成にする。
 *
 * 配信形式は当面リンク方式: メール本文にレポート閲覧用 URL を載せる前提で、
 * 添付配信は将来的に追加。 */

/** レポート定期配信の設定 */
export type ReportSchedule = {
  id: string
  /** 表示名（例: "週次レポート（月曜 9:00）"） */
  name: string
  /** ON/OFF */
  enabled: boolean
  /** 配信するレポート種別 */
  reportKind: ReportKind
  /** 対象センサー ID。空配列なら全センサー（取り込み済み）を対象とする扱い */
  targetSensorIds: string[]
  /** 配信先の通知グループ ID。null なら未設定（実際の配信は行えない） */
  notificationGroupId: string | null
  /** 配信時刻 "HH:MM"（24h） */
  deliveryTime: string
  /** 週報の場合: 何曜日に配信するか (0=日, 1=月, ..., 6=土)。既定 1=月曜 */
  weeklyDayOfWeek?: number
  /** 月報の場合: 月の何日に配信するか (1..28)。既定 1 */
  monthlyDayOfMonth?: number
  createdAt: Date
  updatedAt: Date
}

export type ReportScheduleStore = Record<string, ReportSchedule>

/** ダッシュボード確認リマインドの頻度 */
export type DashboardReminderFrequency = 'daily' | 'weekly'

/** ダッシュボード確認リマインドの設定 */
export type DashboardReminder = {
  id: string
  /** 表示名（例: "毎朝の確認リマインド"） */
  name: string
  /** ON/OFF */
  enabled: boolean
  /** 対象ダッシュボード ID。null なら全ダッシュボード */
  dashboardId: string | null
  /** 確認頻度 */
  frequency: DashboardReminderFrequency
  /** この時刻を過ぎても当日の DashboardCheckin が無ければ通知 */
  deadlineTime: string
  /** 週次の場合: 確認すべき曜日 (0..6)。既定 1=月曜 */
  weeklyDayOfWeek?: number
  /** 配信先の通知グループ ID */
  notificationGroupId: string | null
  createdAt: Date
  updatedAt: Date
}

export type DashboardReminderStore = Record<string, DashboardReminder>

/* ---------- Phase A: マルチテナント基盤 ----------
 * Supabase 移行前の localStorage モックでも、
 * 将来のスキーマと同じ概念モデルを使えるよう型を整理。
 *
 * 詳細は docs/database-schema.md を参照。 */

/** システム横断ロール（テナントを跨ぐ運営側のロール）。
 *  null = 顧客ユーザー。 */
export type SystemRole = 'super_admin' | 'support'

/** スタッフ区分（systemRole='support' のユーザを表示上だけ細分化）。
 *  権限は両方ともテナントへの impersonation 可だが、表示と請求事前通知の
 *  運用区別のために使う。未設定 = 'support' として扱う。 */
export type StaffCategory = 'support' | 'sales'

/** テナント内ロール（顧客側でのロール）。 */
export type TenantRole = 'editor' | 'dashboard_confirmer'

/** ユーザー（Clerk と統合する想定。モック期は email + system_role のみ） */
export type AppUser = {
  id: string
  /** Clerk 統合時に紐付け。モック期は null */
  clerkUserId?: string
  email: string
  displayName: string
  /** 運営側スタッフのロール。null = 顧客 */
  systemRole?: SystemRole
  /** systemRole='support' のときの細分化（'support' or 'sales'）。
   *  営業担当 = 'sales' を選んでおくと、請求書の事前通知の宛先候補に出やすくなる。 */
  staffCategory?: StaffCategory
  createdAt: Date
}

export type AppUserStore = Record<string, AppUser>

/** 請求サイクル（年契約 / 月契約） */
export type BillingCycle = 'monthly' | 'annual'

/** 決済手段 */
export type PaymentMethod = 'bank_transfer' | 'credit_card'

/** 契約種別:
 *  - demo         デモ: 検証用テナント（料金は発生しない）
 *  - subscription サブスクプラン: デバイス代込みの月額継続プラン
 *  - purchase     買取プラン: デバイス代を初回一括、その後はランニング費のみ
 *  - typeless     タイプレス: 既存「タイプレス」サービスからの移行・統合契約 */
export type ContractType = 'demo' | 'subscription' | 'purchase' | 'typeless'

/** 請求書事前通知の宛先（営業担当・サポート・任意メールを混在可）。 */
export type InvoiceNotifyRecipient =
  | { kind: 'staff'; userId: string }
  | { kind: 'email'; email: string }

/** 組織（テナント）
 *
 *  注: `plan` は旧フィールド（demo/standard/enterprise）。Phase A-4 後半で
 *  `contractType` に統合したため、新規 UI では参照しない。互換性のため
 *  optional + 残存（既存 localStorage を読み出すときに型エラーを起こさない）。 */
export type Organization = {
  id: string
  name: string
  slug: string
  /** @deprecated Phase A-4 後半: contractType に統合。新規 UI では参照しない。 */
  plan?: 'demo' | 'standard' | 'enterprise'
  createdAt: Date

  /** 請求サイクル（既定: annual）。Phase A-4 後半で追加。 */
  billingCycle?: BillingCycle
  /** 契約開始日 */
  contractStartedAt?: Date
  /** 契約終了日（次の更新日でもある）。
   *  monthly なら契約日の 1 ヶ月後、annual なら 1 年後を既定値とする運用。 */
  contractExpiresAt?: Date

  /** 決済手段（既定: bank_transfer）。実決済は Phase D 以降で Stripe 等を統合。 */
  paymentMethod?: PaymentMethod
  /** 請求書送付先メール（bank_transfer の請求書自動送信に使う） */
  billingEmail?: string
  /** bank_transfer のとき請求書を自動でメール送信するか */
  autoInvoice?: boolean

  /** 契約種別（デモ / サブスク / 買取）。既定: subscription */
  contractType?: ContractType
  /** ツクルデAI 連携の有無 */
  tsukurudeAiEnabled?: boolean
  /** 移行モード（既存システムからの一括 CSV インポート用）。
   *  startedAt がセットされ、finishedAt が未セットの間だけ
   *  Admin Console の移行 CSV インポートパネルが表示される。 */
  migrationMode?: {
    startedAt: Date
    finishedAt?: Date
  }

  /* ---------- 論理削除（無効化）---------- *
   * deactivatedAt がセットされたら無効化中。physicalDeleteAfter 以降は完全削除可。 */
  /** 無効化（論理削除）した日時。null = 通常運用中。 */
  deactivatedAt?: Date
  /** 無効化を実行した admin user の id */
  deactivatedByUserId?: string
  /** 無効化の理由（監査用） */
  deactivationReason?: string
  /** この日時以降、admin が物理削除を実行できる（既定: 無効化から 180 日後）。 */
  physicalDeleteAfter?: Date

  /** 請求書を顧客へ送る何日前に営業担当へ事前通知するか（既定 3）。
   *  paymentMethod='bank_transfer' かつ autoInvoice=true のときだけ意味を持つ。 */
  preNotifyDaysBefore?: number
  /** 事前通知の宛先（営業担当 / サポート / 任意メール）。複数可。 */
  preNotifyRecipients?: InvoiceNotifyRecipient[]

  /* ---------- Stripe 連携（クレジット決済用） ----------
   * カード情報の保管・課金実行は Stripe 側に完全委譲する設計。
   * ミテルデが持つのは Stripe 上の顧客 ID（cus_xxx）のみで、表示用に
   * カードのブランド / 末尾 4 桁などをキャッシュする（Webhook で同期）。
   * 顧客のカード番号 / CVC は当方サーバを 1 度も通さない（PCI scope 外）。 */
  /** Stripe Customer ID（例: `cus_PAB123...`）。クレジット契約時のみ */
  stripeCustomerId?: string
  /** 既定の支払い方法 ID（pm_xxx）。Stripe Customer Portal で変更されると Webhook で同期 */
  stripePaymentMethodId?: string
  /** 表示用キャッシュ: 'visa' / 'mastercard' / 'amex' / 'jcb' 等 */
  cardBrand?: string
  /** 表示用キャッシュ: カード末尾 4 桁 */
  cardLast4?: string
  /** 表示用キャッシュ: 有効期限 */
  cardExpMonth?: number
  cardExpYear?: number
}

export type OrganizationStore = Record<string, Organization>

/* ---------- 請求書 / 領収書 (Phase: 銀行振込フロー) ----------
 * 銀行振込テナント向けの請求書管理。クレジット決済の領収書は Stripe Customer
 * Portal 側で確認できるため、ここには載せない。
 *
 * フロー:
 *   1. 自動生成（請求月 1 日の N 日前）→ status='confirming' で営業担当へ事前通知
 *   2. 営業担当が確認して「OK」→ status='sent' に遷移、顧客 PDF 送付
 *   3. 入金確認 → status='paid'（領収書 PDF 発行）
 */
export type InvoiceStatus =
  | 'confirming'  // 営業担当の確認待ち（顧客には未送付）
  | 'sent'        // 顧客に発行済み（入金待ち）
  | 'paid'        // 入金完了 / 領収書あり
  | 'overdue'     // 期日超過（未入金）
  | 'cancelled'

export type Invoice = {
  id: string
  organizationId: string
  /** 表示用の番号（"INV-2026-05-001" 等） */
  invoiceNumber: string
  /** 対象期間（"2026-05" or "2026-05 〜 2027-04"） */
  periodLabel: string
  /** 発行日（status='sent' に遷移した日時） */
  issuedAt?: Date
  /** 支払期日 */
  dueAt?: Date
  /** 入金完了日（領収書発行日） */
  paidAt?: Date
  /** 金額（税込・JPY） */
  amountJpy: number
  /** 内訳の人間読み出し（"年間サブスク + センサー × 30 台" 等） */
  description?: string
  status: InvoiceStatus
  /** 請求書 PDF（status='sent' 以降で生成）。実際は S3 等の署名 URL */
  invoicePdfUrl?: string
  /** 領収書 PDF（status='paid' 以降で生成） */
  receiptPdfUrl?: string
  /** モック用: 営業担当の OK アクション履歴 */
  approvedByUserId?: string
  approvedAt?: Date
}

export type InvoiceStore = Record<string, Invoice>

/** 組織メンバーシップ（多対多） */
export type OrganizationMember = {
  id: string
  organizationId: string
  userId: string
  role: TenantRole
  /** 招待日（招待を出した日時） */
  invitedAt: Date
  /** 初回ログイン日時。未ログイン時は undefined */
  firstLoginAt?: Date
  /** 最終ログイン日時。未ログイン時は undefined */
  lastLoginAt?: Date
}

export type OrganizationMemberStore = Record<string, OrganizationMember>

/** スタッフアサインメント — サポートスタッフがテナントへ入る権限。
 *  super_admin にはこのレコードは作らない（暗黙的に全テナント可）。 */
export type StaffAssignment = {
  id: string
  staffUserId: string
  organizationId: string
  grantedByUserId: string
  grantedAt: Date
  expiresAt?: Date
  revokedAt?: Date
  notes?: string
}

export type StaffAssignmentStore = Record<string, StaffAssignment>

/** スタッフ操作の監査ログ */
export type StaffAuditLog = {
  id: string
  staffUserId: string
  /** テナント外操作（テナント作成等）なら undefined */
  organizationId?: string
  action: string
  targetTable?: string
  targetId?: string
  metadata?: Record<string, unknown>
  occurredAt: Date
}

export type StaffAuditLogStore = Record<string, StaffAuditLog>

/** マニュアル: カテゴリ（左サイドバーの第 1 階層）。
 *  super_admin のみ編集可。全テナント共通コンテンツ。 */
export type ManualCategory = {
  id: string
  name: string
  sortOrder: number
  updatedAt: Date
}

export type ManualCategoryStore = Record<string, ManualCategory>

/** マニュアル: ページ（第 2 階層）。content は BlockNote の JSON。 */
export type ManualPage = {
  id: string
  categoryId: string
  title: string
  sortOrder: number
  /** BlockNote の Block[] を JSON シリアライズ可能な形で保持 */
  content: unknown
  updatedAt: Date
  updatedByUserId?: string
}

export type ManualPageStore = Record<string, ManualPage>

/** 認証セッション。
 *  - tenant: 顧客ユーザーが所属組織にいる
 *  - admin:  スーパーアドミンが /admin にいる
 *  - impersonation: スタッフが顧客 UI を見ている（監査ログ対象） */
export type AuthSession =
  | { kind: 'tenant'; userId: string; organizationId: string }
  | { kind: 'admin'; userId: string }
  | {
      kind: 'impersonation'
      userId: string
      actingAsOrganizationId: string
      reason: string
      startedAt: Date
      expiresAt: Date
    }
  | null
