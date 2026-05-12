/**
 * テナント詳細画面（/admin/tenants/{id} 相当）。
 *
 * レイアウト:
 *  - ヘッダ: 戻るリンク + テナント名（左） + テナント ID（右下、小さく）
 *  - タブ: 契約情報 / メンバー / 登録デバイス / 監査ログ
 *
 * 各タブ:
 *  - 契約情報: 名前 / スラグ / 契約種別（デモ・サブスク・買取の三値）/
 *    請求サイクル / 契約期限 / 決済手段 / 請求書送付先 / 自動送信 / ツクルデAI 連携
 *  - メンバー: 顧客メンバー一覧（招待日 / 初回ログイン / 最終ログイン）+
 *    サポートスタッフ割り当て一覧（このテナントに有効な staff_assignments）
 *  - 登録デバイス: テナントスコープ v4 ストアから sensors / gateways
 *  - 監査ログ: AdminAuditView を fixedOrganizationId で絞り込み再利用
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  Mail,
  ShieldCheck,
  UserCog,
  Save,
  CreditCard,
  FileText,
  Cpu,
  Users2,
  History,
  Eye,
  Plus,
  X as XIcon,
  Bell,
  MoreVertical,
  AlertTriangle,
  Webhook,
  Copy,
  EyeOff,
  Code,
} from 'lucide-react'
import {
  loadOrganizations,
  loadOrganizationMembers,
  loadStaffAssignments,
  loadUsers,
  saveOrganizations,
  saveOrganizationMembers,
  upsertOrganization,
  logStaffAction,
} from '../lib/adminStorage'
import { gatewaysFromState, loadState, sensorsFromState } from '../../lib/storage'
import { toast } from '../../lib/toast'
import {
  deleteMemberFromSupabase,
  upsertOrganizationInSupabase,
} from '../../lib/supabaseQueries'
import { isSupabaseConfigured } from '../../lib/supabase'
import { InviteMemberDialog } from '../components/InviteMemberDialog'
import { AssignStaffDialog } from '../components/AssignStaffDialog'
import { DeleteTenantDialog } from '../components/DeleteTenantDialog'
import { Trash2, ShieldOff, RotateCcw } from 'lucide-react'
import { startImpersonation } from '../lib/impersonation'
import { reactivateOrganizationInSupabase } from '../../lib/supabaseQueries'
import { AdminAuditView } from './AdminAuditView'
import {
  buildRow as buildSensorRow,
  renderCell as renderSensorCell,
  COLUMN_LABEL as SENSOR_COLUMN_LABEL,
  COLUMN_HEAD_CLASS as SENSOR_COLUMN_HEAD_CLASS,
  type SensorRow,
} from '../../components/views/SensorsView'
import {
  defaultColumnOrder as defaultSensorColumnOrder,
} from '../../lib/sensorColumns'
import { GATEWAY_COLUMN_DEFS } from '../../lib/gatewayColumns'
import { sensorsOfGateway } from '../../lib/mock'
import { Router as RouterIcon, MapPin } from 'lucide-react'
import { MigrationCsvPanel, startMigrationMode } from '../components/MigrationCsvPanel'
import { CreateSensorDialog } from '../components/CreateSensorDialog'
import { BulkAddSensorsDialog } from '../components/BulkAddSensorsDialog'
import { CreateGatewayDialog } from '../components/CreateGatewayDialog'
import { BulkAddGatewaysDialog } from '../components/BulkAddGatewaysDialog'
import {
  unmatchedSummaryForOrg,
  processInbox,
  seedMockWebhooks,
  ignoreUnmatchedDevEUI,
  loadWebhookInbox,
  type UnmatchedSummary,
  type WebhookInboxItem,
} from '../lib/webhookInbox'
import {
  ensureMilesightIntegration,
  updateMilesightCredentials,
  buildWebhookUrl,
} from '../lib/milesightIntegration'
import type { ManufacturerIntegration } from '../../types'
import type {
  BillingCycle,
  ContractType,
  InvoiceNotifyRecipient,
  Organization,
  OrganizationStore,
  PaymentMethod,
  TenantRole,
} from '../../types'

type Props = {
  tenantId: string
  /** 操作中の admin の userId（CSV インポート等の監査ログに使う） */
  adminUserId: string
  onBack: () => void
  /** テナント側状態（sensors / webhook_inbox 等）を変更したことを親に通知する。
   *  AdminApp 側でサイドバーの「未登録 DevEUI」バッジを recount するのに使う。 */
  onTenantStateChanged?: () => void
  /** URL から復元される初期タブ。Phase K のルーティング連携用。 */
  initialTab?: string
  /** タブ変更を親に通知（URL 反映用） */
  onTabChange?: (tab: string) => void
}

type DetailTab =
  | 'contract'
  | 'members'
  | 'sensors'
  | 'gateways'
  | 'integration'
  | 'audit'

/* ---------- 共有フォーマッタ ---------- */

function formatDate(d: Date | string | number | undefined): string {
  if (!d) return '—'
  const dt = new Date(d as string | number | Date)
  if (Number.isNaN(dt.getTime())) return '—'
  return `${dt.getFullYear()}/${String(dt.getMonth() + 1).padStart(2, '0')}/${String(dt.getDate()).padStart(2, '0')}`
}

function formatDateTime(d: Date | string | number | undefined): string {
  if (!d) return '—'
  const dt = new Date(d as string | number | Date)
  if (Number.isNaN(dt.getTime())) return '—'
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${dt.getFullYear()}/${pad(dt.getMonth() + 1)}/${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}`
}

function toDateInputValue(d: Date | string | number | undefined): string {
  if (!d) return ''
  const dt = new Date(d as string | number | Date)
  if (Number.isNaN(dt.getTime())) return ''
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

function fromDateInputValue(s: string): Date | undefined {
  if (!s) return undefined
  const d = new Date(`${s}T00:00:00`)
  return Number.isNaN(d.getTime()) ? undefined : d
}

function tenantRoleLabel(role: TenantRole): string {
  if (role === 'editor') return '編集メンバー'
  return '確認者'
}

function billingCycleLabel(c: BillingCycle | undefined): string {
  if (c === 'monthly') return '月契約'
  if (c === 'annual') return '年契約'
  return '未設定'
}

function paymentLabel(p: PaymentMethod | undefined): string {
  if (p === 'bank_transfer') return '銀行振込'
  if (p === 'credit_card') return 'クレジットカード'
  return '未設定'
}

function contractTypeLabel(c: ContractType | undefined): string {
  if (c === 'demo') return 'デモプラン'
  if (c === 'subscription') return 'サブスクプラン'
  if (c === 'purchase') return '買取プラン'
  if (c === 'typeless') return 'タイプレス'
  return '未設定'
}

function daysUntil(d: Date | string | number | undefined): number | null {
  if (!d) return null
  const t = new Date(d as string | number | Date).getTime()
  if (Number.isNaN(t)) return null
  return Math.ceil((t - Date.now()) / (24 * 60 * 60 * 1000))
}

/* ---------- 本体 ---------- */

export function AdminTenantDetailView({
  tenantId,
  adminUserId,
  onBack,
  onTenantStateChanged,
  initialTab,
  onTabChange,
}: Props) {
  const [refreshTick, setRefreshTick] = useState(0)
  function bumpRefresh() {
    setRefreshTick((v) => v + 1)
    onTenantStateChanged?.()
  }
  const [tab, _setTab] = useState<DetailTab>(
    (initialTab as DetailTab) || 'contract',
  )

  // initialTab が外側から変わったら追従（URL の戻る/進むで該当）
  useEffect(() => {
    if (initialTab && initialTab !== tab) {
      _setTab(initialTab as DetailTab)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTab])

  function setTab(next: DetailTab) {
    _setTab(next)
    onTabChange?.(next)
  }

  const org = useMemo(() => {
    const orgs = loadOrganizations()
    return orgs[tenantId] ?? null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, refreshTick])

  /* ---- 編集状態（契約情報タブで使う） ---- */
  const [editName, setEditName] = useState(org?.name ?? '')
  const [editSlug, setEditSlug] = useState(org?.slug ?? '')
  const [editContractType, setEditContractType] = useState<ContractType>(
    org?.contractType ?? 'subscription',
  )
  const [editTsukurudeAi, setEditTsukurudeAi] = useState<boolean>(
    org?.tsukurudeAiEnabled ?? false,
  )
  const [editCycle, setEditCycle] = useState<BillingCycle>(
    org?.billingCycle ?? 'annual',
  )
  const [editStartedAt, setEditStartedAt] = useState<string>(
    toDateInputValue(org?.contractStartedAt),
  )
  const [editExpiresAt, setEditExpiresAt] = useState<string>(
    toDateInputValue(org?.contractExpiresAt),
  )
  const [editPaymentMethod, setEditPaymentMethod] = useState<PaymentMethod>(
    org?.paymentMethod ?? 'bank_transfer',
  )
  const [editBillingEmail, setEditBillingEmail] = useState(
    org?.billingEmail ?? '',
  )
  const [editAutoInvoice, setEditAutoInvoice] = useState<boolean>(
    org?.autoInvoice ?? true,
  )
  const [editPreNotifyDays, setEditPreNotifyDays] = useState<number>(
    org?.preNotifyDaysBefore ?? 3,
  )
  const [editPreNotifyRecipients, setEditPreNotifyRecipients] = useState<
    InvoiceNotifyRecipient[]
  >(org?.preNotifyRecipients ?? [])

  useEffect(() => {
    if (!org) return
    setEditName(org.name)
    setEditSlug(org.slug)
    setEditContractType(org.contractType ?? 'subscription')
    setEditTsukurudeAi(org.tsukurudeAiEnabled ?? false)
    setEditCycle(org.billingCycle ?? 'annual')
    setEditStartedAt(toDateInputValue(org.contractStartedAt))
    setEditExpiresAt(toDateInputValue(org.contractExpiresAt))
    setEditPaymentMethod(org.paymentMethod ?? 'bank_transfer')
    setEditBillingEmail(org.billingEmail ?? '')
    setEditAutoInvoice(org.autoInvoice ?? true)
    setEditPreNotifyDays(org.preNotifyDaysBefore ?? 3)
    setEditPreNotifyRecipients(org.preNotifyRecipients ?? [])
  }, [org])

  /* ---- メンバー（顧客側） ---- */
  const memberRows = useMemo(() => {
    if (!org) return []
    const users = loadUsers()
    const members = loadOrganizationMembers()
    return Object.values(members)
      .filter((m) => m.organizationId === org.id)
      .map((m) => {
        const u = users[m.userId]
        return {
          memberId: m.id,
          userId: m.userId,
          displayName: u?.displayName ?? '(不明)',
          email: u?.email ?? '',
          systemRole: u?.systemRole ?? null,
          role: m.role,
          invitedAt: m.invitedAt,
          firstLoginAt: m.firstLoginAt,
          lastLoginAt: m.lastLoginAt,
        }
      })
      .sort((a, b) => a.displayName.localeCompare(b.displayName, 'ja'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org, refreshTick])

  /* ---- このテナントに有効なサポート割り当て ---- */
  const supportRows = useMemo(() => {
    if (!org) return []
    const users = loadUsers()
    const assignments = loadStaffAssignments()
    const now = Date.now()
    return Object.values(assignments)
      .filter((a) => {
        if (a.organizationId !== org.id) return false
        if (a.revokedAt) return false
        if (a.expiresAt && new Date(a.expiresAt).getTime() <= now) return false
        return true
      })
      .map((a) => {
        const u = users[a.staffUserId]
        return {
          assignmentId: a.id,
          staffUserId: a.staffUserId,
          displayName: u?.displayName ?? '(不明)',
          email: u?.email ?? '',
          systemRole: u?.systemRole ?? null,
          notes: a.notes,
          grantedAt: a.grantedAt,
          expiresAt: a.expiresAt,
        }
      })
      .sort((a, b) => a.displayName.localeCompare(b.displayName, 'ja'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org, refreshTick])

  /* ---- デバイス一覧（タブ内タブで分割: センサー / ゲートウェイ） ---- */
  const tenantState = useMemo(() => {
    if (!org) return null
    return loadState(org.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org, refreshTick])

  const sensorRows: SensorRow[] = useMemo(() => {
    if (!tenantState) return []
    const sensors = sensorsFromState(tenantState)
    const gateways = gatewaysFromState(tenantState)
    const devices = tenantState.devices ?? {}
    return Object.values(sensors)
      .map((s) => buildSensorRow(s, devices[s.id] ?? [], gateways))
      .sort((a, b) => {
        const an = a.sensor.name ?? a.sensor.id
        const bn = b.sensor.name ?? b.sensor.id
        return an.localeCompare(bn, 'ja')
      })
  }, [tenantState])

  /* ---- 早期 return ---- */

  if (!org) {
    return (
      <div className="admin-view">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onBack}>
          <ArrowLeft size={14} />
          <span>テナント一覧へ戻る</span>
        </button>
        <div className="admin-placeholder">
          <h1>テナントが見つかりません</h1>
          <p>削除されたか、ID が誤っている可能性があります。</p>
        </div>
      </div>
    )
  }

  /* ---- 契約情報タブの dirty 判定 + 保存 ---- */
  const dirty =
    editName.trim() !== org.name ||
    editSlug.trim() !== org.slug ||
    editContractType !== (org.contractType ?? 'subscription') ||
    editTsukurudeAi !== (org.tsukurudeAiEnabled ?? false) ||
    editCycle !== (org.billingCycle ?? 'annual') ||
    editStartedAt !== toDateInputValue(org.contractStartedAt) ||
    editExpiresAt !== toDateInputValue(org.contractExpiresAt) ||
    editPaymentMethod !== (org.paymentMethod ?? 'bank_transfer') ||
    editBillingEmail !== (org.billingEmail ?? '') ||
    editAutoInvoice !== (org.autoInvoice ?? true) ||
    editPreNotifyDays !== (org.preNotifyDaysBefore ?? 3) ||
    JSON.stringify(editPreNotifyRecipients) !==
      JSON.stringify(org.preNotifyRecipients ?? [])

  async function handleSave() {
    if (!org) return
    const trimmedName = editName.trim()
    const trimmedSlug = editSlug.trim()
    if (!trimmedName || !trimmedSlug) {
      alert('名前と契約IDは必須です。')
      return
    }
    if (!/^[a-z0-9](?:[a-z0-9_-]{0,18}[a-z0-9])?$/.test(trimmedSlug)) {
      alert(
        '契約IDは半角英小文字・数字・ハイフン/アンダースコアのみ、2〜20文字、先頭末尾は英数字で入力してください。',
      )
      return
    }
    const orgs = loadOrganizations()
    const dup = Object.values(orgs).find(
      (o) => o.id !== org.id && o.slug === trimmedSlug,
    )
    if (dup) {
      alert(`契約ID「${trimmedSlug}」は別テナント「${dup.name}」で使用中です。`)
      return
    }
    const startedAt = fromDateInputValue(editStartedAt)
    const expiresAt = fromDateInputValue(editExpiresAt)
    if (startedAt && expiresAt && expiresAt.getTime() <= startedAt.getTime()) {
      alert('契約終了日は契約開始日より後の日付を指定してください。')
      return
    }
    if (editPaymentMethod === 'bank_transfer' && editAutoInvoice) {
      const email = editBillingEmail.trim()
      if (!email || !email.includes('@')) {
        alert('請求書の自動送信には有効な請求先メールアドレスが必要です。')
        return
      }
    }
    // 事前通知の宛先バリデーション（メール直入力分の形式チェック）
    for (const r of editPreNotifyRecipients) {
      if (r.kind === 'email' && (!r.email.trim() || !r.email.includes('@'))) {
        alert(
          `事前通知の宛先に不正なメールアドレスが含まれています: ${r.email || '(空欄)'}`,
        )
        return
      }
    }
    if (editPreNotifyDays < 0 || editPreNotifyDays > 60) {
      alert('事前通知の日数は 0〜60 の範囲で指定してください。')
      return
    }
    const isAutoInvoiceFlow =
      editPaymentMethod === 'bank_transfer' && editAutoInvoice

    const next: Organization = {
      ...org,
      name: trimmedName,
      slug: trimmedSlug,
      contractType: editContractType,
      tsukurudeAiEnabled: editTsukurudeAi,
      billingCycle: editCycle,
      contractStartedAt: startedAt,
      contractExpiresAt: expiresAt,
      paymentMethod: editPaymentMethod,
      billingEmail: editBillingEmail.trim() || undefined,
      autoInvoice:
        editPaymentMethod === 'bank_transfer' ? editAutoInvoice : false,
      preNotifyDaysBefore: isAutoInvoiceFlow ? editPreNotifyDays : undefined,
      preNotifyRecipients: isAutoInvoiceFlow
        ? editPreNotifyRecipients
        : undefined,
    }
    // Supabase が真値。先に同期して、成功してから localStorage に反映する。
    if (isSupabaseConfigured()) {
      try {
        await upsertOrganizationInSupabase(next)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        toast(`テナント更新に失敗: ${msg.slice(0, 100)}`, 'error')
        return
      }
    }
    saveOrganizations(upsertOrganization(orgs, next))
    toast('テナント情報を更新しました', 'success')
    bumpRefresh()
  }

  /** 削除（無効化 or 完全削除）の専用モーダルを開く */
  const [deleteOpen, setDeleteOpen] = useState(false)
  function handleDelete() {
    setDeleteOpen(true)
  }

  /** 無効化済みテナントを復活させる */
  async function handleReactivate() {
    if (!org) return
    if (!confirm(`「${org.name}」の無効化を解除して通常運用に戻しますか？`)) return
    try {
      if (isSupabaseConfigured()) {
        await reactivateOrganizationInSupabase(org.id)
      }
      const orgs = loadOrganizations()
      const next: OrganizationStore = {
        ...orgs,
        [org.id]: {
          ...orgs[org.id],
          deactivatedAt: undefined,
          deactivatedByUserId: undefined,
          deactivationReason: undefined,
          physicalDeleteAfter: undefined,
        },
      }
      saveOrganizations(next)
      logStaffAction({
        staffUserId: adminUserId,
        organizationId: org.id,
        action: 'tenant.reactivate',
        targetTable: 'organizations',
        targetId: org.id,
        metadata: { name: org.name },
      })
      toast(`テナント「${org.name}」を復活しました`, 'success')
      bumpRefresh()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      toast(`復活に失敗: ${msg.slice(0, 100)}`, 'error')
    }
  }

  /** super_admin がこのテナントを直接開く（impersonation 起動）。
   *  reason は固定的に「super_admin によるテナント閲覧」とする。
   *  redirectTo を渡すことで、テナント URL のダッシュボードに遷移する。 */
  function handleImpersonate(target: Organization) {
    startImpersonation({
      staffUserId: adminUserId,
      organizationId: target.id,
      reason: 'super_admin によるテナント閲覧',
      redirectTo: target.slug ? `/${target.slug}/dashboard` : '/',
    })
  }

  const remainingDays = daysUntil(org.contractExpiresAt)
  const expiryClass =
    remainingDays === null
      ? ''
      : remainingDays < 0
        ? 'is-expired'
        : remainingDays <= 30
          ? 'is-soon'
          : ''

  // センサー / ゲートウェイタブはワイド表示（テーブルの列が多いため）
  const isWide = tab === 'sensors' || tab === 'gateways'

  return (
    <div className={`admin-view ${isWide ? 'admin-view-wide' : ''}`}>
      <div className="tenant-detail-back">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onBack}>
          <ArrowLeft size={14} />
          <span>テナント一覧へ戻る</span>
        </button>
      </div>

      <header className="tenant-detail-head">
        <h1 className="tenant-detail-title">{org.name}</h1>
        <span className="tenant-detail-id mono" title="テナント ID">
          {org.id}
        </span>
        {org.deactivatedAt && (
          <span className="tenant-deactivated-pill" title="このテナントは無効化されています">
            <ShieldOff size={11} />
            無効化中
          </span>
        )}
        <button
          type="button"
          className="btn btn-secondary btn-sm tenant-impersonate-btn"
          onClick={() => handleImpersonate(org)}
          disabled={Boolean(org.deactivatedAt)}
          title={org.deactivatedAt ? '無効化中のテナントには入れません' : 'このテナントを開く（super_admin による impersonation）'}
        >
          <Eye size={13} />
          <span>このテナントに入る</span>
        </button>
      </header>

      <nav className="admin-tabs" role="tablist">
        <TabBtn active={tab === 'contract'} onClick={() => setTab('contract')}>
          <FileText size={14} />
          <span>契約情報</span>
        </TabBtn>
        <TabBtn
          active={tab === 'integration'}
          onClick={() => setTab('integration')}
        >
          <Webhook size={14} />
          <span>連携設定</span>
        </TabBtn>
        <TabBtn active={tab === 'sensors'} onClick={() => setTab('sensors')}>
          <Cpu size={14} />
          <span>センサー</span>
          <span className="admin-tab-count">{sensorRows.length}</span>
        </TabBtn>
        <TabBtn active={tab === 'gateways'} onClick={() => setTab('gateways')}>
          <RouterIcon size={14} />
          <span>ゲートウェイ</span>
          <span className="admin-tab-count">
            {tenantState ? Object.keys(gatewaysFromState(tenantState)).length : 0}
          </span>
        </TabBtn>
        <TabBtn active={tab === 'members'} onClick={() => setTab('members')}>
          <Users2 size={14} />
          <span>メンバー / サポート</span>
          <span className="admin-tab-count">
            {memberRows.length + supportRows.length}
          </span>
        </TabBtn>
        <TabBtn active={tab === 'audit'} onClick={() => setTab('audit')}>
          <History size={14} />
          <span>監査ログ</span>
        </TabBtn>
      </nav>

      {tab === 'contract' && (
        <ContractTab
          org={org}
          dirty={dirty}
          onSave={handleSave}
          onDelete={handleDelete}
          onReactivate={handleReactivate}
          editName={editName}
          setEditName={setEditName}
          editSlug={editSlug}
          setEditSlug={setEditSlug}
          editContractType={editContractType}
          setEditContractType={setEditContractType}
          editTsukurudeAi={editTsukurudeAi}
          setEditTsukurudeAi={setEditTsukurudeAi}
          editCycle={editCycle}
          setEditCycle={setEditCycle}
          editStartedAt={editStartedAt}
          setEditStartedAt={setEditStartedAt}
          editExpiresAt={editExpiresAt}
          setEditExpiresAt={setEditExpiresAt}
          editPaymentMethod={editPaymentMethod}
          setEditPaymentMethod={setEditPaymentMethod}
          editBillingEmail={editBillingEmail}
          setEditBillingEmail={setEditBillingEmail}
          editAutoInvoice={editAutoInvoice}
          setEditAutoInvoice={setEditAutoInvoice}
          editPreNotifyDays={editPreNotifyDays}
          setEditPreNotifyDays={setEditPreNotifyDays}
          editPreNotifyRecipients={editPreNotifyRecipients}
          setEditPreNotifyRecipients={setEditPreNotifyRecipients}
          remainingDays={remainingDays}
          expiryClass={expiryClass}
        />
      )}

      {tab === 'members' && (
        <MembersTab
          org={org}
          adminUserId={adminUserId}
          memberRows={memberRows}
          supportRows={supportRows}
          onChanged={bumpRefresh}
        />
      )}

      {tab === 'sensors' && (
        <SensorsTab
          org={org}
          sensorRows={sensorRows}
          tenantState={tenantState}
          adminUserId={adminUserId}
          onChanged={bumpRefresh}
        />
      )}
      {tab === 'gateways' && (
        <GatewaysTab
          org={org}
          tenantState={tenantState}
          adminUserId={adminUserId}
          onChanged={bumpRefresh}
        />
      )}

      {tab === 'integration' && (
        <IntegrationTab
          org={org}
          adminUserId={adminUserId}
          // tenantState の変化（センサー追加など）に追従するため依存に渡す
          tenantStateRev={tenantState}
        />
      )}

      {tab === 'audit' && (
        <div className="admin-section admin-section-tab">
          <AdminAuditView fixedOrganizationId={org.id} compact />
        </div>
      )}

      {deleteOpen && (
        <DeleteTenantDialog
          org={org}
          adminUserId={adminUserId}
          onClose={() => setDeleteOpen(false)}
          onDone={(kind) => {
            setDeleteOpen(false)
            if (kind === 'destroy') {
              // 物理削除: localStorage からも除去して一覧に戻る
              const orgs = loadOrganizations()
              const nextOrgs: OrganizationStore = { ...orgs }
              delete nextOrgs[org.id]
              saveOrganizations(nextOrgs)
              onBack()
            } else {
              // 無効化: localStorage の deactivatedAt をセットして UI に反映
              const orgs = loadOrganizations()
              const physicalDeleteAfter = new Date()
              physicalDeleteAfter.setDate(physicalDeleteAfter.getDate() + 180)
              saveOrganizations({
                ...orgs,
                [org.id]: {
                  ...orgs[org.id],
                  deactivatedAt: new Date(),
                  deactivatedByUserId: adminUserId,
                  physicalDeleteAfter,
                },
              })
              bumpRefresh()
            }
          }}
        />
      )}
    </div>
  )
}

/* ===== セクション右上のアクションメニュー（kebab）=====
 *
 * 各種「セクション内アクション」を 1 箇所に集約する小さなドロップダウン。
 *  - センサー: 移行モード開始 / (将来) 一括追加 / 単発追加
 *  - ゲートウェイ: (将来) 単発追加 / 一括追加
 *  - 契約: (将来) 何かあれば
 *
 * items が空のときは何も表示しない（メニューを出す意味がない）。 */
/** kebab メニューの 1 アイテム。
 *  `kind: 'divider'` を渡すと区切りラベル（「モック検証用」等）として
 *  表示する。ボタンとしては機能しない。 */
type SectionActionItem =
  | {
      kind?: 'item'
      key: string
      label: string
      hint?: string
      onClick: () => void
    }
  | {
      kind: 'divider'
      key: string
      /** 区切り線の上に出す小さなラベル（例: "モック検証用"） */
      label?: string
    }

function SectionActionMenu({
  items,
}: {
  items: SectionActionItem[]
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  if (items.length === 0) return null

  return (
    <div className="section-action-menu" ref={wrapRef}>
      <button
        type="button"
        className="section-action-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        title="セクションのアクション"
        onClick={() => setOpen((v) => !v)}
      >
        <MoreVertical size={14} />
      </button>
      {open && (
        <div className="section-action-menu-pop" role="menu">
          {items.map((it) => {
            if (it.kind === 'divider') {
              return (
                <div
                  key={it.key}
                  className="section-action-divider"
                  role="separator"
                >
                  {it.label && (
                    <span className="section-action-divider-label">
                      {it.label}
                    </span>
                  )}
                </div>
              )
            }
            return (
              <button
                key={it.key}
                type="button"
                className="section-action-item"
                onClick={() => {
                  setOpen(false)
                  it.onClick()
                }}
              >
                <span className="section-action-label">{it.label}</span>
                {it.hint && (
                  <span className="section-action-hint">{it.hint}</span>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* ===== タブナビボタン ===== */
function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={`admin-tab-btn ${active ? 'is-active' : ''}`}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

/* ===== 契約情報タブ ===== */
type ContractTabProps = {
  org: Organization
  dirty: boolean
  onSave: () => void
  onDelete: () => void
  onReactivate: () => void
  editName: string
  setEditName: (v: string) => void
  editSlug: string
  setEditSlug: (v: string) => void
  editContractType: ContractType
  setEditContractType: (v: ContractType) => void
  editTsukurudeAi: boolean
  setEditTsukurudeAi: (v: boolean) => void
  editCycle: BillingCycle
  setEditCycle: (v: BillingCycle) => void
  editStartedAt: string
  setEditStartedAt: (v: string) => void
  editExpiresAt: string
  setEditExpiresAt: (v: string) => void
  editPaymentMethod: PaymentMethod
  setEditPaymentMethod: (v: PaymentMethod) => void
  editBillingEmail: string
  setEditBillingEmail: (v: string) => void
  editAutoInvoice: boolean
  setEditAutoInvoice: (v: boolean) => void
  editPreNotifyDays: number
  setEditPreNotifyDays: (v: number) => void
  editPreNotifyRecipients: InvoiceNotifyRecipient[]
  setEditPreNotifyRecipients: (v: InvoiceNotifyRecipient[]) => void
  remainingDays: number | null
  expiryClass: string
}

function ContractTab(p: ContractTabProps) {
  const { org } = p
  return (
    <section className="admin-section admin-section-tab">
      <div className="admin-section-head">
        <h2>
          <FileText size={16} className="inline-icon" /> 契約情報
        </h2>
        {p.dirty && (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={p.onSave}
          >
            <Save size={14} />
            <span>変更を保存</span>
          </button>
        )}
      </div>

      <div className="admin-grid-form">
        <div className="form-row">
          <label className="form-label">名前</label>
          <input
            className="form-input"
            type="text"
            value={p.editName}
            onChange={(e) => p.setEditName(e.target.value)}
          />
        </div>
        <div className="form-row">
          <label className="form-label">契約ID</label>
          <input
            className="form-input mono"
            type="text"
            value={p.editSlug}
            onChange={(e) =>
              p.setEditSlug(
                e.target.value
                  .toLowerCase()
                  .replace(/[^a-z0-9_-]+/g, '')
                  .slice(0, 20),
              )
            }
            maxLength={20}
            autoComplete="off"
            spellCheck={false}
          />
          <p className="form-help muted">
            顧客と共有する識別子（URL にも使われます）。半角英小文字・数字・ハイフン/アンダースコアのみ、2〜20 文字。
          </p>
        </div>

        <div className="form-row">
          <label className="form-label">契約種別</label>
          <select
            className="select"
            value={p.editContractType}
            onChange={(e) =>
              p.setEditContractType(e.target.value as ContractType)
            }
          >
            <option value="demo">デモ（料金なし・検証用）</option>
            <option value="subscription">
              サブスクプラン（デバイス代込み・月額継続）
            </option>
            <option value="purchase">
              買取プラン（デバイス代を初回一括 + ランニング費）
            </option>
            <option value="typeless">
              タイプレス（既存タイプレスサービスからの移行・統合契約）
            </option>
          </select>
          <p className="form-help">
            買取プランは初回請求にデバイス本体代金が含まれます。デモは料金が発生しません。
            タイプレスは既存サービスからの移行枠で、料金体系は別途定義します。
          </p>
        </div>
        <div className="form-row">
          <label className="form-label">ツクルデAI 連携</label>
          <label className="form-checkbox">
            <input
              type="checkbox"
              checked={p.editTsukurudeAi}
              onChange={(e) => p.setEditTsukurudeAi(e.target.checked)}
            />
            <span>このテナントはツクルデAIと連携している</span>
          </label>
        </div>

        <div className="form-row">
          <label className="form-label">請求サイクル</label>
          <select
            className="select"
            value={p.editCycle}
            onChange={(e) => p.setEditCycle(e.target.value as BillingCycle)}
          >
            <option value="annual">年契約</option>
            <option value="monthly">月契約</option>
          </select>
        </div>
        <div className="form-row">
          <label className="form-label">決済手段</label>
          <select
            className="select"
            value={p.editPaymentMethod}
            onChange={(e) =>
              p.setEditPaymentMethod(e.target.value as PaymentMethod)
            }
          >
            <option value="bank_transfer">銀行振込</option>
            <option value="credit_card">クレジットカード</option>
          </select>
        </div>
        <div className="form-row">
          <label className="form-label">契約開始日</label>
          <input
            className="form-input"
            type="date"
            value={p.editStartedAt}
            onChange={(e) => p.setEditStartedAt(e.target.value)}
          />
        </div>
        <div className="form-row">
          <label className="form-label">契約終了日</label>
          <input
            className="form-input"
            type="date"
            value={p.editExpiresAt}
            onChange={(e) => p.setEditExpiresAt(e.target.value)}
          />
        </div>

        {p.editPaymentMethod === 'bank_transfer' && (
          <>
            <div className="form-row">
              <label className="form-label">請求書送付先メール</label>
              <input
                className="form-input mono"
                type="email"
                value={p.editBillingEmail}
                onChange={(e) => p.setEditBillingEmail(e.target.value)}
                placeholder="billing@example.com"
              />
            </div>
            <div className="form-row">
              <label className="form-label">請求書の自動送信</label>
              <label className="form-checkbox">
                <input
                  type="checkbox"
                  checked={p.editAutoInvoice}
                  onChange={(e) => p.setEditAutoInvoice(e.target.checked)}
                />
                <span>請求月の初日に PDF 請求書を自動送信する</span>
              </label>
            </div>
          </>
        )}

        {p.editPaymentMethod === 'bank_transfer' && p.editAutoInvoice && (
          <div className="form-row form-row-wide">
            <PreNotifyEditor
              days={p.editPreNotifyDays}
              setDays={p.setEditPreNotifyDays}
              recipients={p.editPreNotifyRecipients}
              setRecipients={p.setEditPreNotifyRecipients}
            />
          </div>
        )}

        <div className="form-row">
          <label className="form-label">登録日</label>
          <div className="readonly-field">{formatDate(org.createdAt)}</div>
        </div>
      </div>

      <div className="admin-meta-row contract-summary">
        <span
          className={`contract-type-pill contract-type-${org.contractType ?? 'subscription'}`}
        >
          {contractTypeLabel(org.contractType)}
        </span>
        {org.tsukurudeAiEnabled && (
          <span className="contract-pill contract-pill-ai">
            ツクルデAI 連携あり
          </span>
        )}
        <span className="contract-pill">
          <FileText size={11} /> {billingCycleLabel(org.billingCycle)}
        </span>
        <span className="contract-pill">
          <CreditCard size={11} /> {paymentLabel(org.paymentMethod)}
        </span>
        {org.contractExpiresAt && (
          <span className={`contract-expiry ${p.expiryClass}`}>
            次回更新: {formatDate(org.contractExpiresAt)}
            {p.remainingDays !== null && (
              <span className="contract-expiry-days">
                （
                {p.remainingDays < 0
                  ? `${-p.remainingDays} 日経過（要対応）`
                  : p.remainingDays === 0
                    ? '本日が期限'
                    : `あと ${p.remainingDays} 日`}
                ）
              </span>
            )}
          </span>
        )}
      </div>

      {/* 危険な操作エリア（テナント削除 / 復活） */}
      <div className="admin-danger-zone">
        <h3>危険な操作</h3>
        {org.deactivatedAt ? (
          <>
            <p>
              このテナントは <strong>無効化中</strong> です。
              {' '}復活すると通常の運用状態に戻ります。
              {' '}完全削除は{' '}
              {org.physicalDeleteAfter
                ? new Date(org.physicalDeleteAfter as unknown as string | Date).toLocaleDateString('ja-JP')
                : '?'}{' '}
              以降に可能になります。
            </p>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={p.onReactivate}
              >
                <RotateCcw size={13} />
                <span>無効化を解除（復活）</span>
              </button>
              <button
                type="button"
                className="btn btn-danger btn-sm"
                onClick={p.onDelete}
              >
                <AlertTriangle size={13} />
                <span>削除メニューを開く</span>
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="muted">
              このテナントを削除します。安全のため、まず「無効化（180 日猶予）」されます。
              組織 ID と組織名の正確な入力を求められます。
            </p>
            <button
              type="button"
              className="btn btn-danger btn-sm"
              onClick={p.onDelete}
            >
              <AlertTriangle size={13} />
              <span>このテナントを削除...</span>
            </button>
          </>
        )}
      </div>
    </section>
  )
}

/* ===== 請求書事前通知エディタ =====
 *
 * 銀行振込 + 自動送信が有効なときだけ表示。
 *  - 何日前に営業担当へ事前通知メールを送るか
 *  - 通知先（既存スタッフから選択 or メールを直接入力）
 */
type PreNotifyEditorProps = {
  days: number
  setDays: (v: number) => void
  recipients: InvoiceNotifyRecipient[]
  setRecipients: (v: InvoiceNotifyRecipient[]) => void
}

function PreNotifyEditor({
  days,
  setDays,
  recipients,
  setRecipients,
}: PreNotifyEditorProps) {
  const [emailDraft, setEmailDraft] = useState('')

  // スタッフ候補（systemRole='support' のユーザ全員、未追加分のみ）
  const staffOptions = useMemo(() => {
    const users = loadUsers()
    const taken = new Set(
      recipients.flatMap((r) =>
        r.kind === 'staff' ? [r.userId] : [],
      ),
    )
    return Object.values(users)
      .filter((u) => u.systemRole === 'support' && !taken.has(u.id))
      .sort((a, b) => {
        // 営業担当を先頭に
        if (a.staffCategory === 'sales' && b.staffCategory !== 'sales') return -1
        if (a.staffCategory !== 'sales' && b.staffCategory === 'sales') return 1
        return a.displayName.localeCompare(b.displayName, 'ja')
      })
  }, [recipients])

  function addStaff(userId: string) {
    if (!userId) return
    setRecipients([...recipients, { kind: 'staff', userId }])
  }
  function addEmail() {
    const v = emailDraft.trim()
    if (!v || !v.includes('@')) {
      alert('有効なメールアドレスを入力してください。')
      return
    }
    if (
      recipients.some(
        (r) => r.kind === 'email' && r.email.toLowerCase() === v.toLowerCase(),
      )
    ) {
      alert('そのメールアドレスは既に追加されています。')
      return
    }
    setRecipients([...recipients, { kind: 'email', email: v }])
    setEmailDraft('')
  }
  function remove(idx: number) {
    setRecipients(recipients.filter((_, i) => i !== idx))
  }

  const users = loadUsers()
  return (
    <div className="prenotify-block">
      <div className="prenotify-head">
        <Bell size={14} className="inline-icon" />
        <strong>請求書の事前通知（営業担当向け）</strong>
      </div>
      <p className="form-help prenotify-desc">
        顧客への請求書送信予定日の <strong>N 日前</strong>
        に「これでお客さんに送ってよいか」を確認するメールを下記の宛先へ送ります。
        無返答なら予定日に顧客へ送信されます。クレジット決済では使用しません。
      </p>

      <div className="prenotify-days-row">
        <label className="form-label" htmlFor="prenotify-days">
          何日前に通知するか
        </label>
        <input
          id="prenotify-days"
          type="number"
          min={0}
          max={60}
          step={1}
          className="form-input prenotify-days-input"
          value={days}
          onChange={(e) => setDays(Number(e.target.value) || 0)}
        />
        <span className="muted">日前</span>
      </div>

      <div className="prenotify-recipients">
        <label className="form-label">通知先</label>
        {recipients.length === 0 && (
          <div className="prenotify-empty">
            まだ通知先がありません。下のフォームから追加してください。
          </div>
        )}
        <ul className="recipient-list">
          {recipients.map((r, i) => {
            if (r.kind === 'staff') {
              const u = users[r.userId]
              const cat = u?.staffCategory ?? 'support'
              return (
                <li key={`s-${i}`} className="recipient-item">
                  <span
                    className={`staff-category-pill staff-category-${cat}`}
                  >
                    {cat === 'sales' ? '営業' : 'サポート'}
                  </span>
                  <span className="recipient-name">
                    {u?.displayName ?? '(削除済)'}
                  </span>
                  <span className="recipient-email mono">
                    <Mail size={11} className="inline-icon" />{' '}
                    {u?.email ?? '—'}
                  </span>
                  <button
                    type="button"
                    className="recipient-remove"
                    onClick={() => remove(i)}
                    aria-label="削除"
                  >
                    <XIcon size={13} />
                  </button>
                </li>
              )
            }
            return (
              <li key={`e-${i}`} className="recipient-item">
                <span className="staff-category-pill staff-category-email">
                  メール
                </span>
                <span className="recipient-email mono">
                  <Mail size={11} className="inline-icon" /> {r.email}
                </span>
                <button
                  type="button"
                  className="recipient-remove"
                  onClick={() => remove(i)}
                  aria-label="削除"
                >
                  <XIcon size={13} />
                </button>
              </li>
            )
          })}
        </ul>

        <div className="recipient-add">
          <select
            className="select"
            value=""
            onChange={(e) => {
              addStaff(e.target.value)
              // ドロップダウンを「未選択」状態に戻す
              e.target.value = ''
            }}
          >
            <option value="">＋ スタッフから追加…</option>
            {staffOptions.map((u) => (
              <option key={u.id} value={u.id}>
                {u.displayName}（{u.email}）
                {u.staffCategory === 'sales' ? ' ・ 営業' : ' ・ サポート'}
              </option>
            ))}
          </select>
          <div className="recipient-add-email">
            <input
              type="email"
              className="form-input mono"
              placeholder="メールアドレスを直接入力"
              value={emailDraft}
              onChange={(e) => setEmailDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addEmail()
                }
              }}
            />
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={addEmail}
            >
              <Plus size={13} />
              <span>追加</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ===== メンバータブ ===== */
type MembersTabProps = {
  org: Organization
  adminUserId: string
  memberRows: {
    memberId: string
    displayName: string
    email: string
    systemRole: 'super_admin' | 'support' | null
    role: TenantRole
    invitedAt: Date | string
    firstLoginAt?: Date | string
    lastLoginAt?: Date | string
  }[]
  supportRows: {
    assignmentId: string
    staffUserId: string
    displayName: string
    email: string
    systemRole: 'super_admin' | 'support' | null
    notes?: string
    grantedAt: Date | string
    expiresAt?: Date | string
  }[]
  onChanged: () => void
}

function MembersTab({ org, adminUserId, memberRows, supportRows, onChanged }: MembersTabProps) {
  const [inviteOpen, setInviteOpen] = useState(false)
  const [assignOpen, setAssignOpen] = useState(false)

  async function handleRemoveMember(memberId: string, displayName: string) {
    if (!confirm(`「${displayName}」のメンバーシップを削除しますか？\nテナントへのアクセス権を失います（ユーザー自体は削除されません）。`)) return
    try {
      if (isSupabaseConfigured()) {
        await deleteMemberFromSupabase(memberId)
      }
      const next = { ...loadOrganizationMembers() }
      delete next[memberId]
      saveOrganizationMembers(next)
      logStaffAction({
        staffUserId: adminUserId,
        organizationId: org.id,
        action: 'member.remove',
        targetTable: 'organization_members',
        targetId: memberId,
        metadata: { displayName },
      })
      toast(`「${displayName}」のメンバーシップを削除しました`, 'info')
      onChanged()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      toast(`削除に失敗: ${msg.slice(0, 100)}`, 'error')
    }
  }

  return (
    <>
      <section className="admin-section admin-section-tab">
        <div className="admin-section-head">
          <h2>顧客メンバー（{memberRows.length} 名）</h2>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => setInviteOpen(true)}
          >
            <Plus size={14} />
            <span>メンバーを招待</span>
          </button>
        </div>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>名前</th>
                <th>メール</th>
                <th>ロール</th>
                <th>招待日</th>
                <th>初回ログイン</th>
                <th>最終ログイン</th>
                <th aria-label="操作"></th>
              </tr>
            </thead>
            <tbody>
              {memberRows.map((m) => (
                <tr key={m.memberId}>
                  <td className="admin-table-name">
                    {m.displayName}
                    {m.systemRole === 'super_admin' && (
                      <span
                        className="admin-table-meta-pill"
                        title="このユーザーはシステム横断 super_admin です"
                      >
                        <ShieldCheck size={11} />
                        super_admin
                      </span>
                    )}
                  </td>
                  <td className="mono">
                    <Mail size={11} className="inline-icon" /> {m.email}
                  </td>
                  <td>
                    <span className="role-pill">
                      <UserCog size={11} />
                      {tenantRoleLabel(m.role)}
                    </span>
                  </td>
                  <td>{formatDate(m.invitedAt)}</td>
                  <td>
                    {m.firstLoginAt ? (
                      formatDateTime(m.firstLoginAt)
                    ) : (
                      <span className="muted">未ログイン</span>
                    )}
                  </td>
                  <td>
                    {m.lastLoginAt ? (
                      formatDateTime(m.lastLoginAt)
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="icon-btn icon-btn-danger"
                      title="メンバーシップを削除"
                      onClick={() => handleRemoveMember(m.memberId, m.displayName)}
                    >
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              ))}
              {memberRows.length === 0 && (
                <tr>
                  <td colSpan={7} className="admin-table-empty">
                    まだ顧客メンバーがいません。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="admin-section admin-section-tab">
        <div className="admin-section-head">
          <h2>
            <Eye size={14} className="inline-icon" /> サポート割り当て（
            {supportRows.length} 件）
          </h2>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setAssignOpen(true)}
          >
            <Plus size={14} />
            <span>サポート追加</span>
          </button>
        </div>
        <p className="admin-section-note in-panel">
          このテナントへ入る権限を持つ運営側のサポートスタッフ（有効なものだけ）
        </p>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>名前</th>
                <th>メール</th>
                <th>理由</th>
                <th>付与日</th>
                <th>有効期限</th>
              </tr>
            </thead>
            <tbody>
              {supportRows.map((s) => (
                <tr key={s.assignmentId}>
                  <td className="admin-table-name">
                    {s.displayName}
                    <span className="admin-table-meta-pill">
                      <ShieldCheck size={11} />
                      {s.systemRole ?? 'support'}
                    </span>
                  </td>
                  <td className="mono">
                    <Mail size={11} className="inline-icon" /> {s.email}
                  </td>
                  <td className="ellipsis-2">{s.notes ?? '—'}</td>
                  <td>{formatDateTime(s.grantedAt)}</td>
                  <td>
                    {s.expiresAt ? formatDateTime(s.expiresAt) : '無期限'}
                  </td>
                </tr>
              ))}
              {supportRows.length === 0 && (
                <tr>
                  <td colSpan={5} className="admin-table-empty">
                    現在、このテナントに有効なサポート割り当てはありません。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {inviteOpen && (
        <InviteMemberDialog
          org={org}
          adminUserId={adminUserId}
          onClose={() => setInviteOpen(false)}
          onCreated={() => {
            setInviteOpen(false)
            onChanged()
          }}
        />
      )}
      {assignOpen && (
        <AssignStaffDialog
          org={org}
          grantedByUserId={adminUserId}
          alreadyAssignedStaffIds={supportRows.map((s) => s.staffUserId)}
          onClose={() => setAssignOpen(false)}
          onCreated={() => {
            setAssignOpen(false)
            onChanged()
          }}
        />
      )}
    </>
  )
}

/* ===== センサータブ =====
 *
 * 通常のテナント画面の SensorsView と同じ列構成・初期並び順を読み取り専用で表示。
 * 列のカスタマイズ / 並び替え / 行クリック / 操作列は提供しない。
 * テーブルが横長なので親側で admin-view-wide が適用される。
 */
function SensorsTab({
  org,
  sensorRows,
  tenantState,
  adminUserId,
  onChanged,
}: {
  org: Organization
  sensorRows: SensorRow[]
  tenantState: ReturnType<typeof loadState>
  adminUserId: string
  onChanged: () => void
}) {
  const sensorGroups = tenantState?.sensorGroups ?? {}
  const sensorCategories = tenantState?.sensorCategories ?? {}
  const sensorColumns = defaultSensorColumnOrder()
  const inMigration =
    !!org.migrationMode?.startedAt && !org.migrationMode?.finishedAt

  const [createOpen, setCreateOpen] = useState(false)
  /** 未登録 DevEUI 行から「このテナントに登録」を押したとき、
   *  CreateSensorDialog を開きつつ Webhook で観測済みの値（DevEUI / sn / model /
   *  manufacturer）を固定値で渡すための state。null なら通常の手動追加モード。 */
  const [createPreset, setCreatePreset] = useState<
    import('../components/CreateSensorDialog').CreateSensorPreset | null
  >(null)
  const [bulkOpen, setBulkOpen] = useState(false)

  /* ---- 未登録 DevEUI（unmatched）---- */
  const unmatched: UnmatchedSummary[] = useMemo(
    () => unmatchedSummaryForOrg(org.id),
    // tenantState（センサー追加で sensors が変わると再計算したい）と
    // 「今すぐ更新」「擬似 webhook 投入」後の onChanged を契機に再計算するので
    // tenantState を依存に入れておく。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [org.id, tenantState],
  )

  function handleStartMigration() {
    if (
      !confirm(
        `「${org.name}」の移行モードを開始します。\n\nセンサータブに移行 CSV インポートパネルが表示されます。通常運用では使用しないため、移行が終わったら必ず「移行モードを完了」を押してください。`,
      )
    )
      return
    startMigrationMode(org, adminUserId)
    onChanged()
  }

  function handleProcessNow() {
    const r = processInbox()
    logStaffAction({
      staffUserId: adminUserId,
      organizationId: org.id,
      action: 'webhook_inbox_processed_manually',
      metadata: { processed: r.processed, unmatched: r.unmatched },
    })
    if (r.processed === 0 && r.unmatched === 0) {
      toast('処理対象（pending）がありませんでした', 'info')
    } else {
      toast(
        `仕分け完了: ${r.processed} 件を sensor_readings へ / ${r.unmatched} 件は未登録のまま`,
        'success',
      )
    }
    onChanged()
  }

  function handleSeedMockWebhooks() {
    const added = seedMockWebhooks(org.id, 5)
    const r = processInbox()
    logStaffAction({
      staffUserId: adminUserId,
      organizationId: org.id,
      action: 'mock_webhooks_seeded',
      metadata: {
        added,
        processed: r.processed,
        unmatched: r.unmatched,
      },
    })
    toast(
      `擬似 Webhook ${added} 件を投入し仕分けました（processed ${r.processed} / unmatched ${r.unmatched}）`,
      'success',
    )
    onChanged()
  }

  function handleIgnoreDevEUI(s: UnmatchedSummary) {
    if (
      !confirm(
        `DevEUI "${s.devEUI}" を誤送信扱いにします。\n\n直近 ${s.count} 件の受信が一覧から消えます。再度同じ DevEUI で届いた場合は、また unmatched として一覧に出てきます。`,
      )
    )
      return
    const n = ignoreUnmatchedDevEUI(org.id, s.devEUI, adminUserId)
    logStaffAction({
      staffUserId: adminUserId,
      organizationId: org.id,
      action: 'unmatched_dev_eui_ignored',
      metadata: { devEUI: s.devEUI, count: n },
    })
    toast(`DevEUI "${s.devEUI}" を ${n} 件無視しました`, 'success')
    onChanged()
  }

  return (
    <>
      {/* Phase F-3 (mock): 移行 CSV インポートパネル。
          移行モード OFF のときは何も描画しない（エントリポイントは下のメニュー）。 */}
      <MigrationCsvPanel
        org={org}
        adminUserId={adminUserId}
        onChanged={onChanged}
      />

      {/* Phase F-3 (mock): 未登録 DevEUI セクション。
          unmatched が 0 件のときはセクション自体出さない。 */}
      {unmatched.length > 0 && (
        <UnmatchedDevicesSection
          org={org}
          unmatched={unmatched}
          onRegister={(summary) => {
            // Webhook で受信済みの DevEUI / sn / model / メーカー をすべて
            // preset として渡し、ダイアログ側で固定表示する。
            setCreatePreset({
              devEUI: summary.devEUI,
              serialNumber: summary.sn,
              model: summary.model,
              manufacturer: summary.manufacturer ?? 'Milesight',
            })
            setCreateOpen(true)
          }}
          onIgnore={handleIgnoreDevEUI}
        />
      )}

      <section className="admin-section admin-section-tab admin-section-devices">
        <div className="admin-section-head">
          <h2>
            <Cpu size={16} className="inline-icon" /> センサー（
            {sensorRows.length} 台）
          </h2>
          <div className="admin-section-head-right">
            <span className="admin-section-note">
              通常のテナント画面と同じ列構成（読み取り専用）。
            </span>
            <SectionActionMenu
              items={[
                {
                  key: 'add-one',
                  label: 'センサーを 1 件追加',
                  hint: 'デバイス番号・シリアル・DevEUI 等を 1 件分入力',
                  onClick: () => {
                    setCreatePreset(null)
                    setCreateOpen(true)
                  },
                },
                {
                  key: 'add-bulk',
                  label: '一括追加（TSV / CSV 貼り付け）',
                  hint: 'Excel から複数行を一気にコピペで投入',
                  onClick: () => setBulkOpen(true),
                },
                ...(inMigration
                  ? []
                  : [
                      {
                        key: 'start-migration' as const,
                        label: '移行モードを開始',
                        hint: '既存システムから CSV 一括取り込みを行うときだけ使う特殊操作',
                        onClick: handleStartMigration,
                      },
                    ]),
                /* ----- 補助: 運用ヘルパ ----- */
                { kind: 'divider' as const, key: 'div-ops', label: '補助' },
                {
                  key: 'process-now',
                  label: '今すぐ仕分けバッチを実行',
                  hint: 'webhook_inbox の pending を sensors と照合（5 分 cron の手動 invoke）',
                  onClick: handleProcessNow,
                },
                /* ----- モック検証用（実バックエンド着手後は撤去予定） ----- */
                {
                  kind: 'divider' as const,
                  key: 'div-mock',
                  label: 'モック検証用',
                },
                {
                  key: 'seed-mock',
                  label: '擬似 Webhook を 5 件投入',
                  hint: '本番では Milesight から自動で届く。ここでは検証用に手で投入',
                  onClick: handleSeedMockWebhooks,
                },
              ]}
            />
          </div>
        </div>

      <div className="device-table-wrap admin-device-grid">
        {sensorRows.length === 0 ? (
          <div className="admin-table-empty admin-empty-block">
            まだセンサーが登録されていません。
          </div>
        ) : (
          <table className="device-table">
            <thead>
              <tr>
                <th className="col-name">名前</th>
                {sensorColumns.map((k) => (
                  <th key={k} className={SENSOR_COLUMN_HEAD_CLASS[k]}>
                    {SENSOR_COLUMN_LABEL[k]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sensorRows.map((r) => (
                <tr key={r.sensor.id}>
                  <td className="col-name">
                    <span className="device-id-name">
                      <Cpu size={14} className="row-icon" />
                      {r.sensor.name ?? r.sensor.id}
                    </span>
                  </td>
                  {sensorColumns.map((k) =>
                    renderSensorCell(k, r, sensorGroups, sensorCategories),
                  )}
                </tr>
              ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {createOpen && (
        <CreateSensorDialog
          org={org}
          adminUserId={adminUserId}
          preset={createPreset ?? undefined}
          onClose={() => {
            setCreateOpen(false)
            setCreatePreset(null)
          }}
          onCreated={() => {
            setCreateOpen(false)
            setCreatePreset(null)
            onChanged()
          }}
        />
      )}
      {bulkOpen && (
        <BulkAddSensorsDialog
          org={org}
          adminUserId={adminUserId}
          onClose={() => setBulkOpen(false)}
          onCreated={() => {
            setBulkOpen(false)
            onChanged()
          }}
        />
      )}
    </>
  )
}

/* ===== 未登録 DevEUI セクション =====
 *
 * Webhook で届いた DevEUI のうち、このテナントの sensors に存在しないもの。
 * Phase F-3 (mock) の中核。本番では process_webhook_inbox バッチが
 * `parse_status='unmatched'` を残し、この一覧から admin が claim する運用。
 */
function UnmatchedDevicesSection({
  org,
  unmatched,
  onRegister,
  onIgnore,
}: {
  org: Organization
  unmatched: UnmatchedSummary[]
  /** 登録を開始する。固定値として渡したい一式を summary 全部受け取る。 */
  onRegister: (summary: UnmatchedSummary) => void
  onIgnore: (s: UnmatchedSummary) => void
}) {
  return (
    <section className="admin-section admin-section-tab unmatched-section">
      <div className="admin-section-head">
        <h2 className="unmatched-head-title">
          <AlertTriangle size={16} className="inline-icon" /> 未登録 DevEUI が
          {unmatched.length} 件あります
        </h2>
        <div className="admin-section-note">
          「{org.name}」宛の Webhook で受信したけれど、まだ
          sensors に紐付いていない DevEUI です。登録するとそのテナントに
          紐付き、過去の受信ぶんも遡って sensor_readings に反映されます。
        </div>
      </div>

      <ul className="unmatched-list">
        {unmatched.map((u) => (
          <li key={u.devEUI} className="unmatched-row">
            <div className="unmatched-row-main">
              <code className="unmatched-deveui mono">{u.devEUI}</code>
              {u.model && (
                <span className="unmatched-model badge-outline">{u.model}</span>
              )}
              <span className="unmatched-meta">
                直近 {formatRelative(u.lastSeenAt)} ・ {u.count} 件
              </span>
            </div>
            <div className="unmatched-row-actions">
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => onRegister(u)}
              >
                <Plus size={13} />
                <span>このテナントに登録</span>
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => onIgnore(u)}
              >
                <XIcon size={13} />
                <span>無視（誤送信）</span>
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** 「2 分前」「45 秒前」のような相対時刻表示。
 *  unmatched 行のヘッダ表記用。1 分未満は秒表記。 */
function formatRelative(d: Date): string {
  const diffMs = Date.now() - d.getTime()
  if (diffMs < 0) return '直後'
  const sec = Math.floor(diffMs / 1000)
  if (sec < 60) return `${sec} 秒前`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} 分前`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `${hour} 時間前`
  const day = Math.floor(hour / 24)
  return `${day} 日前`
}

/* ===== ゲートウェイタブ ===== */
function GatewaysTab({
  org,
  tenantState,
  adminUserId,
  onChanged,
}: {
  org: Organization
  tenantState: ReturnType<typeof loadState>
  adminUserId: string
  onChanged: () => void
}) {
  const sensors = tenantState ? sensorsFromState(tenantState) : {}
  const gateways = tenantState ? gatewaysFromState(tenantState) : {}
  const gatewayList = useMemo(
    () =>
      Object.values(gateways).sort((a, b) =>
        (a.name ?? a.id).localeCompare(b.name ?? b.id, 'ja'),
      ),
    [gateways],
  )

  const [createOpen, setCreateOpen] = useState(false)
  const [bulkOpen, setBulkOpen] = useState(false)

  return (
    <section className="admin-section admin-section-tab admin-section-devices">
      <div className="admin-section-head">
        <h2>
          <RouterIcon size={16} className="inline-icon" /> ゲートウェイ（
          {gatewayList.length} 台）
        </h2>
        <div className="admin-section-head-right">
          <span className="admin-section-note">
            通常のテナント画面と同じ列構成（読み取り専用）。
          </span>
          <SectionActionMenu
            items={[
              {
                key: 'add-one',
                label: 'ゲートウェイを 1 件追加',
                hint: '名前・シリアル・DevEUI 等を 1 件分入力',
                onClick: () => setCreateOpen(true),
              },
              {
                key: 'add-bulk',
                label: '一括追加（TSV / CSV 貼り付け）',
                hint: '複数行を Excel からコピペで投入',
                onClick: () => setBulkOpen(true),
              },
            ]}
          />
        </div>
      </div>

      <div className="device-table-wrap admin-device-grid">
        {gatewayList.length === 0 ? (
          <div className="admin-table-empty admin-empty-block">
            まだゲートウェイが登録されていません。
          </div>
        ) : (
          <table className="device-table">
            <thead>
              <tr>
                <th>名前</th>
                {GATEWAY_COLUMN_DEFS.map((def) => (
                  <th key={def.key} className={def.numeric ? 'num' : ''}>
                    {def.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {gatewayList.map((gw) => {
                const linked = sensorsOfGateway(sensors, gw.id)
                return (
                  <tr key={gw.id}>
                    <td>
                      <span className="device-id-name">
                        <RouterIcon size={14} className="row-icon" />
                        {gw.name}
                      </span>
                    </td>
                    {GATEWAY_COLUMN_DEFS.map((def) => {
                      switch (def.key) {
                        case 'deviceNumber':
                          return (
                            <td key={def.key}>
                              <span className="mono">
                                {gw.deviceNumber ?? gw.id}
                              </span>
                            </td>
                          )
                        case 'manufacturer':
                          return <td key={def.key}>{gw.manufacturer}</td>
                        case 'model':
                          return <td key={def.key}>{gw.model}</td>
                        case 'serialNumber':
                          return (
                            <td key={def.key}>
                              <span className="mono">{gw.serialNumber}</span>
                            </td>
                          )
                        case 'devEUI':
                          return (
                            <td key={def.key}>
                              <span className="mono">{gw.devEUI ?? '—'}</span>
                            </td>
                          )
                        case 'group':
                          return (
                            <td key={def.key}>
                              {gw.location ? (
                                <span className="location-cell">
                                  <MapPin size={12} />
                                  {gw.location}
                                </span>
                              ) : (
                                <span className="muted">—</span>
                              )}
                            </td>
                          )
                        case 'status':
                          return (
                            <td key={def.key} className="muted">
                              {/* admin の概要ビューでは省略 */}—
                            </td>
                          )
                        case 'category':
                        case 'tags':
                        case 'offlineAlert':
                        case 'notificationSetting':
                        case 'registeredAt':
                          return (
                            <td key={def.key} className="muted">—</td>
                          )
                        case 'silentTimeRanges':
                          return (
                            <td key={def.key} className="num muted">
                              {gw.alertSettings?.exclusionWindows?.length ?? 0}
                            </td>
                          )
                        case 'silentDates':
                          return (
                            <td key={def.key} className="num muted">
                              {gw.alertSettings?.exclusionDates?.length ?? 0}
                            </td>
                          )
                        default: {
                          // 接続センサー数は新仕様で列が無くなったため、補助情報として
                          // 接続台数を捨てるのは惜しいので linked を画面側で別表記する。
                          void linked
                          return null
                        }
                      }
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {createOpen && (
        <CreateGatewayDialog
          org={org}
          adminUserId={adminUserId}
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false)
            onChanged()
          }}
        />
      )}
      {bulkOpen && (
        <BulkAddGatewaysDialog
          org={org}
          adminUserId={adminUserId}
          onClose={() => setBulkOpen(false)}
          onCreated={() => {
            setBulkOpen(false)
            onChanged()
          }}
        />
      )}
    </section>
  )
}

/* ===== Milesight 連携設定タブ（Phase F-2 mock）=====
 *
 * 各テナント専用の Webhook URL と X-Webhook-Secret を表示し、
 * MDP（Milesight Development Platform）の Application 設定に
 * 貼り付けてもらうための画面。
 *
 * 本番では `/api/webhooks/milesight/{org_id}` がここに表示する Secret で
 * 認証する。モックではローカル localStorage のみ。
 */
/** 連携設定タブ内の sub-tab（メーカー単位） */
type IntegrationSubTab = 'milesight' | 'iot-mobile'

function IntegrationTab({
  org,
  adminUserId,
  tenantStateRev,
}: {
  org: Organization
  adminUserId: string
  /** sensors / webhook_inbox の更新検知に使う依存 */
  tenantStateRev: ReturnType<typeof loadState>
}) {
  const [subTab, setSubTab] = useState<IntegrationSubTab>('milesight')

  return (
    <section className="admin-section admin-section-tab integration-section">
      <div className="admin-section-head">
        <h2>
          <Webhook size={16} className="inline-icon" /> 連携設定
        </h2>
        <span className="admin-section-note">
          メーカーごとの Webhook 受信設定と直近の受信ログを管理します。
        </span>
      </div>

      {/* メーカー単位の sub-tab。今後対応メーカーを増やすときはここに追加。 */}
      <nav className="integration-subtabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={subTab === 'milesight'}
          className={`integration-subtab ${subTab === 'milesight' ? 'is-active' : ''}`}
          onClick={() => setSubTab('milesight')}
        >
          Milesight
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={subTab === 'iot-mobile'}
          className={`integration-subtab ${subTab === 'iot-mobile' ? 'is-active' : ''}`}
          onClick={() => setSubTab('iot-mobile')}
        >
          IoT Mobile
        </button>
      </nav>

      {subTab === 'milesight' && (
        <MilesightIntegrationPanel
          org={org}
          adminUserId={adminUserId}
          tenantStateRev={tenantStateRev}
        />
      )}
      {subTab === 'iot-mobile' && (
        <div className="admin-empty-block integration-future-block">
          <strong>IoT Mobile 連携は今後対応予定です。</strong>
          <p className="muted" style={{ margin: '0.4rem 0 0' }}>
            国内向け LTE-M / Sigfox 対応のセンサーシリーズに対応次第、ここで設定できるようになります。
          </p>
        </div>
      )}
    </section>
  )
}

/* ===== Milesight 連携パネル =====
 *
 * MDP の Application 設定で発行された UUID / Secret を admin が手で入力する。
 * URL はテナント固有のものをミテルデ側が表示し、コピーして MDP の
 * Callback URI 欄に貼り付ける運用。
 */
function MilesightIntegrationPanel({
  org,
  adminUserId,
  tenantStateRev,
}: {
  org: Organization
  adminUserId: string
  tenantStateRev: ReturnType<typeof loadState>
}) {
  const [integration, setIntegration] = useState<ManufacturerIntegration>(() =>
    ensureMilesightIntegration(org.id),
  )
  // 入力欄の現在値（手入力 → 確定で保存）
  const [uuidDraft, setUuidDraft] = useState<string>(
    integration.webhookUuid ?? '',
  )
  const [secretDraft, setSecretDraft] = useState<string>(
    integration.webhookSecret ?? '',
  )
  const [showSecret, setShowSecret] = useState<boolean>(false)
  const [rawViewerEvent, setRawViewerEvent] = useState<WebhookInboxItem | null>(
    null,
  )
  const webhookUrl = buildWebhookUrl(org.id)

  const uuidDirty = uuidDraft !== (integration.webhookUuid ?? '')
  const secretDirty = secretDraft !== (integration.webhookSecret ?? '')
  const dirty = uuidDirty || secretDirty

  function handleSaveCredentials() {
    const next = updateMilesightCredentials(org.id, {
      webhookUuid: uuidDraft.trim() || undefined,
      webhookSecret: secretDraft.trim() || undefined,
    })
    setIntegration(next)
    logStaffAction({
      staffUserId: adminUserId,
      organizationId: org.id,
      action: 'milesight_credentials_updated',
      metadata: {
        uuidChanged: uuidDirty,
        secretChanged: secretDirty,
      },
    })
    toast('Milesight 連携情報を保存しました', 'success')
  }

  async function handleCopy(text: string, label: string) {
    if (!text) {
      toast('コピーする値がありません', 'error')
      return
    }
    try {
      await navigator.clipboard.writeText(text)
      toast(`${label}をコピーしました`, 'success')
    } catch {
      toast('コピーに失敗しました', 'error')
    }
  }

  return (
    <div className="integration-panel">
      <p className="integration-intro">
        MDP（Milesight Development Platform）の Application 設定で、
        下の <strong>Webhook URL</strong> を Callback URI 欄に貼り付け、
        MDP 側で発行された <strong>UUID</strong> と <strong>Secret</strong> を
        下の入力欄にコピーして保存してください。Secret が保存された時点で
        「連携中」とみなします。
      </p>

      <div className="integration-grid">
        <div className="integration-row">
          <label className="form-label">Webhook URL（テナント固有・コピー専用）</label>
          <div className="integration-value-block">
            <code className="mono integration-value">{webhookUrl}</code>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => handleCopy(webhookUrl, 'Webhook URL')}
              title="クリップボードにコピー"
            >
              <Copy size={13} />
              <span>コピー</span>
            </button>
          </div>
          <p className="form-help">
            このテナント宛の Webhook はすべてこの URL に届きます。
            別テナントとは絶対に共有しないでください（受信時に URL 内の org_id を検証します）。
          </p>
        </div>

        <div className="integration-row">
          <label className="form-label" htmlFor="milesight-uuid">
            UUID（MDP で発行）
          </label>
          <div className="integration-value-block">
            <input
              id="milesight-uuid"
              type="text"
              className="form-input mono integration-input"
              value={uuidDraft}
              onChange={(e) => setUuidDraft(e.target.value)}
              placeholder="665e05dd-2f56-4c11-ac17-a77d74d747cf"
              spellCheck={false}
            />
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => handleCopy(integration.webhookUuid ?? '', 'UUID')}
              disabled={!integration.webhookUuid}
              title="保存済みの UUID をコピー"
            >
              <Copy size={13} />
              <span>コピー</span>
            </button>
          </div>
          <p className="form-help">
            MDP の Application 設定 → Webhook 欄の「UUID」をそのまま貼り付け。
          </p>
        </div>

        <div className="integration-row">
          <label className="form-label" htmlFor="milesight-secret">
            Secret（MDP で発行）
          </label>
          <div className="integration-value-block">
            <input
              id="milesight-secret"
              type={showSecret ? 'text' : 'password'}
              className="form-input mono integration-input"
              value={secretDraft}
              onChange={(e) => setSecretDraft(e.target.value)}
              placeholder="MDP で発行された Secret を貼り付け"
              spellCheck={false}
              autoComplete="off"
            />
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setShowSecret((v) => !v)}
              title={showSecret ? '隠す' : '表示する'}
            >
              {showSecret ? <EyeOff size={13} /> : <Eye size={13} />}
              <span>{showSecret ? '隠す' : '表示'}</span>
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => handleCopy(integration.webhookSecret ?? '', 'Secret')}
              disabled={!integration.webhookSecret}
              title="保存済みの Secret をコピー"
            >
              <Copy size={13} />
              <span>コピー</span>
            </button>
          </div>
          <p className="form-help">
            受信ハンドラは <code className="mono">X-Webhook-Secret</code>{' '}
            ヘッダがこの値と一致しないリクエストを 401 で拒否します。
            最終更新: {formatDateTime(integration.updatedAt)}
          </p>
        </div>

        <div className="integration-save-row">
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleSaveCredentials}
            disabled={!dirty}
          >
            <Save size={14} />
            <span>UUID / Secret を保存</span>
          </button>
          {dirty && (
            <span className="muted small">未保存の変更があります</span>
          )}
        </div>
      </div>

      <WebhookEventsPanel
        org={org}
        tenantStateRev={tenantStateRev}
        onShowRaw={setRawViewerEvent}
      />

      {rawViewerEvent && (
        <RawPayloadDialog
          event={rawViewerEvent}
          onClose={() => setRawViewerEvent(null)}
        />
      )}
    </div>
  )
}

/* ===== Webhook 受信ログ（期間絞り込み + ページネーション）===== */
function WebhookEventsPanel({
  org,
  tenantStateRev,
  onShowRaw,
}: {
  org: Organization
  tenantStateRev: ReturnType<typeof loadState>
  onShowRaw: (ev: WebhookInboxItem) => void
}) {
  // 期間フィルタ（HH:MM 抜き、日付のみ）
  const [dateFrom, setDateFrom] = useState<string>('')
  const [dateTo, setDateTo] = useState<string>('')
  const [pageSize, setPageSize] = useState<number>(25)
  const [page, setPage] = useState<number>(0)

  // 全イベント（このテナントぶん、新しい順）
  const allEvents: WebhookInboxItem[] = useMemo(() => {
    const inbox = loadWebhookInbox()
    return Object.values(inbox)
      .filter((it) => it.organizationId === org.id)
      .sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime())
    // tenantStateRev は外部からの再描画トリガ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org.id, tenantStateRev])

  // 期間フィルタ適用
  const filtered: WebhookInboxItem[] = useMemo(() => {
    if (!dateFrom && !dateTo) return allEvents
    const fromMs = dateFrom ? new Date(`${dateFrom}T00:00:00`).getTime() : -Infinity
    const toMs = dateTo
      ? new Date(`${dateTo}T23:59:59.999`).getTime()
      : Infinity
    return allEvents.filter((ev) => {
      const t = ev.receivedAt.getTime()
      return t >= fromMs && t <= toMs
    })
  }, [allEvents, dateFrom, dateTo])

  const total = filtered.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  // フィルタ条件 / ページサイズ変更でページがはみ出したら戻す
  const safePage = Math.min(page, totalPages - 1)
  const pageEvents = filtered.slice(
    safePage * pageSize,
    safePage * pageSize + pageSize,
  )
  const startIdx = total === 0 ? 0 : safePage * pageSize + 1
  const endIdx = Math.min((safePage + 1) * pageSize, total)

  function resetFilter() {
    setDateFrom('')
    setDateTo('')
    setPage(0)
  }

  return (
    <>
      <h3 className="integration-events-head">
        受信した Webhook
      </h3>

      <div className="integration-events-toolbar">
        <div className="integration-filter-group">
          <label className="form-label-inline" htmlFor="evt-date-from">
            期間
          </label>
          <input
            id="evt-date-from"
            type="date"
            className="form-input integration-date-input"
            value={dateFrom}
            onChange={(e) => {
              setDateFrom(e.target.value)
              setPage(0)
            }}
          />
          <span className="muted">〜</span>
          <input
            type="date"
            className="form-input integration-date-input"
            value={dateTo}
            onChange={(e) => {
              setDateTo(e.target.value)
              setPage(0)
            }}
          />
          {(dateFrom || dateTo) && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={resetFilter}
            >
              クリア
            </button>
          )}
        </div>
        <div className="integration-page-info">
          <span className="muted">
            {total === 0 ? '0 件' : `${startIdx}-${endIdx} 件 / 全 ${total} 件`}
          </span>
          <select
            className="select integration-pagesize"
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value))
              setPage(0)
            }}
            aria-label="1 ページあたりの件数"
          >
            <option value={10}>10 件</option>
            <option value={25}>25 件</option>
            <option value={50}>50 件</option>
            <option value={100}>100 件</option>
          </select>
        </div>
      </div>

      {total === 0 ? (
        <div className="admin-empty-block">
          {allEvents.length === 0
            ? 'まだ Webhook を受信していません。センサータブの kebab メニュー「擬似 Webhook を投入」で動作確認できます。'
            : '指定した期間に Webhook 受信はありません。'}
        </div>
      ) : (
        <>
          <div className="admin-table-wrap">
            <table className="admin-table integration-events-table">
              <thead>
                <tr>
                  <th>受信時刻</th>
                  <th>DevEUI</th>
                  <th>イベント</th>
                  <th>状態</th>
                  <th className="num">payload</th>
                </tr>
              </thead>
              <tbody>
                {pageEvents.map((ev) => (
                  <tr key={ev.id}>
                    <td>{formatDateTime(ev.receivedAt)}</td>
                    <td>
                      <code className="mono">{ev.devEUI}</code>
                    </td>
                    <td>
                      {ev.eventType}
                      {ev.dataType ? ` / ${ev.dataType}` : ''}
                    </td>
                    <td>
                      <span
                        className={`integration-status integration-status-${ev.parseStatus}`}
                      >
                        {parseStatusLabel(ev.parseStatus)}
                      </span>
                    </td>
                    <td className="num">
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => onShowRaw(ev)}
                        disabled={!ev.payloadRaw}
                        title={
                          ev.payloadRaw
                            ? '生 JSON を表示'
                            : '古いデータには生 JSON が含まれません'
                        }
                      >
                        <Code size={13} />
                        <span>詳細</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="integration-pager">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setPage(0)}
                disabled={safePage === 0}
                title="最初のページ"
              >
                «
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={safePage === 0}
              >
                ‹ 前へ
              </button>
              <span className="integration-pager-status">
                {safePage + 1} / {totalPages}
              </span>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() =>
                  setPage((p) => Math.min(totalPages - 1, p + 1))
                }
                disabled={safePage >= totalPages - 1}
              >
                次へ ›
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setPage(totalPages - 1)}
                disabled={safePage >= totalPages - 1}
                title="最後のページ"
              >
                »
              </button>
            </div>
          )}
        </>
      )}
    </>
  )
}

/* ===== 生 payload ビューア =====
 *
 * webhook_inbox.payload_raw（実 Supabase スキーマ）相当を見るためのダイアログ。
 * Milesight が送ってきた JSON 1 イベント分をそのまま表示する。
 * パース失敗時の調査・現場でのトラブルシュート用にコピー機能つき。
 */
function RawPayloadDialog({
  event,
  onClose,
}: {
  event: WebhookInboxItem
  onClose: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dlg = ref.current
    if (!dlg) return
    if (!dlg.open) dlg.showModal()
  }, [])

  const json = event.payloadRaw
    ? JSON.stringify(event.payloadRaw, null, 2)
    : '(生 JSON が保存されていません — モック投入前のデータです)'

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(json)
      toast('JSON をコピーしました', 'success')
    } catch {
      toast('コピーに失敗しました', 'error')
    }
  }

  return (
    <dialog
      ref={ref}
      className="app-dialog raw-payload-dialog"
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
    >
      <div className="app-dialog-form">
        <header className="app-dialog-head">
          <h2>
            <Code size={16} className="inline-icon" />
            Webhook 生 payload
          </h2>
          <button
            type="button"
            className="icon-btn"
            aria-label="閉じる"
            onClick={onClose}
          >
            <XIcon size={16} />
          </button>
        </header>

        <div className="app-dialog-body raw-payload-body">
          <div className="raw-payload-meta">
            <div>
              <strong>受信時刻:</strong> {formatDateTime(event.receivedAt)}
            </div>
            <div>
              <strong>eventId:</strong>{' '}
              <code className="mono">{event.payloadRaw?.eventId ?? '—'}</code>
            </div>
            <div>
              <strong>状態:</strong>{' '}
              <span
                className={`integration-status integration-status-${event.parseStatus}`}
              >
                {parseStatusLabel(event.parseStatus)}
              </span>
              {event.matchedSensorId && (
                <>
                  {' / '}
                  <strong>マッチ先:</strong>{' '}
                  <code className="mono">{event.matchedSensorId}</code>
                </>
              )}
            </div>
          </div>
          <pre className="raw-payload-json mono">{json}</pre>
        </div>

        <footer className="app-dialog-foot">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onClose}
          >
            閉じる
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleCopy}
            disabled={!event.payloadRaw}
          >
            <Copy size={13} />
            <span>JSON をコピー</span>
          </button>
        </footer>
      </div>
    </dialog>
  )
}

function parseStatusLabel(s: WebhookInboxItem['parseStatus']): string {
  if (s === 'pending') return '未仕分け'
  if (s === 'processed') return '反映済み'
  if (s === 'unmatched') return '未登録 DevEUI'
  return '無視'
}
