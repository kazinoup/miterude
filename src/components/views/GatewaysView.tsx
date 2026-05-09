/**
 * ゲートウェイ一覧 + ゲートウェイ詳細 — Phase F-3 改訂
 *
 * - 一覧: センサー一覧と同じ列カスタマイズ + 名称固定列。
 * - 詳細: タブ構成（基本情報 / アラート設定）に再編し、
 *         ゲートウェイ情報の項目をセンサー情報と揃え、
 *         区分・グループ・タグの分類エリアを追加。
 */
import { useEffect, useMemo, useState } from 'react'
import {
  Router as RouterIcon,
  ChevronRight,
  ArrowLeft,
  Cpu,
  Settings2,
  Info,
  AlertTriangle,
  Pencil,
  Wifi,
  WifiOff,
  Tag,
  X,
} from 'lucide-react'
import type {
  DeviceStore,
  Gateway,
  GatewayAlertSettings as GatewayAlertSettingsValue,
  GatewayStore,
  NotificationGroupStore,
  Sensor,
  SensorCategoryStore,
  SensorGroupStore,
  SensorStore,
} from '../../types'
import { GATEWAY_ROLE_LABELS } from '../../types'
import { sensorsOfGateway, defaultGatewayAlertSettings } from '../../lib/mock'
import { normalizeTag } from '../../lib/groups'
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
import { GatewayAlertSettings } from '../GatewayAlertSettings'

type Props = {
  gateways: GatewayStore
  sensors: SensorStore
  devices: DeviceStore
  groups: SensorGroupStore
  categories: SensorCategoryStore
  notificationGroups: NotificationGroupStore
  onOpenGateway: (id: string) => void
  onOpenSensor: (id: string) => void
  onUpdateGateway: (gatewayId: string, patch: Partial<Gateway>) => void
}

export type DetailProps = {
  gatewayId: string
  gateways: GatewayStore
  sensors: SensorStore
  devices: DeviceStore
  groups: SensorGroupStore
  categories: SensorCategoryStore
  notificationGroups: NotificationGroupStore
  onBack: () => void
  onOpenSensor: (id: string) => void
  onUpdateGateway: (gatewayId: string, patch: Partial<Gateway>) => void
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

function fmtDateOnly(d?: Date): string {
  if (!d) return '—'
  return d.toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
}

/** ホバー用の停止時間帯サマリ */
function summarizeWindows(
  list: ReadonlyArray<{
    label?: string
    enabled: boolean
    startTime: string
    endTime: string
    daysOfWeek: ReadonlyArray<number>
  }>,
): string {
  const wd = ['日', '月', '火', '水', '木', '金', '土']
  return list
    .map((w) => {
      const days =
        w.daysOfWeek.length === 0
          ? '毎日'
          : w.daysOfWeek.map((d) => wd[d]).join('')
      const status = w.enabled ? '' : '（無効）'
      const lbl = w.label ? `${w.label}: ` : ''
      return `${lbl}${days} ${w.startTime}〜${w.endTime}${status}`
    })
    .join('\n')
}

function summarizeDates(
  list: ReadonlyArray<{
    label?: string
    enabled: boolean
    startDate: string
    endDate: string
  }>,
): string {
  return list
    .map((d) => {
      const range =
        d.startDate === d.endDate
          ? d.startDate
          : `${d.startDate} 〜 ${d.endDate}`
      const status = d.enabled ? '' : '（無効）'
      const lbl = d.label ? `${d.label}: ` : ''
      return `${lbl}${range}${status}`
    })
    .join('\n')
}

/* ======================================================================
   一覧画面
   ====================================================================== */

export function GatewaysView({
  gateways,
  groups,
  categories,
  notificationGroups,
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

  /* 列の表示・並び順設定 */
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
          <p>センサーの親機・中継機となるゲートウェイの一覧です。</p>
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
        <div className="device-table-wrap">
          <table className="device-table">
            <thead>
              <tr>
                <th className="col-name">名称</th>
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
                return (
                  <tr
                    key={gw.id}
                    className="device-row"
                    onClick={() => onOpenGateway(gw.id)}
                  >
                    <td className="col-name" title={gw.name ?? gw.id}>
                      <span className="device-id-name">
                        <RouterIcon size={14} className="row-icon" />
                        {gw.name ?? gw.id}
                      </span>
                    </td>
                    {visibleColumns.map((key) =>
                      renderGatewayCell(
                        key,
                        gw,
                        groups,
                        categories,
                        notificationGroups,
                      ),
                    )}
                    <td
                      className="row-actions"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label={`${gw.name ?? gw.id} を開く`}
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

/** 1 列分の <td> を描画 */
function renderGatewayCell(
  key: GatewayColumnKey,
  gw: Gateway,
  groups: SensorGroupStore,
  categories: SensorCategoryStore,
  notificationGroups: NotificationGroupStore,
) {
  switch (key) {
    case 'deviceNumber':
      return (
        <td key={key} className="cell-mono">
          {gw.deviceNumber ?? gw.id}
        </td>
      )
    case 'serialNumber':
      return (
        <td key={key} className="cell-mono cell-serial" title={gw.serialNumber}>
          {gw.serialNumber}
        </td>
      )
    case 'devEUI':
      return (
        <td key={key} className="cell-mono cell-serial" title={gw.devEUI ?? ''}>
          {gw.devEUI ?? '—'}
        </td>
      )
    case 'manufacturer':
      return <td key={key}>{gw.manufacturer}</td>
    case 'model':
      return <td key={key}>{gw.model}</td>
    case 'category': {
      // Phase F-4: ゲートウェイの「区分」は role (親機/中継機) を表示する。
      // 旧 categoryId はマイグレーションで role に変換済みで categoryId は使わない。
      void categories
      const label = GATEWAY_ROLE_LABELS[gw.role]
      return (
        <td key={key} className="col-category">
          <span className="badge badge-outline">{label}</span>
        </td>
      )
    }
    case 'group': {
      const grp = gw.groupId ? groups[gw.groupId] : undefined
      // 旧 location が残っていれば、グループ未設定時のフォールバック表示に使う
      const fallback = gw.location?.trim() || undefined
      return (
        <td key={key} className="col-group">
          {grp ? (
            <span className="badge badge-outline">{grp.name}</span>
          ) : fallback ? (
            <span className="muted">{fallback}</span>
          ) : (
            <span className="muted">—</span>
          )}
        </td>
      )
    }
    case 'tags': {
      const tags = gw.tags ?? []
      if (tags.length === 0) {
        return (
          <td key={key} className="col-tags">
            <span className="muted">—</span>
          </td>
        )
      }
      return (
        <td key={key} className="col-tags">
          {tags.slice(0, 3).map((t) => (
            <span key={t} className="badge badge-outline">
              {t}
            </span>
          ))}
          {tags.length > 3 && (
            <span className="muted">+{tags.length - 3}</span>
          )}
        </td>
      )
    }
    case 'status': {
      const online = gw.online ?? true
      return (
        <td key={key} className="col-status">
          {online ? (
            <span className="badge badge-online">
              <Wifi size={11} /> オンライン
            </span>
          ) : (
            <span className="badge badge-offline">
              <WifiOff size={11} /> オフライン
            </span>
          )}
        </td>
      )
    }
    case 'offlineAlert': {
      const a = gw.alertSettings
      return (
        <td key={key} className="col-alert">
          {a?.offlineEnabled ? (
            <span className="alert-cell-on">
              ON {a.offlineThresholdMinutes}分超
            </span>
          ) : (
            <span className="muted">OFF</span>
          )}
        </td>
      )
    }
    case 'silentTimeRanges': {
      const list = gw.alertSettings?.exclusionWindows ?? []
      if (list.length === 0) {
        return (
          <td key={key} className="num col-silent">
            <span className="muted">—</span>
          </td>
        )
      }
      return (
        <td key={key} className="num col-silent">
          <span className="silence-pill" title={summarizeWindows(list)}>
            {list.length} 件
          </span>
        </td>
      )
    }
    case 'silentDates': {
      const list = gw.alertSettings?.exclusionDates ?? []
      if (list.length === 0) {
        return (
          <td key={key} className="num col-silent">
            <span className="muted">—</span>
          </td>
        )
      }
      return (
        <td key={key} className="num col-silent">
          <span className="silence-pill" title={summarizeDates(list)}>
            {list.length} 件
          </span>
        </td>
      )
    }
    case 'notificationSetting': {
      const gid = gw.notificationGroupId
      const g = gid ? notificationGroups[gid] : undefined
      return (
        <td key={key} className="col-notification" title={g?.name ?? ''}>
          {g ? g.name : <span className="muted">—</span>}
        </td>
      )
    }
    case 'registeredAt':
      return (
        <td key={key} className="col-registeredAt">
          {fmtDateOnly(gw.registeredAt)}
        </td>
      )
    default:
      return null
  }
}

/* ======================================================================
   詳細画面
   ====================================================================== */

type DetailTab = 'basic' | 'alerts'

const DETAIL_TABS: { key: DetailTab; label: string; icon: React.ReactNode }[] =
  [
    { key: 'basic', label: '基本情報', icon: <Info size={14} /> },
    { key: 'alerts', label: 'アラート設定', icon: <AlertTriangle size={14} /> },
  ]

export function GatewayDetailView({
  gatewayId,
  gateways,
  sensors,
  devices,
  groups,
  categories,
  notificationGroups,
  onBack,
  onOpenSensor,
  onUpdateGateway,
}: DetailProps) {
  const gateway = gateways[gatewayId]
  const linkedSensorIds = useMemo(
    () => sensorsOfGateway(sensors, gatewayId),
    [sensors, gatewayId],
  )
  const linkedSensors: Sensor[] = linkedSensorIds
    .map((id) => sensors[id])
    .filter((s): s is Sensor => Boolean(s))

  const [activeTab, setActiveTab] = useState<DetailTab>('basic')
  const [tagInput, setTagInput] = useState('')

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

  const online = gateway.online ?? true
  const groupList = Object.values(groups).sort((a, b) =>
    a.name.localeCompare(b.name),
  )
  // Phase F-4: 区分は role を表示するため categoryList は不要になった。
  // categories prop は将来「ユーザー定義の運用区分」を Gateway にも持たせる時のために残す。
  void categories

  /** タグ追加ハンドラ */
  function addTag() {
    const v = normalizeTag(tagInput)
    if (!v) return
    const cur = gateway?.tags ?? []
    if (cur.includes(v)) {
      setTagInput('')
      return
    }
    onUpdateGateway(gatewayId, { tags: [...cur, v] })
    setTagInput('')
  }
  function removeTag(t: string) {
    const cur = gateway?.tags ?? []
    onUpdateGateway(gatewayId, { tags: cur.filter((x) => x !== t) })
  }

  const alertValue: GatewayAlertSettingsValue =
    gateway.alertSettings ?? defaultGatewayAlertSettings()

  return (
    <div className="device-detail-view">
      <header className="view-header">
        <div className="view-header-text">
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
            <span className="device-title-id">{gateway.name ?? gateway.id}</span>
          </h1>
        </div>
      </header>

      {/* タブ */}
      <nav className="detail-tab-bar" role="tablist" aria-label="詳細タブ">
        {DETAIL_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={activeTab === t.key}
            className={`detail-tab ${activeTab === t.key ? 'is-active' : ''}`}
            onClick={() => setActiveTab(t.key)}
          >
            {t.icon}
            <span>{t.label}</span>
          </button>
        ))}
      </nav>

      {/* === 基本情報 === */}
      {activeTab === 'basic' && (
        <>
          <section className="panel-card">
            <div className="panel-card-head">
              <h2>ゲートウェイ情報</h2>
              <div className="panel-card-meta">
                {online ? (
                  <span className="badge badge-online">
                    <Wifi size={11} /> オンライン
                  </span>
                ) : (
                  <span className="badge badge-offline">
                    <WifiOff size={11} /> オフライン
                  </span>
                )}
                <span className="muted small">変更は自動保存</span>
              </div>
            </div>

            <div className="meta-edit-grid">
              <label className="meta-edit-field meta-edit-field-name">
                <span className="meta-edit-label">名称</span>
                <input
                  type="text"
                  className="form-input"
                  value={gateway.name ?? ''}
                  onChange={(e) => {
                    const v = e.target.value
                    onUpdateGateway(gatewayId, { name: v })
                  }}
                  placeholder={gateway.id}
                />
              </label>
              <label className="meta-edit-field">
                <span className="meta-edit-label">デバイス番号</span>
                <input
                  type="text"
                  className="form-input cell-mono"
                  value={gateway.deviceNumber ?? ''}
                  onChange={(e) =>
                    onUpdateGateway(gatewayId, { deviceNumber: e.target.value })
                  }
                  placeholder={gateway.id}
                />
              </label>
              <div className="meta-edit-field">
                <span className="meta-edit-label">シリアル番号</span>
                <div className="form-input form-input-static cell-mono">
                  {gateway.serialNumber || '—'}
                </div>
              </div>

              <div className="meta-edit-field">
                <span className="meta-edit-label">メーカー</span>
                <div className="form-input form-input-static">
                  {gateway.manufacturer || '—'}
                </div>
              </div>
              <div className="meta-edit-field">
                <span className="meta-edit-label">モデル</span>
                <div className="form-input form-input-static">
                  {gateway.model || '—'}
                </div>
              </div>
              <div className="meta-edit-field">
                <span className="meta-edit-label">DevEUI（識別番号）</span>
                <div className="form-input form-input-static cell-mono">
                  {gateway.devEUI || '—'}
                </div>
              </div>
            </div>

            {/* 読み取り専用情報（最終受信 + 登録日） */}
            <div className="meta-readonly-row">
              <span className="meta-readonly-label">最終受信</span>
              <span className="meta-readonly-value mono">
                {fmtDateTime(gateway.lastSeenAt)}
              </span>
              <span className="meta-readonly-sep" aria-hidden="true">|</span>
              <span className="meta-readonly-label">登録日</span>
              <span className="meta-readonly-value mono">
                {fmtDateOnly(gateway.registeredAt)}
              </span>
            </div>
          </section>

          {/* 分類 */}
          <section className="panel-card">
            <div className="panel-card-head">
              <h2>
                <Pencil size={16} className="head-icon" />
                分類
              </h2>
              <span className="panel-card-meta muted">
                グループ・タグはゲートウェイ一覧の絞り込みなどで使えます。
              </span>
            </div>
            <div className="classify-row classify-row-3col">
              {/* Phase F-4: ゲートウェイの「区分」はモデルから決まる役割（role）を表示する。
                  ユーザーは編集できない（読み取り専用） */}
              <div className="classify-field">
                <span className="classify-label">区分</span>
                <div className="form-input form-input-static">
                  {GATEWAY_ROLE_LABELS[gateway.role]}
                </div>
              </div>

              <label className="classify-field">
                <span className="classify-label">グループ / 設置場所</span>
                <select
                  className="select"
                  value={gateway.groupId ?? ''}
                  onChange={(e) => {
                    const v = e.target.value
                    onUpdateGateway(gatewayId, { groupId: v === '' ? null : v })
                  }}
                >
                  <option value="">
                    {gateway.location?.trim()
                      ? `未分類（旧設置場所: ${gateway.location}）`
                      : '未分類'}
                  </option>
                  {groupList.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="classify-field">
                <span className="classify-label">タグ</span>
                <div className="classify-tags-wrap">
                  <input
                    type="text"
                    className="form-input"
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ',') {
                        e.preventDefault()
                        addTag()
                      }
                    }}
                    placeholder="タグを入力して Enter"
                  />
                  <div className="classify-tag-list">
                    {(gateway.tags ?? []).map((t) => (
                      <span key={t} className="badge badge-outline tag-pill">
                        <Tag size={11} strokeWidth={2.2} /> {t}
                        <button
                          type="button"
                          className="tag-pill-close"
                          aria-label={`${t} を削除`}
                          onClick={() => removeTag(t)}
                        >
                          <X size={11} />
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              </label>
            </div>
          </section>

          {/* 接続されているセンサー */}
          <section className="panel-card">
            <div className="panel-card-head">
              <h2>
                <Cpu size={16} className="head-icon" />
                接続されているセンサー
              </h2>
              <span className="panel-card-meta">{linkedSensors.length} 台</span>
            </div>
            {linkedSensors.length === 0 ? (
              <p className="muted in-panel">
                接続されているセンサーはありません。
              </p>
            ) : (
              <div className="device-table-wrap">
                <table className="device-table">
                  <thead>
                    <tr>
                      <th>名称</th>
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
                      const lastReadingAt = (devices[s.id] ?? [])[
                        (devices[s.id] ?? []).length - 1
                      ]?.measuredAt
                      return (
                        <tr
                          key={s.id}
                          className="device-row"
                          onClick={() => onOpenSensor(s.id)}
                        >
                          <td>
                            <span className="device-id-name">
                              {s.name ?? s.id}
                            </span>
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
                          <td
                            className="row-actions"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              className="icon-btn"
                              aria-label={`${s.name ?? s.id} を開く`}
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
        </>
      )}

      {/* === アラート設定 === */}
      {activeTab === 'alerts' && (
        <GatewayAlertSettings
          gatewayId={gatewayId}
          value={alertValue}
          onChange={(next) => onUpdateGateway(gatewayId, { alertSettings: next })}
          notificationGroups={notificationGroups}
          notificationGroupId={gateway.notificationGroupId ?? null}
          onNotificationGroupChange={(id) =>
            onUpdateGateway(gatewayId, { notificationGroupId: id })
          }
        />
      )}
    </div>
  )
}

