/**
 * Phase 1.6: 運営ダッシュボード（/admin / および /admin/dashboard）。
 *
 * 全テナント横断の運営サマリーを 1 画面で見せる。
 * super_admin: 全テナント集計
 * support / sales: 自分の有効な staff_assignments 対象テナントのみ集計
 *
 * データ取得は「ページ表示時 1 回」。手動 Refresh ボタンで再取得可能。
 * Realtime 購読は Phase 後半で別途検討。
 */
import { useEffect, useMemo, useState } from 'react'
import {
  LayoutDashboard,
  Building2,
  Cpu,
  AlertTriangle,
  Webhook,
  Calendar,
  ShieldOff,
  RefreshCw,
  ArrowRight,
} from 'lucide-react'
import {
  loadOrganizations,
  loadStaffAssignments,
  loadUsers,
} from '../lib/adminStorage'
import { supabase, isSupabaseConfigured } from '../../lib/supabase'
import { fetchOrganizationsList } from '../../lib/supabaseQueries'
import type {
  AlertLogEntry,
  Organization,
} from '../../types'

type Props = {
  viewerUserId: string
  isSuperAdmin: boolean
  onOpenTenant: (tenantId: string) => void
  onGoTenants: () => void
}

type DeviceLite = {
  id: string
  organization_id: string
  device_type: string
  online: boolean | null
  last_seen_at: string | null
}

type InboxRow = {
  id: string
  organization_id: string | null
  parse_status: string
  received_at: string
}

type DashboardData = {
  loading: boolean
  error: string | null
  tenants: Organization[]
  devices: DeviceLite[]
  recentAlerts: AlertLogEntry[]
  unmatchedInboxByOrg: Map<string, number>
}

function daysUntil(d: Date | string | null | undefined): number | null {
  if (!d) return null
  const t = new Date(d).getTime()
  if (Number.isNaN(t)) return null
  return Math.ceil((t - Date.now()) / 86_400_000)
}

function formatDate(d: Date | string | null | undefined): string {
  if (!d) return '—'
  const dd = new Date(d)
  if (Number.isNaN(dd.getTime())) return '—'
  return `${dd.getFullYear()}/${String(dd.getMonth() + 1).padStart(2, '0')}/${String(dd.getDate()).padStart(2, '0')}`
}

function formatDateTime(d: Date | string | null | undefined): string {
  if (!d) return '—'
  const dd = new Date(d)
  if (Number.isNaN(dd.getTime())) return '—'
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${dd.getFullYear()}/${pad(dd.getMonth() + 1)}/${pad(dd.getDate())} ${pad(dd.getHours())}:${pad(dd.getMinutes())}`
}

async function fetchDashboardBundle(orgIds: string[] | null): Promise<{
  devices: DeviceLite[]
  recentAlerts: AlertLogEntry[]
  unmatchedInboxByOrg: Map<string, number>
}> {
  if (!isSupabaseConfigured()) {
    return { devices: [], recentAlerts: [], unmatchedInboxByOrg: new Map() }
  }
  // devices （sensor / gateway 区別あり、online フラグも欲しい）
  const devicesQuery = supabase
    .from('devices')
    .select('id, organization_id, device_type, online, last_seen_at')
  if (orgIds) devicesQuery.in('organization_id', orgIds)
  const { data: devicesData, error: devicesErr } = await devicesQuery
  if (devicesErr) throw new Error(`devices: ${devicesErr.message}`)

  // 直近 24 時間の deviation-alert
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const alertsQuery = supabase
    .from('alert_logs')
    .select('id, organization_id, occurred_at, target_kind, target_id, manufacturer, model, serial_number, sensor_number, kind, metric, value, message, session_id, re_alert_index, confirm_comment, confirmed_by, confirmed_at')
    .gte('occurred_at', since)
    .order('occurred_at', { ascending: false })
    .limit(100)
  if (orgIds) alertsQuery.in('organization_id', orgIds)
  const { data: alertsData, error: alertsErr } = await alertsQuery
  if (alertsErr) throw new Error(`alerts: ${alertsErr.message}`)

  const recentAlerts: AlertLogEntry[] = (alertsData ?? []).map((r) => ({
    id: r.id,
    occurredAt: new Date(r.occurred_at),
    targetKind: r.target_kind,
    targetId: r.target_id ?? '',
    manufacturer: r.manufacturer,
    model: r.model,
    serialNumber: r.serial_number,
    sensorNumber: r.sensor_number ?? undefined,
    kind: r.kind as AlertLogEntry['kind'],
    metric: (r.metric ?? undefined) as AlertLogEntry['metric'],
    value: r.value ?? undefined,
    message: r.message,
    sessionId: r.session_id ?? undefined,
    reAlertIndex: r.re_alert_index ?? undefined,
    confirmComment: r.confirm_comment ?? undefined,
    confirmedBy: r.confirmed_by ?? undefined,
    confirmedAt: r.confirmed_at ? new Date(r.confirmed_at) : undefined,
  }))

  // 未登録 DevEUI（webhook_inbox の parse_status='unmatched'）
  const inboxQuery = supabase
    .from('webhook_inbox')
    .select('id, organization_id, parse_status, received_at')
    .eq('parse_status', 'unmatched')
    .limit(500)
  if (orgIds) inboxQuery.in('organization_id', orgIds)
  const { data: inboxData, error: inboxErr } = await inboxQuery
  if (inboxErr) throw new Error(`inbox: ${inboxErr.message}`)

  const unmatchedInboxByOrg = new Map<string, number>()
  for (const r of (inboxData ?? []) as InboxRow[]) {
    if (!r.organization_id) continue
    unmatchedInboxByOrg.set(
      r.organization_id,
      (unmatchedInboxByOrg.get(r.organization_id) ?? 0) + 1,
    )
  }

  return {
    devices: (devicesData ?? []) as DeviceLite[],
    recentAlerts,
    unmatchedInboxByOrg,
  }
}

export function AdminDashboardView({
  viewerUserId,
  isSuperAdmin,
  onOpenTenant,
  onGoTenants,
}: Props) {
  const [data, setData] = useState<DashboardData>({
    loading: true,
    error: null,
    tenants: [],
    devices: [],
    recentAlerts: [],
    unmatchedInboxByOrg: new Map(),
  })
  const [refreshKey, setRefreshKey] = useState(0)
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null)

  useEffect(() => {
    let cancelled = false
    setData((d) => ({ ...d, loading: true, error: null }))

    ;(async () => {
      try {
        // 1) tenants
        let tenants: Organization[] = []
        if (isSupabaseConfigured()) {
          tenants = await fetchOrganizationsList()
        } else {
          tenants = Object.values(loadOrganizations())
        }

        // 2) scope
        let scopedOrgIds: string[] | null = null
        if (!isSuperAdmin) {
          const now = Date.now()
          const assignments = loadStaffAssignments()
          scopedOrgIds = Array.from(
            new Set(
              Object.values(assignments)
                .filter((a) => a.staffUserId === viewerUserId)
                .filter((a) => !a.revokedAt)
                .filter((a) => !a.expiresAt || new Date(a.expiresAt).getTime() > now)
                .map((a) => a.organizationId),
            ),
          )
          tenants = tenants.filter((t) => scopedOrgIds!.includes(t.id))
        }

        // 3) bundle fetch
        const bundle = await fetchDashboardBundle(scopedOrgIds)
        if (cancelled) return

        setData({
          loading: false,
          error: null,
          tenants,
          devices: bundle.devices,
          recentAlerts: bundle.recentAlerts,
          unmatchedInboxByOrg: bundle.unmatchedInboxByOrg,
        })
        setRefreshedAt(new Date())
      } catch (e) {
        if (cancelled) return
        const msg = e instanceof Error ? e.message : String(e)
        setData((d) => ({ ...d, loading: false, error: msg }))
      }
    })()

    return () => {
      cancelled = true
    }
  }, [refreshKey, viewerUserId, isSuperAdmin])

  /* ---- 派生指標 ---- */

  const stats = useMemo(() => {
    const tenantCount = data.tenants.length
    const activeTenants = data.tenants.filter((t) => !t.deactivatedAt).length
    const deactivatedTenants = tenantCount - activeTenants

    const sensorCount = data.devices.filter((d) => d.device_type === 'sensor').length
    const onlineSensorCount = data.devices.filter(
      (d) => d.device_type === 'sensor' && d.online,
    ).length
    const offlineSensorCount = sensorCount - onlineSensorCount

    const alertCount24h = data.recentAlerts.length
    const unconfirmedAlerts = data.recentAlerts.filter((a) => !a.confirmedAt).length

    const unmatchedDevEui = Array.from(data.unmatchedInboxByOrg.values()).reduce(
      (s, n) => s + n,
      0,
    )
    const tenantsWithUnmatched = data.unmatchedInboxByOrg.size

    // 契約期限 30 日以内の有効テナント
    const expiringSoon = data.tenants
      .filter((t) => !t.deactivatedAt)
      .map((t) => ({ ...t, remainingDays: daysUntil(t.contractExpiresAt) }))
      .filter((t) => t.remainingDays !== null && t.remainingDays <= 30 && t.remainingDays >= -30)
      .sort((a, b) => (a.remainingDays ?? 0) - (b.remainingDays ?? 0))
      .slice(0, 10)

    return {
      tenantCount,
      activeTenants,
      deactivatedTenants,
      sensorCount,
      onlineSensorCount,
      offlineSensorCount,
      alertCount24h,
      unconfirmedAlerts,
      unmatchedDevEui,
      tenantsWithUnmatched,
      expiringSoon,
    }
  }, [data])

  const recentAlertsTop = useMemo(
    () => data.recentAlerts.filter((a) => !a.confirmedAt).slice(0, 10),
    [data.recentAlerts],
  )

  const unmatchedByOrgRows = useMemo(() => {
    const orgsById = new Map(data.tenants.map((t) => [t.id, t]))
    return Array.from(data.unmatchedInboxByOrg.entries())
      .map(([orgId, count]) => ({
        orgId,
        org: orgsById.get(orgId) ?? null,
        count,
      }))
      .filter((r) => r.org !== null)
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)
  }, [data.tenants, data.unmatchedInboxByOrg])

  const supportAssignmentsExpiring = useMemo(() => {
    if (!isSuperAdmin) return [] // 自分の割当てしか見えない権限なら割愛
    const assignments = loadStaffAssignments()
    const users = loadUsers()
    const orgsById = new Map(data.tenants.map((t) => [t.id, t]))
    return Object.values(assignments)
      .filter((a) => !a.revokedAt)
      .filter((a) => a.expiresAt) // 無期限は除外
      .map((a) => ({
        ...a,
        remainingDays: daysUntil(a.expiresAt),
        staff: users[a.staffUserId] ?? null,
        org: a.organizationId ? orgsById.get(a.organizationId) ?? null : null,
      }))
      .filter((a) => a.remainingDays !== null && a.remainingDays <= 14 && a.remainingDays >= -7)
      .sort((a, b) => (a.remainingDays ?? 0) - (b.remainingDays ?? 0))
      .slice(0, 10)
  }, [data.tenants, isSuperAdmin])

  /* ---- レンダー ---- */

  return (
    <div className="admin-view admin-view-wide admin-dashboard-view">
      <header className="admin-dashboard-head">
        <div>
          <h1 className="admin-view-title">
            <LayoutDashboard size={20} />
            <span>運営ダッシュボード</span>
          </h1>
          <p className="admin-view-sub">
            {isSuperAdmin
              ? '全テナント横断のサマリー。'
              : '担当テナントのサマリー（割当て済のみ集計）。'}
            {refreshedAt && (
              <span className="muted small">
                {' '}・ 最終更新 {formatDateTime(refreshedAt)}
              </span>
            )}
          </p>
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => setRefreshKey((k) => k + 1)}
          disabled={data.loading}
        >
          <RefreshCw size={14} className={data.loading ? 'is-spinning' : ''} />
          <span>更新</span>
        </button>
      </header>

      {data.error && (
        <div className="login-error" style={{ marginBottom: '1rem' }}>
          <AlertTriangle size={14} />
          <span>データ取得に失敗しました: {data.error}</span>
        </div>
      )}

      {/* ===== Stat cards ===== */}
      <div className="admin-dash-stats">
        <button
          type="button"
          className="admin-dash-stat-card admin-dash-stat-link"
          onClick={onGoTenants}
        >
          <div className="admin-dash-stat-icon">
            <Building2 size={20} />
          </div>
          <div className="admin-dash-stat-body">
            <div className="admin-dash-stat-label">テナント</div>
            <div className="admin-dash-stat-value">{stats.tenantCount}</div>
            <div className="admin-dash-stat-sub muted">
              稼働 {stats.activeTenants}
              {stats.deactivatedTenants > 0 && ` ・ 無効化 ${stats.deactivatedTenants}`}
            </div>
          </div>
          <ArrowRight size={14} className="admin-dash-stat-arrow muted" />
        </button>

        <div className="admin-dash-stat-card">
          <div className="admin-dash-stat-icon">
            <Cpu size={20} />
          </div>
          <div className="admin-dash-stat-body">
            <div className="admin-dash-stat-label">センサー</div>
            <div className="admin-dash-stat-value">{stats.sensorCount}</div>
            <div className="admin-dash-stat-sub muted">
              オンライン {stats.onlineSensorCount}
              {stats.offlineSensorCount > 0 && ` ・ オフライン ${stats.offlineSensorCount}`}
            </div>
          </div>
        </div>

        <div className="admin-dash-stat-card admin-dash-stat-alert">
          <div className="admin-dash-stat-icon">
            <AlertTriangle size={20} />
          </div>
          <div className="admin-dash-stat-body">
            <div className="admin-dash-stat-label">直近 24h アラート</div>
            <div className="admin-dash-stat-value">{stats.alertCount24h}</div>
            <div className="admin-dash-stat-sub muted">
              未確認 {stats.unconfirmedAlerts}
            </div>
          </div>
        </div>

        <div className="admin-dash-stat-card">
          <div className="admin-dash-stat-icon">
            <Webhook size={20} />
          </div>
          <div className="admin-dash-stat-body">
            <div className="admin-dash-stat-label">未登録 DevEUI</div>
            <div className="admin-dash-stat-value">{stats.unmatchedDevEui}</div>
            <div className="admin-dash-stat-sub muted">
              {stats.tenantsWithUnmatched} テナントで検出
            </div>
          </div>
        </div>
      </div>

      {/* ===== 2 カラム: アラート + 契約期限 ===== */}
      <div className="admin-dash-grid">
        {/* 発生中のアラート */}
        <section className="admin-dash-panel">
          <div className="admin-dash-panel-head">
            <h2>
              <AlertTriangle size={15} />
              <span>発生中のアラート（未確認）</span>
            </h2>
            <span className="muted small">直近 24 時間 / 上位 10 件</span>
          </div>
          {recentAlertsTop.length === 0 ? (
            <div className="admin-dash-empty muted">該当なし。</div>
          ) : (
            <ul className="admin-dash-list">
              {recentAlertsTop.map((a) => (
                <li key={a.id} className="admin-dash-list-item">
                  <span className={`alert-kind-pill alert-kind-${a.kind}`}>
                    {a.kind === 'deviation-alert'
                      ? '危険'
                      : a.kind === 'deviation-warn'
                        ? '注意'
                        : a.kind === 'offline'
                          ? 'オフライン'
                          : 'バッテリー'}
                  </span>
                  <span className="admin-dash-list-main">
                    <span className="admin-dash-list-title">
                      {a.sensorNumber || a.serialNumber}
                    </span>
                    <span className="admin-dash-list-sub muted">{a.message}</span>
                  </span>
                  <span className="admin-dash-list-time muted small">
                    {formatDateTime(a.occurredAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* 契約期限切れ近い */}
        <section className="admin-dash-panel">
          <div className="admin-dash-panel-head">
            <h2>
              <Calendar size={15} />
              <span>契約期限切れ間近</span>
            </h2>
            <span className="muted small">30 日以内</span>
          </div>
          {stats.expiringSoon.length === 0 ? (
            <div className="admin-dash-empty muted">該当なし。</div>
          ) : (
            <ul className="admin-dash-list">
              {stats.expiringSoon.map((t) => (
                <li
                  key={t.id}
                  className="admin-dash-list-item admin-dash-list-clickable"
                  onClick={() => onOpenTenant(t.id)}
                >
                  <span
                    className={`badge badge-outline ${
                      (t.remainingDays ?? 0) < 0 ? 'is-expired' : 'is-soon'
                    }`}
                  >
                    {(t.remainingDays ?? 0) < 0
                      ? `${-(t.remainingDays ?? 0)}日経過`
                      : `あと${t.remainingDays}日`}
                  </span>
                  <span className="admin-dash-list-main">
                    <span className="admin-dash-list-title">{t.name}</span>
                    <span className="admin-dash-list-sub muted">
                      契約終了 {formatDate(t.contractExpiresAt)}
                    </span>
                  </span>
                  <ArrowRight size={12} className="muted" />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* ===== 2 カラム: 未登録 DevEUI + Support 割当期限 ===== */}
      <div className="admin-dash-grid">
        <section className="admin-dash-panel">
          <div className="admin-dash-panel-head">
            <h2>
              <Webhook size={15} />
              <span>未登録 DevEUI を検出したテナント</span>
            </h2>
          </div>
          {unmatchedByOrgRows.length === 0 ? (
            <div className="admin-dash-empty muted">該当なし。</div>
          ) : (
            <ul className="admin-dash-list">
              {unmatchedByOrgRows.map((r) => (
                <li
                  key={r.orgId}
                  className="admin-dash-list-item admin-dash-list-clickable"
                  onClick={() => onOpenTenant(r.orgId)}
                >
                  <span className="admin-dash-list-badge-num">{r.count}</span>
                  <span className="admin-dash-list-main">
                    <span className="admin-dash-list-title">{r.org?.name}</span>
                    <span className="admin-dash-list-sub muted">
                      連携設定タブで登録してください
                    </span>
                  </span>
                  <ArrowRight size={12} className="muted" />
                </li>
              ))}
            </ul>
          )}
        </section>

        {isSuperAdmin && (
          <section className="admin-dash-panel">
            <div className="admin-dash-panel-head">
              <h2>
                <ShieldOff size={15} />
                <span>サポート割り当て期限切れ間近</span>
              </h2>
              <span className="muted small">14 日以内</span>
            </div>
            {supportAssignmentsExpiring.length === 0 ? (
              <div className="admin-dash-empty muted">該当なし。</div>
            ) : (
              <ul className="admin-dash-list">
                {supportAssignmentsExpiring.map((a) => (
                  <li
                    key={a.id}
                    className="admin-dash-list-item admin-dash-list-clickable"
                    onClick={() => a.org && onOpenTenant(a.org.id)}
                  >
                    <span
                      className={`badge badge-outline ${
                        (a.remainingDays ?? 0) < 0 ? 'is-expired' : 'is-soon'
                      }`}
                    >
                      {(a.remainingDays ?? 0) < 0
                        ? `${-(a.remainingDays ?? 0)}日経過`
                        : `あと${a.remainingDays}日`}
                    </span>
                    <span className="admin-dash-list-main">
                      <span className="admin-dash-list-title">
                        {a.staff?.displayName ?? '(削除済スタッフ)'}
                      </span>
                      <span className="admin-dash-list-sub muted">
                        {a.org?.name ?? '(削除済テナント)'}
                      </span>
                    </span>
                    <ArrowRight size={12} className="muted" />
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </div>
  )
}
