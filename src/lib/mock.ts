/**
 * モックデータ生成 — Phase 2
 * - センサーのシリアル番号、デバイス番号、モデル、メーカーを決定論的に生成
 * - ゲートウェイを自動分配（1台あたり最大8センサー）
 *
 * 決定論的生成のため、同じデバイスID（CSVファイル名）を再インポートしても
 * 同じシリアル番号などが生成され、二重登録時の整合性が取れる。
 */
import type {
  AlertSettings,
  DeviceStore,
  Gateway,
  GatewayAlertSettings,
  GatewayStore,
  Sensor,
  SensorReading,
  SensorStore,
} from '../types'

export function defaultAlertSettings(): AlertSettings {
  return {
    offlineEnabled: true,
    offlineThresholdMinutes: 60,
    deviationEnabled: true,
    deviationConsecutiveCount: 3,
    notifyChannels: { email: true, slack: false, push: false },
    /** Phase C: バッテリー残量アラート — 既定 OFF / 10% */
    batteryEnabled: false,
    batteryThresholdPercent: 10,
  }
}

/** Gateway 用の既定アラート設定（オフラインのみ） */
export function defaultGatewayAlertSettings(): GatewayAlertSettings {
  return {
    offlineEnabled: true,
    offlineThresholdMinutes: 60,
    notifyChannels: { email: true, slack: false, push: false },
  }
}

const ONLINE_THRESHOLD_MS = 24 * 60 * 60 * 1000 // 最終受信から24時間以内ならオンライン
const SENSORS_PER_GATEWAY = 8

const DEFAULT_MODEL = 'EM320-TH'
const DEFAULT_MANUFACTURER = 'Milesight'
const GATEWAY_MODEL = 'UG65'
const GATEWAY_MANUFACTURER = 'Milesight'

/** djb2 風の双子ハッシュで 16 桁 HEX 大文字を作る */
export function hash16(input: string): string {
  let h1 = 5381
  let h2 = 7919
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i)
    h1 = ((h1 << 5) + h1 + c) >>> 0
    h2 = ((h2 << 5) + h2 + c * 31) >>> 0
  }
  return (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')).toUpperCase()
}

export function generateSerial(seed: string): string {
  return hash16(`serial:${seed}`)
}

export function generateDeviceNumber(index: number): string {
  return `DV-${String(index + 1).padStart(3, '0')}`
}

/** 同じ deviceId に対しては安定したバッテリーを返す（再描画でブレないように） */
function mockBatteryFor(seed: string): number {
  const h = hash16(`battery:${seed}`)
  const n = parseInt(h.slice(0, 4), 16) % 60
  return 40 + n // 40〜99 の範囲
}

/** 値を Date に正規化する。localStorage 復元時に文字列が混じっても受け付ける */
export function ensureDate(v: unknown): Date {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v
  if (typeof v === 'string' || typeof v === 'number') {
    const d = new Date(v)
    if (!Number.isNaN(d.getTime())) return d
  }
  return new Date()
}

function isOnline(lastAt: Date | string | number | undefined | null): boolean {
  if (lastAt == null) return false
  const t = lastAt instanceof Date ? lastAt.getTime() : new Date(lastAt).getTime()
  if (Number.isNaN(t)) return false
  return Date.now() - t < ONLINE_THRESHOLD_MS
}

function makeSensor(
  id: string,
  index: number,
  readings: SensorReading[],
  gatewayId: string,
): Sensor {
  const last = readings[readings.length - 1]
  const lastAt = last?.measuredAt ?? new Date()
  const battery = last?.battery ?? mockBatteryFor(id)
  const serial = generateSerial(id)
  const devEUI = hash16(`devEUI:${id}`)
  return {
    id,
    deviceType: 'sensor',
    role: 'temperature-humidity',
    name: undefined,
    deviceNumber: generateDeviceNumber(index),
    serialNumber: serial,
    devEUI,
    // Milesight は devEUI を externalKey として使う
    externalKey: devEUI,
    model: DEFAULT_MODEL,
    manufacturer: DEFAULT_MANUFACTURER,
    gatewayId,
    battery: Math.round(battery),
    online: isOnline(lastAt),
    lastSeenAt: lastAt,
    registeredAt: new Date(),
    alertSettings: defaultAlertSettings(),
    kind: 'temperature-humidity',
    notificationGroupId: null,
    groupId: null,
    tags: [],
  }
}

function makeGateway(index: number): Gateway {
  const id = `GW-${String(index + 1).padStart(3, '0')}`
  const serial = hash16(`gateway:${id}`)
  const devEUI = hash16(`gateway-eui:${id}`)
  return {
    id,
    deviceType: 'gateway',
    role: 'master',
    name: `ゲートウェイ ${String(index + 1).padStart(2, '0')}`,
    deviceNumber: id,
    serialNumber: serial,
    devEUI,
    // Milesight は devEUI を externalKey として使う
    externalKey: devEUI,
    model: GATEWAY_MODEL,
    manufacturer: GATEWAY_MANUFACTURER,
    location: index === 0 ? '1F' : index === 1 ? '2F' : `${index + 1}F`,
    online: true,
    lastSeenAt: new Date(),
    categoryId: null,
    groupId: null,
    tags: [],
    notificationGroupId: null,
    alertSettings: defaultGatewayAlertSettings(),
    registeredAt: new Date(),
  }
}

/** 既存ゲートウェイで定員に空きがあるものを選び、なければ新規作成 */
function pickOrCreateGateway(
  gateways: GatewayStore,
  counts: Record<string, number>,
): { gatewayId: string; nextGateways: GatewayStore } {
  const existingIds = Object.keys(gateways).sort()

  let bestId: string | null = null
  let bestCount = SENSORS_PER_GATEWAY
  for (const id of existingIds) {
    const c = counts[id] ?? 0
    if (c < bestCount) {
      bestId = id
      bestCount = c
    }
  }

  if (bestId) {
    counts[bestId] = (counts[bestId] ?? 0) + 1
    return { gatewayId: bestId, nextGateways: gateways }
  }

  const newGateway = makeGateway(existingIds.length)
  counts[newGateway.id] = 1
  return {
    gatewayId: newGateway.id,
    nextGateways: { ...gateways, [newGateway.id]: newGateway },
  }
}

/** 既存ゲートウェイ・センサーの状態を維持しつつ、devices と整合させる。
 *  - 削除されたデバイスのセンサーは消す
 *  - 新規デバイスにはセンサーメタデータを生成し、ゲートウェイへ自動分配
 *  - 既存センサーは battery/lastSeenAt/online を最新で更新
 */
export function syncMetadata(
  devices: DeviceStore,
  prevSensors: SensorStore,
  prevGateways: GatewayStore,
): { sensors: SensorStore; gateways: GatewayStore } {
  let nextSensors: SensorStore = {}
  let nextGateways: GatewayStore = { ...prevGateways }

  // 1) 既存センサーで devices に残っているものを引き継ぎ
  const existingIds = Object.keys(devices).sort()
  for (const id of existingIds) {
    if (prevSensors[id]) {
      const prev = prevSensors[id]
      const readings = devices[id] ?? []
      const last = readings[readings.length - 1]
      // 日付は localStorage 復元の都合で string になっている場合があるため正規化
      const lastAt = last?.measuredAt
        ? ensureDate(last.measuredAt)
        : ensureDate(prev.lastSeenAt)
      const battery = last?.battery ?? prev.battery
      nextSensors[id] = {
        ...prev,
        registeredAt: ensureDate(prev.registeredAt),
        battery: Math.round(battery),
        lastSeenAt: lastAt,
        online: isOnline(lastAt),
        // 旧データに alertSettings がない場合に補う（マイグレーション）
        alertSettings: prev.alertSettings ?? defaultAlertSettings(),
      }
    }
  }

  // 2) ゲートウェイ別の使用センサー数を集計
  const counts: Record<string, number> = {}
  for (const s of Object.values(nextSensors)) {
    counts[s.gatewayId] = (counts[s.gatewayId] ?? 0) + 1
  }

  // 3) 新規デバイスにセンサーを作る
  let nextIndex =
    Object.keys(nextSensors).length === 0
      ? 0
      : Math.max(
          ...Object.values(nextSensors).map((s) => {
            const m = s.deviceNumber.match(/(\d+)/)
            return m ? Number(m[1]) : 0
          }),
        )
  for (const id of existingIds) {
    if (nextSensors[id]) continue
    const picked = pickOrCreateGateway(nextGateways, counts)
    nextGateways = picked.nextGateways
    nextSensors[id] = makeSensor(id, nextIndex, devices[id] ?? [], picked.gatewayId)
    nextIndex++
  }

  // 4) どのセンサーも紐付かないゲートウェイは「孤児ゲートウェイ」として残しておく
  //    （ユーザーが明示的に削除する想定）

  return { sensors: nextSensors, gateways: nextGateways }
}

/** ゲートウェイに接続されているセンサーIDを返す */
export function sensorsOfGateway(sensors: SensorStore, gatewayId: string): string[] {
  return Object.values(sensors)
    .filter((s) => s.gatewayId === gatewayId)
    .map((s) => s.id)
    .sort()
}
