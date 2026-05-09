/**
 * デバイスマスター + 固有プロパティの結合 / 分解 ヘルパ — Phase F-4 (Block D)
 *
 * 永続化レイヤは 3 ストアに分かれている:
 *   - DeviceBaseStore     : 共通プロパティ（マスター）
 *   - SensorPropsStore    : センサー固有
 *   - GatewayPropsStore   : ゲートウェイ固有
 *
 * UI 側は JOIN 済みの Sensor / Gateway 型を期待しているため、
 * このモジュールで selector / inverse-selector を提供する。
 */
import type {
  DeviceBase,
  DeviceBaseStore,
  Gateway,
  GatewayProps,
  GatewayPropsStore,
  GatewayStore,
  Sensor,
  SensorProps,
  SensorPropsStore,
  SensorStore,
} from '../types'

/** マスター + センサー固有プロパティから JOIN 済みの Sensor を作る。 */
export function joinSensor(
  base: DeviceBase,
  props: SensorProps,
): Sensor {
  if (base.deviceType !== 'sensor') {
    throw new Error(
      `joinSensor: device ${base.id} is not a sensor (deviceType=${base.deviceType})`,
    )
  }
  return {
    ...base,
    ...props,
    deviceType: 'sensor',
    role: base.role as Sensor['role'],
    // 後方互換: kind を role と同じ値で埋める
    kind: base.role as Sensor['kind'],
  }
}

/** マスター + ゲートウェイ固有プロパティから JOIN 済みの Gateway を作る。 */
export function joinGateway(
  base: DeviceBase,
  props: GatewayProps,
): Gateway {
  if (base.deviceType !== 'gateway') {
    throw new Error(
      `joinGateway: device ${base.id} is not a gateway (deviceType=${base.deviceType})`,
    )
  }
  return {
    ...base,
    ...props,
    deviceType: 'gateway',
    role: base.role as Gateway['role'],
  }
}

/** 全デバイスマスター + センサーProps ストアから SensorStore を生成。
 *  deviceType='sensor' のレコードに対して props を JOIN し、
 *  props が欠けているレコードはスキップする。 */
export function selectSensors(
  devices: DeviceBaseStore,
  sensorProps: SensorPropsStore,
): SensorStore {
  const out: SensorStore = {}
  for (const id of Object.keys(devices)) {
    const base = devices[id]
    if (!base || base.deviceType !== 'sensor') continue
    const props = sensorProps[id]
    if (!props) continue
    out[id] = joinSensor(base, props)
  }
  return out
}

/** 全デバイスマスター + ゲートウェイProps ストアから GatewayStore を生成。 */
export function selectGateways(
  devices: DeviceBaseStore,
  gatewayProps: GatewayPropsStore,
): GatewayStore {
  const out: GatewayStore = {}
  for (const id of Object.keys(devices)) {
    const base = devices[id]
    if (!base || base.deviceType !== 'gateway') continue
    const props = gatewayProps[id]
    if (!props) continue
    out[id] = joinGateway(base, props)
  }
  return out
}

/** Sensor を DeviceBase + SensorProps に分解する。
 *  JOIN ビューを書き戻すときに使う。 */
export function splitSensor(
  s: Sensor,
): { base: DeviceBase; props: SensorProps } {
  const base: DeviceBase = {
    id: s.id,
    deviceType: 'sensor',
    role: s.role,
    manufacturer: s.manufacturer,
    model: s.model,
    externalKey: s.externalKey,
    serialNumber: s.serialNumber,
    devEUI: s.devEUI,
    name: s.name,
    deviceNumber: s.deviceNumber,
    categoryId: s.categoryId,
    groupId: s.groupId,
    tags: s.tags,
    notificationGroupId: s.notificationGroupId,
    online: s.online,
    lastSeenAt: s.lastSeenAt,
    registeredAt: s.registeredAt,
  }
  const props: SensorProps = {
    thresholds: s.thresholds,
    battery: s.battery,
    gatewayId: s.gatewayId,
    alertSettings: s.alertSettings,
  }
  return { base, props }
}

/** Gateway を DeviceBase + GatewayProps に分解する。 */
export function splitGateway(
  g: Gateway,
): { base: DeviceBase; props: GatewayProps } {
  const base: DeviceBase = {
    id: g.id,
    deviceType: 'gateway',
    role: g.role,
    manufacturer: g.manufacturer,
    model: g.model,
    externalKey: g.externalKey,
    serialNumber: g.serialNumber,
    devEUI: g.devEUI,
    name: g.name,
    deviceNumber: g.deviceNumber,
    categoryId: g.categoryId,
    groupId: g.groupId,
    tags: g.tags,
    notificationGroupId: g.notificationGroupId,
    online: g.online,
    lastSeenAt: g.lastSeenAt,
    registeredAt: g.registeredAt,
  }
  const props: GatewayProps = {
    alertSettings: g.alertSettings,
  }
  return { base, props }
}

/** Sensor を SensorStore へ書き戻す（マップに入れる）副作用形ヘルパ。
 *  state 側で 3 ストアを更新する際に便利。 */
export type StoreTriple = {
  devices: DeviceBaseStore
  sensorProps: SensorPropsStore
  gatewayProps: GatewayPropsStore
}

export function upsertSensorIntoStores(
  stores: StoreTriple,
  s: Sensor,
): StoreTriple {
  const { base, props } = splitSensor(s)
  return {
    devices: { ...stores.devices, [s.id]: base },
    sensorProps: { ...stores.sensorProps, [s.id]: props },
    gatewayProps: stores.gatewayProps,
  }
}

export function upsertGatewayIntoStores(
  stores: StoreTriple,
  g: Gateway,
): StoreTriple {
  const { base, props } = splitGateway(g)
  return {
    devices: { ...stores.devices, [g.id]: base },
    sensorProps: stores.sensorProps,
    gatewayProps: { ...stores.gatewayProps, [g.id]: props },
  }
}

/** id でデバイスをマスター + 固有プロパティの両方から削除 */
export function removeDeviceFromStores(
  stores: StoreTriple,
  id: string,
): StoreTriple {
  const base = stores.devices[id]
  const nextDevices = { ...stores.devices }
  delete nextDevices[id]
  if (!base) {
    return { ...stores, devices: nextDevices }
  }
  if (base.deviceType === 'sensor') {
    const nextSP = { ...stores.sensorProps }
    delete nextSP[id]
    return { ...stores, devices: nextDevices, sensorProps: nextSP }
  }
  const nextGP = { ...stores.gatewayProps }
  delete nextGP[id]
  return { ...stores, devices: nextDevices, gatewayProps: nextGP }
}

/** Webhook 受信時の照合: (manufacturer, externalKey) からデバイスを探す。 */
export function findDeviceByExternalKey(
  devices: DeviceBaseStore,
  manufacturer: string,
  externalKey: string,
): DeviceBase | undefined {
  for (const d of Object.values(devices)) {
    if (d.manufacturer === manufacturer && d.externalKey === externalKey) {
      return d
    }
  }
  return undefined
}
