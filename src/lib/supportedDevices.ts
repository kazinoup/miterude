/**
 * ミテルデが取り扱う対応デバイスのマスタ — Phase 9.18
 *
 * 設計方針:
 * - 対応デバイスは「メーカー単位」でグループ化する
 *   （別メーカーのセンサー × ゲートウェイの組み合わせは不可のため）
 * - メーカーごとに「センサー」「ゲートウェイ（親機・中継機）」を
 *   セットで提示し、ユーザが導入検討するときに「このメーカーで揃う」
 *   ことが一目で分かる構成にする。
 * - 将来的に「この機種でできること」を内部ロジックから参照する
 *   マスタ的役割も担う想定。
 */

export type DeviceCategory = 'sensor' | 'gateway'

export type Manufacturer = {
  /** 安定キー（小文字ハイフン） */
  key: string
  /** 表示名 */
  name: string
  /** 1〜2 行の概要（このメーカーの位置づけ） */
  description?: string
  /** 対応中: メーカーとして取り扱い済み / 対応予定: 検討中・準備中 */
  supported: boolean
}

export type SupportedDevice = {
  /** 安定 ID（メーカー + モデル名から生成） */
  id: string
  /** メーカーキー（MANUFACTURERS の key を参照） */
  manufacturerKey: string
  category: DeviceCategory
  model: string
  /** 表示用の種別ラベル（例: "温湿度センサー", "ゲートウェイ"） */
  typeLabel: string
  /** カードに表示する 1〜2 行の説明 */
  description: string
  /** 対応中 / 対応予定 */
  supported: boolean
  /** カードに表示する製品画像（任意）。public/devices/ 配下の URL を想定。
   *  例: "/devices/milesight-em320-th.png" */
  imageUrl?: string
  /** Phase C: 機種が取得できる計測項目。設定 UI の表示制御で参照する。
   *  例: バッテリー残量を取得できる機種にだけ「バッテリー残量アラート」UI を出す。 */
  capabilities?: {
    /** バッテリー残量を計測値として送信できるか */
    battery?: boolean
  }
}

export const MANUFACTURERS: Manufacturer[] = [
  {
    key: 'milesight',
    name: 'Milesight',
    description:
      'LoRaWAN 規格の温湿度センサーやゲートウェイを提供する IoT メーカー。',
    supported: true,
  },
  {
    key: 'iot-mobile',
    name: 'IoT Mobile',
    description:
      '国内向け LTE-M / Sigfox 対応のセンサーシリーズ。今後対応予定。',
    supported: false,
  },
]

export const SUPPORTED_DEVICES: SupportedDevice[] = [
  /* ---------- Milesight ---------- */
  {
    id: 'milesight-em320-th',
    manufacturerKey: 'milesight',
    category: 'sensor',
    model: 'EM320-TH',
    typeLabel: '温湿度センサー',
    description:
      '冷蔵・冷凍庫や室内の温度と湿度を計測する LoRaWAN センサー。長寿命バッテリー駆動。',
    supported: true,
    imageUrl: '/devices/milesight-em320-th.png',
    capabilities: { battery: true },
  },
  {
    id: 'milesight-am102',
    manufacturerKey: 'milesight',
    category: 'sensor',
    model: 'AM102',
    typeLabel: '室内用温湿度センサー',
    description:
      '事務所・店舗・倉庫の室内環境向け LoRaWAN センサー。壁掛け設置で温度・湿度を計測する。',
    supported: false,
    imageUrl: '/devices/milesight-am102.png',
    capabilities: { battery: true },
  },
  {
    id: 'milesight-ug65',
    manufacturerKey: 'milesight',
    category: 'gateway',
    model: 'UG65',
    typeLabel: 'ゲートウェイ',
    description:
      '屋内設置向けの LoRaWAN ゲートウェイ。複数のセンサーから受信したデータをクラウドへ中継する。',
    supported: true,
    imageUrl: '/devices/milesight-ug65.png',
  },
  {
    id: 'milesight-ug63',
    manufacturerKey: 'milesight',
    category: 'gateway',
    model: 'UG63',
    typeLabel: 'ゲートウェイ',
    description:
      'コンパクトな LoRaWAN ゲートウェイ。小規模な拠点や設置スペースが限られる場所向け。',
    supported: true,
    imageUrl: '/devices/milesight-ug63.png',
  },

  /* ---------- IoT Mobile（対応予定） ---------- */
  {
    id: 'iot-mobile-sensor-tbd',
    manufacturerKey: 'iot-mobile',
    category: 'sensor',
    model: '（型番調整中）',
    typeLabel: '温湿度センサー',
    description: 'LTE-M 対応のスタンドアロン温湿度センサーを準備中。',
    supported: false,
  },
  {
    id: 'iot-mobile-gateway-tbd',
    manufacturerKey: 'iot-mobile',
    category: 'gateway',
    model: '（型番調整中）',
    typeLabel: 'ゲートウェイ',
    description: '専用クラウドへ直接アップリンクする中継装置を準備中。',
    supported: false,
  },
]

/** メーカー名 → カテゴリ昇順（センサー→ゲートウェイ）+ ID 昇順 で整列したデバイスを返す */
export function devicesByManufacturer(
  manufacturerKey: string,
): SupportedDevice[] {
  const list = SUPPORTED_DEVICES.filter(
    (d) => d.manufacturerKey === manufacturerKey,
  )
  // sensor を先、gateway を後ろに
  const order: Record<DeviceCategory, number> = { sensor: 0, gateway: 1 }
  return [...list].sort((a, b) => {
    if (order[a.category] !== order[b.category]) {
      return order[a.category] - order[b.category]
    }
    return a.model.localeCompare(b.model)
  })
}

/** ある種別がそのメーカーに 1 件もないか（"センサーはまだ" のヒント表示用） */
export function hasCategory(
  manufacturerKey: string,
  category: DeviceCategory,
): boolean {
  return SUPPORTED_DEVICES.some(
    (d) => d.manufacturerKey === manufacturerKey && d.category === category,
  )
}

/** model 文字列から SUPPORTED_DEVICES のエントリを引く（大文字小文字を無視）。
 *  Sensor.model は CSV 取り込みやモック生成で "EM320-TH" のような英数表記で
 *  入る前提で、マスタの SupportedDevice.model と完全一致を期待する。 */
export function findSupportedDeviceByModel(
  model: string,
): SupportedDevice | undefined {
  if (!model) return undefined
  const lower = model.toLowerCase()
  return SUPPORTED_DEVICES.find((d) => d.model.toLowerCase() === lower)
}

/** その機種がバッテリー残量を計測値として送信できるか（Phase C で利用）。
 *  マスタに無い機種は "false（取得不可と仮定して UI を隠す）" を返す。 */
export function canReportBattery(model: string): boolean {
  const dev = findSupportedDeviceByModel(model)
  return dev?.capabilities?.battery === true
}
