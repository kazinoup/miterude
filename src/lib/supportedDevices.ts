/**
 * ミテルデが取り扱う対応デバイスのマスタ — Phase 9.17
 *
 * 設定画面の「対応デバイス」タブの一覧として表示するほか、
 * 将来的に「この機種でできること」を内部ロジックから参照する
 * マスタ的役割も担う想定。
 */

export type DeviceCategory = 'sensor' | 'gateway'

export type SupportedDevice = {
  /** 安定 ID（メーカー + モデル名から生成。今後 Settings の参照キーになる可能性あり） */
  id: string
  category: DeviceCategory
  manufacturer: string
  model: string
  /** 表示用の種別ラベル（例: "温湿度センサー", "ゲートウェイ"） */
  typeLabel: string
  /** カードに表示する 1〜2 行の説明 */
  description: string
  /** 対応中 / 対応予定 */
  supported: boolean
}

export const SUPPORTED_DEVICES: SupportedDevice[] = [
  /* ---------- センサー ---------- */
  {
    id: 'milesight-em320-th',
    category: 'sensor',
    manufacturer: 'Milesight',
    model: 'EM320-TH',
    typeLabel: '温湿度センサー',
    description:
      '冷蔵・冷凍庫や室内の温度と湿度を計測する LoRaWAN センサー。長寿命バッテリー駆動。',
    supported: true,
  },

  /* ---------- ゲートウェイ ---------- */
  {
    id: 'milesight-ug65',
    category: 'gateway',
    manufacturer: 'Milesight',
    model: 'UG65',
    typeLabel: 'ゲートウェイ',
    description:
      '屋内設置向けの LoRaWAN ゲートウェイ。複数のセンサーから受信したデータをクラウドへ中継する。',
    supported: true,
  },
  {
    id: 'milesight-ug63',
    category: 'gateway',
    manufacturer: 'Milesight',
    model: 'UG63',
    typeLabel: 'ゲートウェイ',
    description:
      'コンパクトな LoRaWAN ゲートウェイ。小規模な拠点や設置スペースが限られる場所向け。',
    supported: true,
  },
]

/** カテゴリでグループ化したリスト（UI 表示順序を制御するため） */
export const DEVICE_CATEGORY_DEFS: {
  key: DeviceCategory
  label: string
  description: string
}[] = [
  {
    key: 'sensor',
    label: 'センサー',
    description: '計測対象から直接データを取得するエッジデバイス。',
  },
  {
    key: 'gateway',
    label: 'ゲートウェイ（親機・中継機）',
    description: 'センサーから受信したデータをクラウドへ中継する装置。',
  },
]

export function devicesByCategory(category: DeviceCategory): SupportedDevice[] {
  return SUPPORTED_DEVICES.filter((d) => d.category === category)
}
