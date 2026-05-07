import { useEffect, useMemo, useState } from 'react'
import {
  Router as RouterIcon,
  ChevronRight,
  ArrowLeft,
  Cpu,
  MapPin,
  Settings2,
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
import {
  GATEWAY_COLUMN_DEFS,
  loadColumnOrder,
  loadColumnVisibility,
  saveColumnOrder,
  saveColumnVisibility,
  type GatewayColumnKey,
  type GatewayColumnVisibility,
} from '../../lib/gatewayColumns'
import { GatewayColumnSettingsDialog } from '../GatewayColumnSettingsDialog'

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
  // ワイド表示固定（センサー一覧と同じ扱い）
  useEffect(() => {
    const el = document.querySelector('.app-content-inner')
    if (!el) return
    el.classList.add('is-wide')
    return () => {
      el.classList.remove('is-wide')
    }
  }, [])

  const list: Gateway[] = useMemo(
    () => Object.values(gateways).sort((a, b) => a.id.localeCompare(b.id)),
    [gateways],
  )

  /* Phase: 列の表示・並び順設定 */
  const [columnVisibility, setColumnVisibility] =
    useState<GatewayColumnVisibility>(() => loadColumnVisibility())
  useEffect(() => {
    saveColumnVisibility(columnVisibility)
  }, [columnVisibility])

  const [columnOrder, setColumnOrder] = useState<GatewayColumnKey[]>(() =>
    loadColumnOrder(),
  )
  useEffect(() => {
    saveColumnOrder(columnOrder)
  }, [columnOrder])

  const [columnSettingsOpen, setColumnSettingsOpen] = useState(false)

  const DEFS_MAP = useMemo(
    () => Object.fromEntries(GATEWAY_COLUMN_DEFS.map((d) => [d.key, d])),
    [],
  )
  /** 表示する列 = 並び順 × 表示 ON のみ */
  const visibleColumns = columnOrder.filter((k) => columnVisibility[k])

  if (list.length === 0) {
    return (
      <div className="dashboard-view">
        <header className="view-header">
          <div className="view-header-text">
            <h1>
              <RouterIcon size={20} className="head-icon" />
              ゲートウェイ
            </h1>
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
          <h1>
            <RouterIcon size={20} className="head-icon" />
            ゲートウェイ
          </h1>
          <p>センサーの親機となるゲートウェイの一覧です。</p>
        </div>
        <div className="view-header-actions">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setColumnSettingsOpen(true)}
          >
            <Settings2 size={14} />
            <span>表示設定</span>
          </button>
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
                {visibleColumns.map((key) => {
                  const def = DEFS_MAP[key]
                  if (!def) return null
                  return (
                    <th key={key} className={def.numeric ? 'num' : ''}>
                      {def.label}
                    </th>
                  )
                })}
                <th aria-label="操作"></th>
              </tr>
            </thead>
            <tbody>
              {list.map((gw) => {
                const linked = sensorsOfGateway(sensors, gw.id)
                return (
                  <tr
                    key={gw.id}
                    className="device-row"
                    onClick={() => onOpenGateway(gw.id)}
                  >
                    <td>
                      <div className="device-id">
                        <span className="device-id-name">
                          <RouterIcon size={14} className="row-icon" />
                          {gw.name}
                        </span>
                      </div>
                    </td>
                    {visibleColumns.map((key) => {
                      switch (key) {
                        case 'id':
                          return (
                            <td key={key}>
                              <span className="mono">{gw.id}</span>
                            </td>
                          )
                        case 'manufacturer':
                          return <td key={key}>{gw.manufacturer}</td>
                        case 'model':
                          return <td key={key}>{gw.model}</td>
                        case 'serialNumber':
                          return (
                            <td key={key}>
                              <span className="mono">{gw.serialNumber}</span>
                            </td>
                          )
                        case 'location':
                          return (
                            <td key={key}>
                              <span className="location-cell">
                                <MapPin size={12} />
                                {gw.location}
                              </span>
                            </td>
                          )
                        case 'linkedCount':
                          return (
                            <td key={key} className="num">
                              {linked.length} 台
                            </td>
                          )
                        default:
                          return null
                      }
                    })}
                    <td
                      className="row-actions"
                      onClick={(e) => e.stopPropagation()}
                    >
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

      <GatewayColumnSettingsDialog
        open={columnSettingsOpen}
        visibility={columnVisibility}
        onChange={setColumnVisibility}
        order={columnOrder}
        onOrderChange={setColumnOrder}
        onClose={() => setColumnSettingsOpen(false)}
      />
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
      <header className="view-header">
        <div className="view-header-text">
          {/* 1 行に集約: 「← 戻る  ゲートウェイ > [ゲートウェイ名]」 */}
          <h1 className="device-title detail-title-line">
            <button
              type="button"
              className="detail-back-btn"
              onClick={onBack}
              aria-label="戻る"
            >
              <ArrowLeft size={16} />
              <span>戻る</span>
            </button>
            <span className="detail-title-sep">ゲートウェイ</span>
            <ChevronRight size={14} className="bc-sep" />
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
