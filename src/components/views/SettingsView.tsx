import { useMemo, useState } from 'react'
import {
  Settings,
  Plus,
  Pencil,
  Trash2,
  Bell,
  Plug,
  Cpu,
  ShieldCheck,
  ShieldOff,
  Mail,
  MessageSquare,
  Webhook,
  Sliders,
} from 'lucide-react'
import type {
  ManufacturerIntegration,
  ManufacturerIntegrationStore,
  NotificationGroup,
  NotificationGroupStore,
  SensorKind,
  SensorStore,
  ThresholdTemplate,
  ThresholdTemplateStore,
} from '../../types'
import { NOTIFICATION_TIMING_LABELS, SENSOR_KIND_DEFS } from '../../types'
import { NotificationGroupEditDialog } from '../NotificationGroupEditDialog'
import { ManufacturerIntegrationDialog } from '../ManufacturerIntegrationDialog'
import { ThresholdTemplateManageDialog } from '../ThresholdTemplateManageDialog'

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
}

type Tab = 'integrations' | 'notifications' | 'thresholds' | 'kinds'

const TABS: { key: Tab; label: string; icon: React.ComponentType<{ size?: number }> }[] = [
  { key: 'integrations', label: 'デバイス連携', icon: Plug },
  { key: 'notifications', label: '通知グループ', icon: Bell },
  { key: 'thresholds', label: '閾値テンプレート', icon: Sliders },
  { key: 'kinds', label: 'センサー種別', icon: Cpu },
]

function countByGroup(sensors: SensorStore, groupId: string): number {
  let n = 0
  for (const s of Object.values(sensors)) {
    if (s.notificationGroupId === groupId) n++
  }
  return n
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
}: Props) {
  const [tab, setTab] = useState<Tab>('integrations')
  const [thresholdDialogOpen, setThresholdDialogOpen] = useState(false)

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

  const integrationList = useMemo(
    () =>
      Object.values(manufacturerIntegrations).sort((a, b) =>
        a.manufacturer.localeCompare(b.manufacturer),
      ),
    [manufacturerIntegrations],
  )

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
            <h2>サポート対象</h2>
            <span className="panel-card-meta">
              Webhook を受け取って計測データを取り込みます。
            </span>
          </div>
          <div className="device-table-wrap">
            <table className="device-table">
              <thead>
                <tr>
                  <th>メーカー</th>
                  <th>連携状態</th>
                  <th>取扱種別</th>
                  <th>シークレット</th>
                  <th aria-label="操作"></th>
                </tr>
              </thead>
              <tbody>
                {integrationList.map((i) => (
                  <tr
                    key={i.id}
                    className="device-row"
                    onClick={() => setIntegrationDialog({ open: true, initial: i })}
                  >
                    <td>
                      <div className="device-id">
                        <span className="device-id-name">{i.manufacturer}</span>
                      </div>
                    </td>
                    <td>
                      <span className={`badge ${i.enabled ? 'badge-online' : 'badge-offline'}`}>
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
                    </td>
                    <td>
                      <div className="kind-chip-row">
                        {i.sensorKinds.length === 0 ? (
                          <span className="muted">-</span>
                        ) : (
                          i.sensorKinds.map((k) => (
                            <span key={k} className="kind-chip">
                              {SENSOR_KIND_DEFS[k]?.label ?? k}
                            </span>
                          ))
                        )}
                      </div>
                    </td>
                    <td>
                      <span className="mono">
                        {i.webhookSecret
                          ? `${i.webhookSecret.slice(0, 6)}…`
                          : '-'}
                      </span>
                    </td>
                    <td className="row-actions" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() =>
                          setIntegrationDialog({ open: true, initial: i })
                        }
                      >
                        <Pencil size={13} />
                        <span>設定</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === 'notifications' && (
        <section className="panel-card">
          <div className="panel-card-head">
            <h2>通知グループ</h2>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => setGroupDialog({ open: true, initial: null })}
            >
              <Plus size={14} />
              <span>新規作成</span>
            </button>
          </div>

          {groupList.length === 0 ? (
            <div className="empty-state empty-state-compact">
              <h3 className="empty-title">通知グループがありません</h3>
              <p className="empty-desc">
                逸脱・オフライン通知の送信先と送信タイミングをグループ化して管理できます。
                <br />
                各センサーのアラート設定からどの通知グループを使うか選択できます。
              </p>
              <div className="empty-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => setGroupDialog({ open: true, initial: null })}
                >
                  <Plus size={16} />
                  <span>最初の通知グループを作成</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="ng-grid">
              {groupList.map((g) => {
                const linked = countByGroup(sensors, g.id)
                return (
                  <article key={g.id} className="ng-card">
                    <header className="ng-card-head">
                      <div>
                        <h3>{g.name}</h3>
                        {g.description && (
                          <p className="ng-card-desc">{g.description}</p>
                        )}
                      </div>
                      <div className="ng-card-actions">
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
                    </header>

                    <dl className="ng-card-meta">
                      <div>
                        <dt>送信タイミング</dt>
                        <dd>{NOTIFICATION_TIMING_LABELS[g.timing]}</dd>
                      </div>
                      <div>
                        <dt>紐付くセンサー</dt>
                        <dd>{linked} 台</dd>
                      </div>
                    </dl>

                    <div className="ng-channels">
                      <span className="muted">送信先:</span>
                      {g.channels.length === 0 ? (
                        <span className="muted">未設定</span>
                      ) : (
                        g.channels.map((c) => (
                          <ChannelBadge key={c.id} channel={c} />
                        ))
                      )}
                    </div>
                  </article>
                )
              })}
            </div>
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
            <span className="panel-card-meta">
              よく使う閾値の組み合わせを保存しておき、各センサーや一括選択で
              呼び出して適用できます
            </span>
          </div>
          <p className="muted in-panel">
            登録済みのテンプレート: {Object.keys(thresholdTemplates).length} 件。
            一覧の編集や新規作成は専用ダイアログから行います。
          </p>
          <div className="threshold-template-summary">
            {Object.values(thresholdTemplates)
              .sort((a, b) => a.name.localeCompare(b.name))
              .slice(0, 6)
              .map((t) => (
                <span key={t.id} className="threshold-template-chip">
                  <Sliders size={11} />
                  {t.name}
                </span>
              ))}
            {Object.keys(thresholdTemplates).length > 6 && (
              <span className="muted">…ほか</span>
            )}
          </div>
          <div className="settings-section-actions">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => setThresholdDialogOpen(true)}
            >
              <Pencil size={14} />
              <span>テンプレートを管理</span>
            </button>
          </div>
        </section>
      )}

      {tab === 'kinds' && (
        <section className="panel-card">
          <div className="panel-card-head">
            <h2>センサー種別</h2>
            <span className="panel-card-meta">
              共通のセンサーマスタに対し、種別ごとに固有のプロパティを持たせる構成です。
            </span>
          </div>
          <div className="kind-grid">
            {(Object.keys(SENSOR_KIND_DEFS) as SensorKind[]).map((k) => {
              const def = SENSOR_KIND_DEFS[k]
              return (
                <div
                  key={k}
                  className={`kind-card kind-card-static ${
                    !def.supported ? 'is-future' : ''
                  }`}
                >
                  <div className="kind-card-text">
                    <strong>
                      {def.label}
                      {def.supported && <span className="kind-supported-tag">対応中</span>}
                      {!def.supported && (
                        <span className="kind-future-tag">対応予定</span>
                      )}
                    </strong>
                    <small>{def.description}</small>
                  </div>
                </div>
              )
            })}
          </div>
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

      <ThresholdTemplateManageDialog
        open={thresholdDialogOpen}
        templates={thresholdTemplates}
        onClose={() => setThresholdDialogOpen(false)}
        onUpsert={onUpsertThresholdTemplate}
        onDelete={onDeleteThresholdTemplate}
      />
    </div>
  )
}
