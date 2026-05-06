import { useMemo } from 'react'
import {
  Router as RouterIcon,
  ChevronRight,
  ArrowLeft,
  Cpu,
  MapPin,
  Trash2,
} from 'lucide-react'
import type {
  DeviceStore,
  Gateway,
  GatewayStore,
  Sensor,
  SensorStore,
} from '../../types'
import { sensorsOfGateway } from '../../lib/mock'

type Props = {
  gateways: GatewayStore
  sensors: SensorStore
  devices: DeviceStore
  onOpenGateway: (id: string) => void
  onOpenSensor: (id: string) => void
}

export type DetailProps = {
  gatewayId: string
  gateways: GatewayStore
  sensors: SensorStore
  devices: DeviceStore
  onBack: () => void
  onOpenSensor: (id: string) => void
}

function fmtDateTime(d?: Date): string {
  if (!d) return '-'
  return d.toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function GatewaysView({
  gateways,
  sensors,
  onOpenGateway,
}: Props) {
  const list: Gateway[] = useMemo(
    () => Object.values(gateways).sort((a, b) => a.id.localeCompare(b.id)),
    [gateways],
  )

  if (list.length === 0) {
    return (
      <div className="dashboard-view">
        <header className="view-header">
          <div className="view-header-text">
            <h1>ゲートウェイ</h1>
            <p>ゲートウェイは登録されていません。CSV をインポートすると自動で割り当てられます。</p>
          </div>
        </header>
      </div>
    )
  }

  return (
    <div className="dashboard-view">
      <header className="view-header">
        <div className="view-header-text">
          <h1>ゲートウェイ</h1>
          <p>センサーの親機となるゲートウェイの一覧です。</p>
        </div>
      </header>

      <section className="panel-card">
        <div className="panel-card-head">
          <h2>ゲートウェイ一覧</h2>
          <span className="panel-card-meta">{list.length} 台</span>
        </div>
        <div className="device-table-wrap">
          <table className="device-table">
            <thead>
              <tr>
                <th>名前</th>
                <th>ID</th>
                <th>モデル / メーカー</th>
                <th>シリアル番号</th>
                <th>設置場所</th>
                <th className="num">接続センサー</th>
                <th aria-label="操作"></th>
              </tr>
            </thead>
            <tbody>
              {list.map((gw) => {
                const linked = sensorsOfGateway(sensors, gw.id)
                return (
                  <tr key={gw.id} className="device-row" onClick={() => onOpenGateway(gw.id)}>
                    <td>
                      <div className="device-id">
                        <span className="device-id-name">
                          <RouterIcon size={14} className="row-icon" />
                          {gw.name}
                        </span>
                      </div>
                    </td>
                    <td>
                      <span className="mono">{gw.id}</span>
                    </td>
                    <td>
                      <div className="device-id">
                        <span className="device-id-name">{gw.model}</span>
                        <span className="device-id-sub">{gw.manufacturer}</span>
                      </div>
                    </td>
                    <td>
                      <span className="mono">{gw.serialNumber}</span>
                    </td>
                    <td>
                      <span className="location-cell">
                        <MapPin size={12} />
                        {gw.location}
                      </span>
                    </td>
                    <td className="num">{linked.length} 台</td>
                    <td className="row-actions" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label={`${gw.name} を開く`}
                        onClick={() => onOpenGateway(gw.id)}
                      >
                        <ChevronRight size={18} />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

export function GatewayDetailView({
  gatewayId,
  gateways,
  sensors,
  devices,
  onBack,
  onOpenSensor,
}: DetailProps) {
  const gateway = gateways[gatewayId]
  const linkedSensorIds = useMemo(
    () => sensorsOfGateway(sensors, gatewayId),
    [sensors, gatewayId],
  )
  const linkedSensors: Sensor[] = linkedSensorIds
    .map((id) => sensors[id])
    .filter((s): s is Sensor => Boolean(s))

  if (!gateway) {
    return (
      <div className="dashboard-view">
        <div className="breadcrumb">
          <button type="button" className="link-btn" onClick={onBack}>
            <ArrowLeft size={14} />
            <span>ゲートウェイ一覧</span>
          </button>
        </div>
        <p className="muted">指定されたゲートウェイは見つかりません。</p>
      </div>
    )
  }

  return (
    <div className="dashboard-view">
      <div className="breadcrumb">
        <button type="button" className="link-btn" onClick={onBack}>
          <ArrowLeft size={14} />
          <span>ゲートウェイ一覧</span>
        </button>
        <ChevronRight size={14} className="bc-sep" />
        <span className="bc-current">{gateway.name}</span>
      </div>

      <header className="view-header">
        <div className="view-header-text">
          <h1 className="device-title">
            <RouterIcon size={22} className="head-icon" />
            <span className="device-title-id">{gateway.name}</span>
          </h1>
          <p>
            {gateway.model} ・ {gateway.manufacturer} ・ {linkedSensors.length} 台のセンサーを接続
          </p>
        </div>
      </header>

      <section className="panel-card">
        <div className="panel-card-head">
          <h2>ゲートウェイ情報</h2>
        </div>
        <div className="meta-grid">
          <div className="meta-item">
            <span className="meta-item-label">ID</span>
            <span className="meta-item-value mono">{gateway.id}</span>
          </div>
          <div className="meta-item">
            <span className="meta-item-label">シリアル番号</span>
            <span className="meta-item-value mono">{gateway.serialNumber}</span>
          </div>
          <div className="meta-item">
            <span className="meta-item-label">モデル</span>
            <span className="meta-item-value">{gateway.model}</span>
          </div>
          <div className="meta-item">
            <span className="meta-item-label">メーカー</span>
            <span className="meta-item-value">{gateway.manufacturer}</span>
          </div>
          <div className="meta-item">
            <span className="meta-item-label">設置場所</span>
            <span className="meta-item-value">{gateway.location}</span>
          </div>
          <div className="meta-item">
            <span className="meta-item-label">登録日時</span>
            <span className="meta-item-value mono">{fmtDateTime(gateway.registeredAt)}</span>
          </div>
        </div>
      </section>

      <section className="panel-card">
        <div className="panel-card-head">
          <h2>
            <Cpu size={16} className="head-icon" />
            接続されているセンサー
          </h2>
          <span className="panel-card-meta">{linkedSensors.length} 台</span>
        </div>
        {linkedSensors.length === 0 ? (
          <p className="muted in-panel">接続されているセンサーはありません。</p>
        ) : (
          <div className="device-table-wrap">
            <table className="device-table">
              <thead>
                <tr>
                  <th>名前</th>
                  <th>デバイス番号</th>
                  <th>モデル</th>
                  <th>シリアル番号</th>
                  <th className="num">バッテリー</th>
                  <th>最終受信</th>
                  <th aria-label="操作"></th>
                </tr>
              </thead>
              <tbody>
                {linkedSensors.map((s) => {
                  const lastReadingAt = (devices[s.id] ?? [])[(devices[s.id] ?? []).length - 1]
                    ?.measuredAt
                  return (
                    <tr
                      key={s.id}
                      className="device-row"
                      onClick={() => onOpenSensor(s.id)}
                    >
                      <td>
                        <div className="device-id">
                          <span className="device-id-name">{s.id}</span>
                        </div>
                      </td>
                      <td>
                        <span className="mono">{s.deviceNumber}</span>
                      </td>
                      <td>{s.model}</td>
                      <td>
                        <span className="mono">{s.serialNumber}</span>
                      </td>
                      <td className="num">{s.battery}%</td>
                      <td className="updated-cell">
                        {fmtDateTime(lastReadingAt ?? s.lastSeenAt)}
                      </td>
                      <td className="row-actions" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          className="icon-btn"
                          aria-label={`${s.id} を開く`}
                          onClick={() => onOpenSensor(s.id)}
                        >
                          <ChevronRight size={18} />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

// 未使用 import を黙らせるための再エクスポート（保留）
export const _trash = Trash2
