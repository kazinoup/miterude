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
  FileBarChart2,
  ClipboardCheck,
  CheckCircle2,
  Clock,
  CreditCard,
} from 'lucide-react'
import type {
  DashboardReminder,
  DashboardReminderStore,
  DashboardStore,
  GatewayStore,
  InvoiceStore,
  ManufacturerIntegrationStore,
  NotificationGroup,
  NotificationGroupStore,
  Organization,
  ReportSchedule,
  ReportScheduleStore,
  SensorStore,
  ThresholdTemplate,
  ThresholdTemplateStore,
} from '../../types'
import { NOTIFICATION_TIMING_LABELS } from '../../types'
import {
  MANUFACTURERS,
  SUPPORTED_DEVICES,
  devicesByManufacturer,
  type SupportedDevice,
} from '../../lib/supportedDevices'
import { NotificationGroupEditDialog } from '../NotificationGroupEditDialog'
import { BillingTab } from '../BillingTab'
import { ThresholdTemplateEditDialog } from '../ThresholdTemplateEditDialog'
import { describeScope } from '../../lib/thresholdTemplates'
import { ReportScheduleEditDialog } from '../ReportScheduleEditDialog'
import { DashboardReminderEditDialog } from '../DashboardReminderEditDialog'

type Props = {
  notificationGroups: NotificationGroupStore
  manufacturerIntegrations: ManufacturerIntegrationStore
  sensors: SensorStore
  /** メーカー単位の登録台数集計に使う（ゲートウェイぶん） */
  gateways: GatewayStore
  thresholdTemplates: ThresholdTemplateStore
  /** 契約・支払いタブで表示するテナントの組織情報 */
  organization: Organization
  /** 請求書履歴（銀行振込テナントのみ） */
  invoices: InvoiceStore
  /** Stripe カード登録 / 削除のモック更新ハンドラ */
  onUpdateStripeCard: (
    patch: Partial<
      Pick<
        Organization,
        | 'stripeCustomerId'
        | 'stripePaymentMethodId'
        | 'cardBrand'
        | 'cardLast4'
        | 'cardExpMonth'
        | 'cardExpYear'
      >
    >,
  ) => void
  onUpsertNotificationGroup: (g: NotificationGroup) => void
  onDeleteNotificationGroup: (id: string) => void
  onUpsertThresholdTemplate: (t: ThresholdTemplate) => void
  onDeleteThresholdTemplate: (id: string) => void
  /** Phase G: レポート定期配信 */
  reportSchedules: ReportScheduleStore
  onUpsertReportSchedule: (s: ReportSchedule) => void
  onDeleteReportSchedule: (id: string) => void
  /** Phase G: ダッシュボード確認リマインド */
  dashboardReminders: DashboardReminderStore
  dashboards: DashboardStore
  onUpsertDashboardReminder: (r: DashboardReminder) => void
  onDeleteDashboardReminder: (id: string) => void
  /** 外部から特定タブで開きたい場合に指定（例: センサー一括操作から「閾値テンプレート」へ） */
  initialTab?: Tab
}

type Tab = 'billing' | 'integrations' | 'notifications' | 'thresholds'

const TABS: { key: Tab; label: string; icon: React.ComponentType<{ size?: number }> }[] = [
  // 一番左: 契約情報・支払い方法（クレジット登録 / 請求書履歴）
  { key: 'billing', label: '契約・支払い', icon: CreditCard },
  // 旧「連携設定」と「対応デバイス」を 1 タブに統合。
  // 設定編集（ON/OFF, シークレット）は admin のみで行う運用に変更したため、
  // テナント側はメーカー単位の連携状況 + 対応機種 + 自テナントの登録台数を
  // 読み取り専用で表示する画面に絞り込む。
  { key: 'integrations', label: '連携状況・対応機種', icon: Plug },
  { key: 'notifications', label: '通知設定', icon: Bell },
  { key: 'thresholds', label: 'センサー設定テンプレート', icon: Sliders },
]

function countByGroup(sensors: SensorStore, groupId: string): number {
  let n = 0
  for (const s of Object.values(sensors)) {
    if (s.notificationGroupId === groupId) n++
  }
  return n
}

const WEEKDAYS_JP = ['日', '月', '火', '水', '木', '金', '土'] as const

/** Phase G: レポート定期配信のサマリ（"毎週月曜 9:00 / 週報" など） */
function summarizeReportSchedule(s: ReportSchedule): string {
  const kind = s.reportKind === 'weekly' ? '週報' : '月報'
  if (s.reportKind === 'weekly') {
    const wd = WEEKDAYS_JP[s.weeklyDayOfWeek ?? 1]
    return `毎週${wd}曜 ${s.deliveryTime} ・ ${kind}`
  }
  return `毎月 ${s.monthlyDayOfMonth ?? 1} 日 ${s.deliveryTime} ・ ${kind}`
}

/** Phase G: ダッシュボード確認リマインドのサマリ */
function summarizeReminder(r: DashboardReminder): string {
  if (r.frequency === 'weekly') {
    const wd = WEEKDAYS_JP[r.weeklyDayOfWeek ?? 1]
    return `毎週${wd}曜 ${r.deadlineTime} までに未確認なら通知`
  }
  return `毎日 ${r.deadlineTime} までに未確認なら通知`
}

/** テンプレ内容のかんたんなサマリ表示（例: "温度 0〜10℃ / 湿度 40〜85%"）。
 *  scope.thresholds=true のテンプレートだけが温度・湿度のサマリを出す。
 *  他のスコープしか持たないテンプレートは別途 describeScope() で説明される。 */
function summarizeTemplate(t: ThresholdTemplate): string {
  if (!t.scope.thresholds || !t.thresholds) return '—'
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

function DeviceCard({
  device,
  registeredCount,
}: {
  device: SupportedDevice
  /** このテナントで現在登録されている台数。0 でも表示する（"未登録"を明示）。 */
  registeredCount?: number
}) {
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
        {/* 登録台数: undefined のときは表示しない（後方互換）。0 件のときは
            「未登録」と明示し、"対応はしているが まだこのテナントには無い"
            ことを区別できるようにする。 */}
        {registeredCount != null && device.supported && (
          <p
            className={`supported-device-registered ${registeredCount > 0 ? 'has-registered' : ''}`}
            aria-label="このテナントの登録台数"
          >
            {registeredCount > 0 ? (
              <>
                <strong>{registeredCount}</strong> 台が登録中
              </>
            ) : (
              <span className="muted">未登録</span>
            )}
          </p>
        )}
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
  gateways,
  thresholdTemplates,
  organization,
  invoices,
  onUpdateStripeCard,
  onUpsertNotificationGroup,
  onDeleteNotificationGroup,
  onUpsertThresholdTemplate,
  onDeleteThresholdTemplate,
  reportSchedules,
  onUpsertReportSchedule,
  onDeleteReportSchedule,
  dashboardReminders,
  dashboards,
  onUpsertDashboardReminder,
  onDeleteDashboardReminder,
  initialTab,
}: Props) {
  const [tab, setTab] = useState<Tab>(initialTab ?? 'billing')
  const [thresholdEditDialog, setThresholdEditDialog] = useState<{
    open: boolean
    initial: ThresholdTemplate | null
  }>({ open: false, initial: null })

  const [groupDialog, setGroupDialog] = useState<{
    open: boolean
    initial: NotificationGroup | null
  }>({ open: false, initial: null })

  /** Phase G: レポート定期配信ダイアログ */
  const [reportScheduleDialog, setReportScheduleDialog] = useState<{
    open: boolean
    initial: ReportSchedule | null
  }>({ open: false, initial: null })

  /** Phase G: ダッシュボード確認リマインドダイアログ */
  const [reminderDialog, setReminderDialog] = useState<{
    open: boolean
    initial: DashboardReminder | null
  }>({ open: false, initial: null })

  const groupList = useMemo(
    () =>
      Object.values(notificationGroups).sort((a, b) => a.name.localeCompare(b.name)),
    [notificationGroups],
  )

  /** メーカー名 → 連携の有効/無効。
   *  独立した enabled フラグは持たず、`webhookSecret` が設定済みかどうかで判定する。
   *  Secret が無ければ受信認証が通らないので「停止中」と等価。 */
  const integrationByName = useMemo(() => {
    const map = new Map<string, boolean>()
    for (const i of Object.values(manufacturerIntegrations)) {
      map.set(i.manufacturer.toLowerCase(), !!i.webhookSecret)
    }
    return map
  }, [manufacturerIntegrations])

  /** 機種 ID → このテナント内の登録台数（センサー / ゲートウェイ合算）。
   *  `Sensor.model` / `Gateway.model` の文字列を SUPPORTED_DEVICES と照合する。
   *  EM320-TH-MAGNET のような派生モデルも `EM320-TH` の登録としてカウントする
   *  （Milesight Webhook では結合済みで届くため、prefix + '-' でも一致を取る）。 */
  const registeredCountByDeviceId = useMemo(() => {
    const counts = new Map<string, number>()
    function bump(model: string | undefined) {
      if (!model) return
      const lower = model.toLowerCase()
      for (const d of SUPPORTED_DEVICES) {
        const dm = d.model.toLowerCase()
        if (lower === dm || lower.startsWith(dm + '-')) {
          counts.set(d.id, (counts.get(d.id) ?? 0) + 1)
          return
        }
      }
    }
    for (const s of Object.values(sensors)) bump(s.model)
    for (const g of Object.values(gateways)) bump(g.model)
    return counts
  }, [sensors, gateways])

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

      {tab === 'billing' && (
        <BillingTab
          organization={organization}
          invoices={invoices}
          onUpdateStripeCard={onUpdateStripeCard}
        />
      )}

      {tab === 'integrations' && (
        <section className="panel-card">
          <div className="panel-card-head">
            <h2>
              <Plug size={16} className="head-icon" />
              連携状況・対応機種
            </h2>
            <span className="panel-card-meta">
              連携の有効化や受信シークレットの設定はミテルデの運営側で行います。
              ここでは現在の連携状況と、対応している機種の一覧（と登録台数）を確認できます。
            </span>
          </div>

          {MANUFACTURERS.map((m) => {
            const enabled = integrationByName.get(m.name.toLowerCase()) ?? false
            const list = devicesByManufacturer(m.key)
            return (
              <div key={m.key} className="manufacturer-section">
                <header className="manufacturer-section-head">
                  <div className="manufacturer-section-title-row">
                    <h3 className="manufacturer-section-name">{m.name}</h3>
                    {/* メーカー単位の "対応中 / 対応予定" は機種マスタの supported を引き続き表示。
                        加えて、運営側で連携を有効化済みかどうかを 連携中 / 停止中 で示す。 */}
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
                    {m.supported && (
                      <span
                        className={`badge ${enabled ? 'badge-online' : 'badge-offline'}`}
                        title={
                          enabled
                            ? 'このテナントで連携が有効化されています'
                            : 'このテナントでは連携が停止中です（運営にご連絡ください）'
                        }
                      >
                        {enabled ? (
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
                    )}
                  </div>
                  {m.description && (
                    <p className="manufacturer-section-desc muted">
                      {m.description}
                    </p>
                  )}
                </header>
                {list.length > 0 && (
                  <div className="supported-device-grid">
                    {list.map((d) => (
                      <DeviceCard
                        key={d.id}
                        device={d}
                        registeredCount={
                          registeredCountByDeviceId.get(d.id) ?? 0
                        }
                      />
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </section>
      )}

      {tab === 'notifications' && (
        <>
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

        {/* Phase G: レポート定期配信 */}
        <section className="panel-card">
          <div className="panel-card-head">
            <h2>
              <FileBarChart2 size={16} className="head-icon" />
              レポート定期配信
            </h2>
            <div className="panel-card-meta">
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() =>
                  setReportScheduleDialog({ open: true, initial: null })
                }
              >
                <Plus size={14} />
                <span>新規作成</span>
              </button>
            </div>
          </div>
          <p className="muted in-panel multiline-help">
            <span>
              週報・月報を自動で配信します。配信タイミングを過ぎると、対象期間のレポート閲覧用リンクをメールでお送りします。
            </span>
            <span>
              ファイル添付には現状未対応のため、リンクからログインしてご確認ください。
            </span>
          </p>
          {Object.keys(reportSchedules).length === 0 ? (
            <p className="muted in-panel">定期配信がまだありません。</p>
          ) : (
            <ul className="template-list">
              {Object.values(reportSchedules)
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((s) => {
                  const ng = s.notificationGroupId
                    ? notificationGroups[s.notificationGroupId]
                    : null
                  return (
                    <li key={s.id} className="template-list-item">
                      <div className="template-list-main">
                        <div className="template-list-name-row">
                          <button
                            type="button"
                            className="template-list-name-btn"
                            onClick={() =>
                              setReportScheduleDialog({
                                open: true,
                                initial: s,
                              })
                            }
                            title="編集"
                          >
                            <FileBarChart2 size={13} />
                            <strong className="template-list-name">
                              {s.name}
                            </strong>
                          </button>
                          <span
                            className={`badge ${s.enabled ? 'badge-online' : 'badge-offline'}`}
                          >
                            {s.enabled ? '有効' : '停止中'}
                          </span>
                        </div>
                        <span className="template-list-summary">
                          {summarizeReportSchedule(s)}
                          {' ・ 対象: '}
                          {s.targetSensorIds.length === 0
                            ? '全センサー'
                            : `${s.targetSensorIds.length} 台`}
                          {' ・ 配信先: '}
                          {ng ? ng.name : <span className="muted">未設定</span>}
                        </span>
                      </div>
                      <div className="template-list-actions">
                        <button
                          type="button"
                          className="icon-btn"
                          aria-label="編集"
                          onClick={() =>
                            setReportScheduleDialog({
                              open: true,
                              initial: s,
                            })
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
                                `定期配信「${s.name}」を削除しますか？`,
                              )
                            ) {
                              onDeleteReportSchedule(s.id)
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

        {/* Phase G: ダッシュボード確認リマインド */}
        <section className="panel-card">
          <div className="panel-card-head">
            <h2>
              <ClipboardCheck size={16} className="head-icon" />
              ダッシュボード確認リマインド
            </h2>
            <div className="panel-card-meta">
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() =>
                  setReminderDialog({ open: true, initial: null })
                }
              >
                <Plus size={14} />
                <span>新規作成</span>
              </button>
            </div>
          </div>
          <p className="muted in-panel multiline-help">
            <span>
              指定の頻度・時刻までにダッシュボード確認の記録が無い場合に通知を送ります。
            </span>
            <span>
              ダッシュボードを「全ダッシュボード」にすると、いずれかで確認があれば通知をスキップします。
            </span>
          </p>
          {Object.keys(dashboardReminders).length === 0 ? (
            <p className="muted in-panel">確認リマインドがまだありません。</p>
          ) : (
            <ul className="template-list">
              {Object.values(dashboardReminders)
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((r) => {
                  const ng = r.notificationGroupId
                    ? notificationGroups[r.notificationGroupId]
                    : null
                  const targetDash = r.dashboardId
                    ? dashboards[r.dashboardId]
                    : null
                  return (
                    <li key={r.id} className="template-list-item">
                      <div className="template-list-main">
                        <div className="template-list-name-row">
                          <button
                            type="button"
                            className="template-list-name-btn"
                            onClick={() =>
                              setReminderDialog({
                                open: true,
                                initial: r,
                              })
                            }
                            title="編集"
                          >
                            <ClipboardCheck size={13} />
                            <strong className="template-list-name">
                              {r.name}
                            </strong>
                          </button>
                          <span
                            className={`badge ${r.enabled ? 'badge-online' : 'badge-offline'}`}
                          >
                            {r.enabled ? '有効' : '停止中'}
                          </span>
                        </div>
                        <span className="template-list-summary">
                          {summarizeReminder(r)}
                          {' ・ 対象: '}
                          {targetDash ? targetDash.name : '全ダッシュボード'}
                          {' ・ 配信先: '}
                          {ng ? ng.name : <span className="muted">未設定</span>}
                        </span>
                      </div>
                      <div className="template-list-actions">
                        <button
                          type="button"
                          className="icon-btn"
                          aria-label="編集"
                          onClick={() =>
                            setReminderDialog({
                              open: true,
                              initial: r,
                            })
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
                                `リマインド「${r.name}」を削除しますか？`,
                              )
                            ) {
                              onDeleteDashboardReminder(r.id)
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
        </>
      )}

      {tab === 'thresholds' && (
        <section className="panel-card">
          <div className="panel-card-head">
            <h2>
              <Sliders size={16} className="head-icon" />
              センサー設定テンプレート
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
                      <span className="template-list-scope muted">
                        含まれる項目: {describeScope(t.scope)}
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

      <ThresholdTemplateEditDialog
        open={thresholdEditDialog.open}
        initial={thresholdEditDialog.initial}
        notificationGroups={notificationGroups}
        onClose={() => setThresholdEditDialog({ open: false, initial: null })}
        onSubmit={(t) => {
          onUpsertThresholdTemplate(t)
          setThresholdEditDialog({ open: false, initial: null })
        }}
      />

      {/* Phase G */}
      <ReportScheduleEditDialog
        open={reportScheduleDialog.open}
        initial={reportScheduleDialog.initial}
        notificationGroups={notificationGroups}
        sensors={sensors}
        onClose={() => setReportScheduleDialog({ open: false, initial: null })}
        onSubmit={(s) => {
          onUpsertReportSchedule(s)
          setReportScheduleDialog({ open: false, initial: null })
        }}
        onDelete={
          reportScheduleDialog.initial
            ? (id) => {
                onDeleteReportSchedule(id)
                setReportScheduleDialog({ open: false, initial: null })
              }
            : undefined
        }
      />

      <DashboardReminderEditDialog
        open={reminderDialog.open}
        initial={reminderDialog.initial}
        notificationGroups={notificationGroups}
        dashboards={dashboards}
        onClose={() => setReminderDialog({ open: false, initial: null })}
        onSubmit={(r) => {
          onUpsertDashboardReminder(r)
          setReminderDialog({ open: false, initial: null })
        }}
        onDelete={
          reminderDialog.initial
            ? (id) => {
                onDeleteDashboardReminder(id)
                setReminderDialog({ open: false, initial: null })
              }
            : undefined
        }
      />
    </div>
  )
}
