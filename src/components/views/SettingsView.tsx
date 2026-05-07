import { useMemo, useState } from 'react'
import {
  Settings,
  Plus,
  Pencil,
  Trash2,
  Bell,
  Plug,
  Cpu,
  Router as RouterIcon,
  ShieldCheck,
  ShieldOff,
  Mail,
  MessageSquare,
  Webhook,
  Sliders,
  FileText,
  CheckCircle2,
  Clock,
  Boxes,
} from 'lucide-react'
import type {
  DeviceStore,
  ManufacturerIntegration,
  ManufacturerIntegrationStore,
  NotificationGroup,
  NotificationGroupStore,
  SensorStore,
  ThresholdTemplate,
  ThresholdTemplateStore,
} from '../../types'
import { NOTIFICATION_TIMING_LABELS, SENSOR_KIND_DEFS } from '../../types'
import {
  MANUFACTURERS,
  devicesByManufacturer,
  type SupportedDevice,
} from '../../lib/supportedDevices'
import { CsvImportButton } from '../CsvImportButton'
import { NotificationGroupEditDialog } from '../NotificationGroupEditDialog'
import { ManufacturerIntegrationDialog } from '../ManufacturerIntegrationDialog'
import { ThresholdTemplateEditDialog } from '../ThresholdTemplateEditDialog'

type Props = {
  notificationGroups: NotificationGroupStore
  manufacturerIntegrations: ManufacturerIntegrationStore
  sensors: SensorStore
  thresholdTemplates: ThresholdTemplateStore
  onUpsertNotificationGroup: (g: NotificationGroup) => void
  onDeleteNotificationGroup: (id: string) => void
  onUpdateIntegration: (i: ManufacturerIntegration) => void
  onUpsertThresholdTemplate: (t: ThresholdTemplate) => void
  onDeleteThresholdTemplate: (id: string) => void
  /** Phase E-3: 連携設定リストの各メーカー行から CSV を直接取り込めるようにする */
  devices: DeviceStore
  onDevicesChange: (next: DeviceStore) => void
}

type Tab = 'integrations' | 'notifications' | 'thresholds' | 'devices'

const TABS: { key: Tab; label: string; icon: React.ComponentType<{ size?: number }> }[] = [
  { key: 'integrations', label: '連携設定', icon: Plug },
  { key: 'notifications', label: '通知グループ', icon: Bell },
  { key: 'thresholds', label: '閾値テンプレート', icon: Sliders },
  { key: 'devices', label: '対応デバイス', icon: Boxes },
]

function countByGroup(sensors: SensorStore, groupId: string): number {
  let n = 0
  for (const s of Object.values(sensors)) {
    if (s.notificationGroupId === groupId) n++
  }
  return n
}

/** テンプレ内容のかんたんなサマリ表示（例: "温度 0〜10℃ / 湿度 40〜85%"） */
function summarizeTemplate(t: ThresholdTemplate): string {
  if (t.thresholds.kind !== 'temperature-humidity') return '—'
  const parts: string[] = []
  const tt = t.thresholds.temperature
  const hh = t.thresholds.humidity
  if (tt.alert.enabled && (tt.alert.min != null || tt.alert.max != null)) {
    parts.push(formatLevelSummary('温度', tt.alert.min, tt.alert.max, '℃'))
  }
  if (hh.alert.enabled && (hh.alert.min != null || hh.alert.max != null)) {
    parts.push(formatLevelSummary('湿度', hh.alert.min, hh.alert.max, '%'))
  }
  return parts.length > 0 ? parts.join(' / ') : '判定対象なし'
}

function formatLevelSummary(
  label: string,
  min: number | undefined,
  max: number | undefined,
  unit: string,
): string {
  if (min != null && max != null) return `${label} ${min}〜${max}${unit}`
  if (min != null) return `${label} ${min}${unit}以上`
  if (max != null) return `${label} ${max}${unit}以下`
  return label
}

function DeviceCard({ device }: { device: SupportedDevice }) {
  const [imgError, setImgError] = useState(false)
  const showImage = device.imageUrl && !imgError
  const FallbackIcon = device.category === 'sensor' ? Cpu : RouterIcon
  return (
    <article
      className={`supported-device-card ${device.supported ? '' : 'is-future'}`}
    >
      <div className="supported-device-image-wrap">
        {showImage ? (
          <img
            src={device.imageUrl}
            alt={device.model}
            className="supported-device-image"
            onError={() => setImgError(true)}
            loading="lazy"
          />
        ) : (
          <div className="supported-device-image-fallback" aria-hidden="true">
            <FallbackIcon size={32} strokeWidth={1.4} />
          </div>
        )}
      </div>
      <div className="supported-device-card-body">
        {!device.supported && (
          <header className="supported-device-card-head">
            <span className="supported-device-badge supported-device-badge-future">
              <Clock size={11} strokeWidth={2.4} />
              対応予定
            </span>
          </header>
        )}
        <h4 className="supported-device-model">{device.model}</h4>
        <p className="supported-device-type muted">{device.typeLabel}</p>
        <p className="supported-device-desc">{device.description}</p>
      </div>
    </article>
  )
}

function ChannelBadge({ channel }: { channel: NotificationGroup['channels'][number] }) {
  const Icon =
    channel.kind === 'email'
      ? Mail
      : channel.kind === 'slack'
        ? MessageSquare
        : Webhook
  return (
    <span className="badge badge-outline">
      <Icon size={11} />
      {channel.target || '（未設定）'}
    </span>
  )
}

export function SettingsView({
  notificationGroups,
  manufacturerIntegrations,
  sensors,
  thresholdTemplates,
  onUpsertNotificationGroup,
  onDeleteNotificationGroup,
  onUpdateIntegration,
  onUpsertThresholdTemplate,
  onDeleteThresholdTemplate,
  devices,
  onDevicesChange,
}: Props) {
  const [tab, setTab] = useState<Tab>('integrations')
  const [thresholdEditDialog, setThresholdEditDialog] = useState<{
    open: boolean
    initial: ThresholdTemplate | null
  }>({ open: false, initial: null })

  const [groupDialog, setGroupDialog] = useState<{
    open: boolean
    initial: NotificationGroup | null
  }>({ open: false, initial: null })

  const [integrationDialog, setIntegrationDialog] = useState<{
    open: boolean
    initial: ManufacturerIntegration | null
  }>({ open: false, initial: null })

  const groupList = useMemo(
    () =>
      Object.values(notificationGroups).sort((a, b) => a.name.localeCompare(b.name)),
    [notificationGroups],
  )

  const integrationList = useMemo(() => {
    // 対応デバイスタブと同じ並び（MANUFACTURERS の宣言順）に揃える。
    // Milesight が先、IoT Mobile が後ろ。マスタに無いメーカーは末尾に
    // 名前順で並べる（将来増えても破綻しないように）。
    const orderIndex = new Map<string, number>()
    MANUFACTURERS.forEach((m, idx) => {
      orderIndex.set(m.name, idx)
    })
    const FAR = Number.MAX_SAFE_INTEGER
    return Object.values(manufacturerIntegrations).sort((a, b) => {
      const ai = orderIndex.get(a.manufacturer) ?? FAR
      const bi = orderIndex.get(b.manufacturer) ?? FAR
      if (ai !== bi) return ai - bi
      return a.manufacturer.localeCompare(b.manufacturer)
    })
  }, [manufacturerIntegrations])

  return (
    <div className="settings-view">
      <header className="view-header">
        <div className="view-header-text">
          <h1>
            <Settings size={20} className="head-icon" />
            設定
          </h1>
          <p>連携デバイス、通知の送信先、センサー種別を設定します。</p>
        </div>
      </header>

      <nav className="settings-tabs" role="tablist">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={`settings-tab ${tab === key ? 'is-active' : ''}`}
            onClick={() => setTab(key)}
          >
            <Icon size={15} />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      {tab === 'integrations' && (
        <section className="panel-card">
          <div className="panel-card-head">
            <h2>
              <Plug size={16} className="head-icon" />
              連携設定
            </h2>
            <span className="panel-card-meta">
              Webhook を受け取って計測データを取り込むメーカー連携の一覧です。
            </span>
          </div>
          <p className="muted in-panel multiline-help">
            <span>
              ミテルデ側で対応しているメーカーの連携 ON/OFF と、
              受信用シークレットを管理します。
            </span>
            <span>
              項目をクリックすると、連携状態・取扱種別・シークレットを編集できます。
            </span>
          </p>

          {integrationList.length === 0 ? (
            <p className="muted in-panel">連携できるメーカーがまだありません。</p>
          ) : (
            <ul className="template-list">
              {integrationList.map((i) => (
                <li key={i.id} className="template-list-item">
                  <div className="template-list-main">
                    <div className="template-list-name-row">
                      <button
                        type="button"
                        className="template-list-name-btn"
                        onClick={() =>
                          setIntegrationDialog({ open: true, initial: i })
                        }
                        title="設定"
                      >
                        <Plug size={13} />
                        <strong className="template-list-name">
                          {i.manufacturer}
                        </strong>
                      </button>
                      <span
                        className={`badge ${i.enabled ? 'badge-online' : 'badge-offline'}`}
                      >
                        {i.enabled ? (
                          <>
                            <ShieldCheck size={11} strokeWidth={2.2} />
                            連携中
                          </>
                        ) : (
                          <>
                            <ShieldOff size={11} strokeWidth={2.2} />
                            停止中
                          </>
                        )}
                      </span>
                    </div>
                    <span className="template-list-summary">
                      取扱種別:{' '}
                      {i.sensorKinds.length === 0
                        ? '—'
                        : i.sensorKinds
                            .map((k) => SENSOR_KIND_DEFS[k]?.label ?? k)
                            .join(', ')}
                      {' ・ '}
                      シークレット:{' '}
                      <span className="mono">
                        {i.webhookSecret
                          ? `${i.webhookSecret.slice(0, 6)}…`
                          : '未設定'}
                      </span>
                    </span>
                  </div>
                  <div className="template-list-actions">
                    {/* Phase E-3: 連携 ON のメーカーは CSV を直接取り込めるアイコンを表示。
                     *   メーカーごとにフォーマットが将来異なる場合に備えて、現状の汎用パーサに
                     *   そのまま流す（差分はパーサ層で吸収する想定）。 */}
                    <CsvImportButton
                      devices={devices}
                      onDevicesChange={onDevicesChange}
                      iconOnly
                      label={`${i.manufacturer} の CSV を取り込む`}
                      className={i.enabled ? '' : 'is-muted'}
                    />
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label="設定"
                      onClick={() =>
                        setIntegrationDialog({ open: true, initial: i })
                      }
                    >
                      <Pencil size={14} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === 'notifications' && (
        <section className="panel-card">
          <div className="panel-card-head">
            <h2>
              <Bell size={16} className="head-icon" />
              通知グループ
            </h2>
            <div className="panel-card-meta">
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => setGroupDialog({ open: true, initial: null })}
              >
                <Plus size={14} />
                <span>新規作成</span>
              </button>
            </div>
          </div>
          <p className="muted in-panel multiline-help">
            <span>
              逸脱・オフライン通知の送信先と送信タイミングをグループ化して管理できます。
            </span>
            <span>
              各センサーのアラート設定から、どの通知グループを使うか選択できます。
            </span>
          </p>

          {groupList.length === 0 ? (
            <p className="muted in-panel">通知グループがまだありません。</p>
          ) : (
            <ul className="template-list">
              {groupList.map((g) => {
                const linked = countByGroup(sensors, g.id)
                return (
                  <li key={g.id} className="template-list-item">
                    <div className="template-list-main">
                      <button
                        type="button"
                        className="template-list-name-btn"
                        onClick={() =>
                          setGroupDialog({ open: true, initial: g })
                        }
                        title="編集"
                      >
                        <Bell size={13} />
                        <strong className="template-list-name">{g.name}</strong>
                      </button>
                      {g.description && (
                        <span className="template-list-desc muted">
                          {g.description}
                        </span>
                      )}
                      <span className="template-list-summary">
                        {NOTIFICATION_TIMING_LABELS[g.timing]} ・ 紐付き {linked} 台
                      </span>
                      <div className="template-list-channels">
                        <span className="muted">送信先:</span>
                        {g.channels.length === 0 ? (
                          <span className="muted">未設定</span>
                        ) : (
                          g.channels.map((c) => (
                            <ChannelBadge key={c.id} channel={c} />
                          ))
                        )}
                      </div>
                    </div>
                    <div className="template-list-actions">
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label="編集"
                        onClick={() =>
                          setGroupDialog({ open: true, initial: g })
                        }
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        type="button"
                        className="icon-btn icon-btn-danger"
                        aria-label="削除"
                        onClick={() => {
                          if (
                            confirm(`通知グループ「${g.name}」を削除しますか？`)
                          ) {
                            onDeleteNotificationGroup(g.id)
                          }
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      )}

      {tab === 'thresholds' && (
        <section className="panel-card">
          <div className="panel-card-head">
            <h2>
              <Sliders size={16} className="head-icon" />
              閾値テンプレート
            </h2>
            <div className="panel-card-meta">
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() =>
                  setThresholdEditDialog({ open: true, initial: null })
                }
              >
                <Plus size={14} />
                <span>新しいテンプレート</span>
              </button>
            </div>
          </div>
          <p className="muted in-panel multiline-help">
            <span>
              よく使う閾値の組み合わせを保存しておくと、各センサーや一括選択でまとめて適用できます。
            </span>
            <span>
              テンプレートを編集しても、すでに適用済みのセンサー側の値は変わりません（スナップショット方式）。
            </span>
          </p>

          {Object.keys(thresholdTemplates).length === 0 ? (
            <p className="muted in-panel">テンプレートがまだありません。</p>
          ) : (
            <ul className="template-list">
              {Object.values(thresholdTemplates)
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((t) => (
                  <li key={t.id} className="template-list-item">
                    <div className="template-list-main">
                      <button
                        type="button"
                        className="template-list-name-btn"
                        onClick={() =>
                          setThresholdEditDialog({ open: true, initial: t })
                        }
                        title="編集"
                      >
                        <FileText size={13} />
                        <strong className="template-list-name">{t.name}</strong>
                      </button>
                      {t.description && (
                        <span className="template-list-desc muted">
                          {t.description}
                        </span>
                      )}
                      <span className="template-list-summary">
                        {summarizeTemplate(t)}
                      </span>
                    </div>
                    <div className="template-list-actions">
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label="編集"
                        onClick={() =>
                          setThresholdEditDialog({ open: true, initial: t })
                        }
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        type="button"
                        className="icon-btn icon-btn-danger"
                        aria-label="削除"
                        onClick={() => {
                          if (
                            confirm(
                              `テンプレート「${t.name}」を削除しますか？`,
                            )
                          ) {
                            onDeleteThresholdTemplate(t.id)
                          }
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </li>
                ))}
            </ul>
          )}
        </section>
      )}

      {tab === 'devices' && (
        <section className="panel-card">
          <div className="panel-card-head">
            <h2>
              <Boxes size={16} className="head-icon" />
              対応デバイス
            </h2>
            <span className="panel-card-meta">
              ミテルデで取り扱える対象デバイスの一覧です。今後随時追加していきます。
            </span>
          </div>
          <p className="muted in-panel">
            別メーカーのセンサーとゲートウェイを混在させることはできません。
            導入時はメーカー単位で組み合わせてください。
          </p>

          {MANUFACTURERS.map((m) => {
            const list = devicesByManufacturer(m.key)
            if (list.length === 0) return null
            return (
              <div key={m.key} className="manufacturer-section">
                <header className="manufacturer-section-head">
                  <div className="manufacturer-section-title-row">
                    <h3 className="manufacturer-section-name">{m.name}</h3>
                    {m.supported ? (
                      <span className="supported-device-badge supported-device-badge-active">
                        <CheckCircle2 size={11} strokeWidth={2.4} />
                        対応中
                      </span>
                    ) : (
                      <span className="supported-device-badge supported-device-badge-future">
                        <Clock size={11} strokeWidth={2.4} />
                        対応予定
                      </span>
                    )}
                  </div>
                  {m.description && (
                    <p className="manufacturer-section-desc muted">
                      {m.description}
                    </p>
                  )}
                </header>
                <div className="supported-device-grid">
                  {list.map((d) => (
                    <DeviceCard key={d.id} device={d} />
                  ))}
                </div>
              </div>
            )
          })}
        </section>
      )}

      <NotificationGroupEditDialog
        open={groupDialog.open}
        initial={groupDialog.initial}
        onClose={() => setGroupDialog({ open: false, initial: null })}
        onSubmit={(g) => {
          onUpsertNotificationGroup(g)
          setGroupDialog({ open: false, initial: null })
        }}
        onDelete={
          groupDialog.initial
            ? (id) => {
                onDeleteNotificationGroup(id)
                setGroupDialog({ open: false, initial: null })
              }
            : undefined
        }
      />

      <ManufacturerIntegrationDialog
        open={integrationDialog.open}
        initial={integrationDialog.initial}
        onClose={() => setIntegrationDialog({ open: false, initial: null })}
        onSubmit={(i) => {
          onUpdateIntegration(i)
          setIntegrationDialog({ open: false, initial: null })
        }}
      />

      <ThresholdTemplateEditDialog
        open={thresholdEditDialog.open}
        initial={thresholdEditDialog.initial}
        onClose={() => setThresholdEditDialog({ open: false, initial: null })}
        onSubmit={(t) => {
          onUpsertThresholdTemplate(t)
          setThresholdEditDialog({ open: false, initial: null })
        }}
      />
    </div>
  )
}
