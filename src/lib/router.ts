/**
 * 軽量 URL ルーティング — Phase K
 *
 * 設計方針:
 * - react-router 等の依存を入れず、`history.pushState` + `popstate` のみで動かす。
 * - URL を「正規化された view state」に変換する parse 関数、その逆の build 関数を用意。
 * - 同一テナント内のページ遷移は pushState（高速）、テナント切替（slug が変わる）は
 *   full reload（hydration を毎回まっさらに走らせる）で実装する。
 *
 * URL スキーマ:
 *   /<slug>                                  → そのテナントのダッシュボード
 *   /<slug>/dashboard
 *   /<slug>/dashboard/<dashboardId>
 *   /<slug>/sensors
 *   /<slug>/sensors/<sensorId>
 *   /<slug>/gateways
 *   /<slug>/gateways/<gatewayId>
 *   /<slug>/report
 *   /<slug>/records
 *   /<slug>/alerts
 *   /<slug>/settings
 *   /<slug>/settings/<tab>
 *
 *   /admin                                   → /admin/tenants
 *   /admin/tenants
 *   /admin/tenants/<tenantId>
 *   /admin/tenants/<tenantId>/<tab>
 *   /admin/staff
 *   /admin/staff/<staffUserId>
 *   /admin/audit
 */
import type { ViewKey } from '../types'

export type TenantRouteKind = 'tenant'
export type AdminRouteKind = 'admin'

/** テナント側 view URL から復元する状態。 */
export type TenantRouteState = {
  kind: 'tenant'
  /** URL に含まれる組織スラグ。未指定なら null（ルートアクセス） */
  slug: string | null
  view: ViewKey
  activeSensorId: string | null
  activeGatewayId: string | null
  activeDashboardId: string | null
  /** Settings ページの初期タブ */
  settingsTab?: 'integrations' | 'notifications' | 'thresholds'
  /** Manual ページの選択中カテゴリ / ページ ID */
  manualCategoryId?: string | null
  manualPageId?: string | null
}

/** Admin 側 view URL から復元する状態。
 *  Phase K: テナント URL は slug ベース（`/admin/tenants/<slug>/<tab>`）。
 *  AdminApp 側で slug → tenant.id の解決を行う。 */
export type AdminRouteState = {
  kind: 'admin'
  view: 'dashboard' | 'tenants' | 'tenant-detail' | 'staff' | 'staff-detail' | 'audit' | 'manual'
  activeTenantSlug: string | null
  activeStaffId: string | null
  /** テナント詳細のタブ（contract / members / sensors / gateways / integration / audit） */
  tenantTab?: string
  /** Manual: 選択中カテゴリ / ページ */
  manualCategoryId?: string | null
  manualPageId?: string | null
}

const ADMIN_PREFIX = 'admin'

const ALL_TENANT_VIEWS: ViewKey[] = [
  'dashboard', 'sensors', 'sensor-detail', 'gateways', 'gateway-detail',
  'report', 'records', 'alerts', 'settings', 'manual',
]

function isTenantPageSegment(s: string): boolean {
  return ['dashboard', 'sensors', 'gateways', 'report', 'records', 'alerts', 'settings', 'manual'].includes(s)
}

/** pathname 文字列から TenantRouteState / AdminRouteState を組み立てる。 */
export function parsePath(pathname: string): TenantRouteState | AdminRouteState | null {
  const parts = decodeURIComponent(pathname).split('/').filter(Boolean)
  if (parts.length === 0) return null

  // Admin
  if (parts[0] === ADMIN_PREFIX) {
    if (parts.length === 1) {
      // デフォルトは新しい運営ダッシュボードへ
      return { kind: 'admin', view: 'dashboard', activeTenantSlug: null, activeStaffId: null }
    }
    const page = parts[1]
    if (page === 'dashboard') {
      return { kind: 'admin', view: 'dashboard', activeTenantSlug: null, activeStaffId: null }
    }
    if (page === 'tenants') {
      const tenantSlug = parts[2] ?? null
      const tab = parts[3]
      return {
        kind: 'admin',
        view: tenantSlug ? 'tenant-detail' : 'tenants',
        activeTenantSlug: tenantSlug,
        activeStaffId: null,
        tenantTab: tab,
      }
    }
    if (page === 'staff') {
      const staffId = parts[2] ?? null
      return {
        kind: 'admin',
        view: staffId ? 'staff-detail' : 'staff',
        activeTenantSlug: null,
        activeStaffId: staffId,
      }
    }
    if (page === 'audit') {
      return { kind: 'admin', view: 'audit', activeTenantSlug: null, activeStaffId: null }
    }
    if (page === 'manual') {
      return {
        kind: 'admin',
        view: 'manual',
        activeTenantSlug: null,
        activeStaffId: null,
        manualCategoryId: parts[2] ?? null,
        manualPageId: parts[3] ?? null,
      }
    }
    return { kind: 'admin', view: 'tenants', activeTenantSlug: null, activeStaffId: null }
  }

  // Tenant
  const slug = parts[0]
  const page = parts[1]
  const id = parts[2]

  if (!page) {
    return {
      kind: 'tenant', slug, view: 'dashboard',
      activeSensorId: null, activeGatewayId: null, activeDashboardId: null,
    }
  }
  if (page === 'dashboard') {
    return {
      kind: 'tenant', slug, view: 'dashboard',
      activeSensorId: null, activeGatewayId: null, activeDashboardId: id ?? null,
    }
  }
  if (page === 'sensors') {
    if (id) {
      return {
        kind: 'tenant', slug, view: 'sensor-detail',
        activeSensorId: id, activeGatewayId: null, activeDashboardId: null,
      }
    }
    return {
      kind: 'tenant', slug, view: 'sensors',
      activeSensorId: null, activeGatewayId: null, activeDashboardId: null,
    }
  }
  if (page === 'gateways') {
    if (id) {
      return {
        kind: 'tenant', slug, view: 'gateway-detail',
        activeSensorId: null, activeGatewayId: id, activeDashboardId: null,
      }
    }
    return {
      kind: 'tenant', slug, view: 'gateways',
      activeSensorId: null, activeGatewayId: null, activeDashboardId: null,
    }
  }
  if (page === 'report' || page === 'records' || page === 'alerts') {
    return {
      kind: 'tenant', slug, view: page as ViewKey,
      activeSensorId: null, activeGatewayId: null, activeDashboardId: null,
    }
  }
  if (page === 'settings') {
    const tab = id && ['integrations', 'notifications', 'thresholds'].includes(id)
      ? (id as 'integrations' | 'notifications' | 'thresholds')
      : undefined
    return {
      kind: 'tenant', slug, view: 'settings',
      activeSensorId: null, activeGatewayId: null, activeDashboardId: null,
      settingsTab: tab,
    }
  }
  if (page === 'manual') {
    return {
      kind: 'tenant', slug, view: 'manual',
      activeSensorId: null, activeGatewayId: null, activeDashboardId: null,
      manualCategoryId: id ?? null,
      manualPageId: parts[3] ?? null,
    }
  }

  // 不明なページ → ダッシュボードにフォールバック
  return {
    kind: 'tenant', slug, view: 'dashboard',
    activeSensorId: null, activeGatewayId: null, activeDashboardId: null,
  }
}

/** TenantRouteState を URL に戻す（slug が null なら "/" を返す）。 */
export function pathFromTenantState(s: TenantRouteState): string {
  const slug = s.slug ?? ''
  const base = slug ? `/${slug}` : ''
  switch (s.view) {
    case 'dashboard':
      return s.activeDashboardId ? `${base}/dashboard/${s.activeDashboardId}` : `${base}/dashboard`
    case 'sensors':
      return `${base}/sensors`
    case 'sensor-detail':
      return s.activeSensorId ? `${base}/sensors/${s.activeSensorId}` : `${base}/sensors`
    case 'gateways':
      return `${base}/gateways`
    case 'gateway-detail':
      return s.activeGatewayId ? `${base}/gateways/${s.activeGatewayId}` : `${base}/gateways`
    case 'report':
      return `${base}/report`
    case 'records':
      return `${base}/records`
    case 'alerts':
      return `${base}/alerts`
    case 'settings':
      return s.settingsTab ? `${base}/settings/${s.settingsTab}` : `${base}/settings`
    case 'manual':
      if (s.manualCategoryId && s.manualPageId) {
        return `${base}/manual/${s.manualCategoryId}/${s.manualPageId}`
      }
      if (s.manualCategoryId) return `${base}/manual/${s.manualCategoryId}`
      return `${base}/manual`
    default:
      return `${base}/dashboard`
  }
}

/** AdminRouteState を URL に戻す。 */
export function pathFromAdminState(s: AdminRouteState): string {
  switch (s.view) {
    case 'dashboard':
      return '/admin/dashboard'
    case 'tenants':
      return '/admin/tenants'
    case 'tenant-detail':
      if (!s.activeTenantSlug) return '/admin/tenants'
      return s.tenantTab
        ? `/admin/tenants/${s.activeTenantSlug}/${s.tenantTab}`
        : `/admin/tenants/${s.activeTenantSlug}`
    case 'staff':
      return '/admin/staff'
    case 'staff-detail':
      return s.activeStaffId ? `/admin/staff/${s.activeStaffId}` : '/admin/staff'
    case 'audit':
      return '/admin/audit'
    case 'manual':
      if (s.manualCategoryId && s.manualPageId) {
        return `/admin/manual/${s.manualCategoryId}/${s.manualPageId}`
      }
      if (s.manualCategoryId) return `/admin/manual/${s.manualCategoryId}`
      return '/admin/manual'
    default:
      return '/admin/tenants'
  }
}

/** pushState で URL を書き換え、popstate を発火させずに「ナビゲートされたよ」と知らせる。
 *  ナビ後の状態反映は呼び出し側の React state 更新でやる（双方向にループしないよう、
 *  パスが同じなら no-op）。 */
export function pushPath(path: string): void {
  if (typeof window === 'undefined') return
  if (window.location.pathname === path) return
  window.history.pushState({}, '', path)
}

/** replaceState 版（履歴を増やさない）。マウント時のクリーンアップなどに使う。 */
export function replacePath(path: string): void {
  if (typeof window === 'undefined') return
  if (window.location.pathname === path) return
  window.history.replaceState({}, '', path)
}

/** 別テナントへ移動する用。slug が変わる場合は full reload で hydration を最初からやり直す。 */
export function navigateAcrossTenants(path: string): void {
  if (typeof window === 'undefined') return
  window.location.assign(path)
}

/** popstate を購読する React hook。setState で渡された state を URL から計算しなおす責務。 */
import { useEffect, useState } from 'react'

export function useCurrentPath(): string {
  const [path, setPath] = useState<string>(
    typeof window !== 'undefined' ? window.location.pathname : '/',
  )
  useEffect(() => {
    function onPop() {
      setPath(window.location.pathname)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  return path
}

export const ALL_VIEW_KEYS = ALL_TENANT_VIEWS
export { isTenantPageSegment }
