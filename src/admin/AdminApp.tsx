/**
 * Phase A-4: スーパーアドミン専用シェル（/admin 相当）。
 *
 * session.kind === 'admin' のときに App.tsx から呼ばれる。
 * Phase A-4 ではテナント一覧 / 作成 / 詳細のみ。
 * Phase A-5 でスタッフ管理 + impersonation、A-7 で監査ログを足す。
 */
import { useMemo, useState } from 'react'
import { Building2, Users2, History, ShieldCheck } from 'lucide-react'
import { UserMenu } from '../components/UserMenu'
import { ContextSelectView } from '../components/ContextSelectView'
import { ToastContainer } from '../components/ToastContainer'
import { AdminTenantsView } from './views/AdminTenantsView'
import { AdminTenantDetailView } from './views/AdminTenantDetailView'
import { AdminStaffView } from './views/AdminStaffView'
import { AdminStaffDetailView } from './views/AdminStaffDetailView'
import { AdminAuditView } from './views/AdminAuditView'
import { loadUsers, loadAuthSession } from './lib/adminStorage'
import type { AuthSession, UserSession } from '../types'

export type AdminViewKey =
  | 'tenants'
  | 'tenant-detail'
  | 'staff'
  | 'staff-detail'
  | 'audit'

type Props = {
  /** 現在の admin セッション */
  session: AuthSession & { kind: 'admin' }
}

export function AdminApp({ session }: Props) {
  const [view, setView] = useState<AdminViewKey>('tenants')
  const [activeTenantId, setActiveTenantId] = useState<string | null>(null)
  const [activeStaffId, setActiveStaffId] = useState<string | null>(null)
  const [contextSelectOpen, setContextSelectOpen] = useState(false)

  /** UserMenu に渡すモック UserSession（admin 用） */
  const userSession: UserSession = useMemo(() => {
    const users = loadUsers()
    const u = users[session.userId]
    return {
      organizationName: 'スーパーアドミン (/admin)',
      userName: u?.displayName ?? '管理者',
      email: u?.email ?? '',
      effectiveRole: 'super_admin',
    }
  }, [session.userId])

  function openTenantDetail(tenantId: string) {
    setActiveTenantId(tenantId)
    setView('tenant-detail')
  }

  function openStaffDetail(userId: string) {
    setActiveStaffId(userId)
    setView('staff-detail')
  }

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-sidebar-brand">
          <ShieldCheck size={16} />
          <div className="admin-sidebar-brand-text">
            <span className="admin-sidebar-brand-name">ミテルデ</span>
            <span className="admin-sidebar-brand-sub">Admin Console</span>
          </div>
        </div>

        <nav className="admin-sidebar-nav">
          <button
            type="button"
            className={`admin-nav-item ${view === 'tenants' || view === 'tenant-detail' ? 'is-active' : ''}`}
            onClick={() => {
              setView('tenants')
              setActiveTenantId(null)
            }}
          >
            <Building2 size={16} />
            <span>テナント</span>
          </button>
          <button
            type="button"
            className={`admin-nav-item ${view === 'staff' || view === 'staff-detail' ? 'is-active' : ''}`}
            onClick={() => {
              setView('staff')
              setActiveStaffId(null)
            }}
          >
            <Users2 size={16} />
            <span>スタッフ</span>
          </button>
          <button
            type="button"
            className={`admin-nav-item ${view === 'audit' ? 'is-active' : ''}`}
            onClick={() => setView('audit')}
          >
            <History size={16} />
            <span>監査ログ</span>
          </button>
        </nav>

        <div className="admin-sidebar-foot">
          <UserMenu
            session={userSession}
            onSwitchContext={() => setContextSelectOpen(true)}
          />
        </div>
      </aside>

      <main className="admin-main">
        {view === 'tenants' && (
          <AdminTenantsView onOpenTenant={openTenantDetail} />
        )}
        {view === 'tenant-detail' && activeTenantId && (
          <AdminTenantDetailView
            tenantId={activeTenantId}
            onBack={() => {
              setView('tenants')
              setActiveTenantId(null)
            }}
          />
        )}
        {view === 'staff' && <AdminStaffView onOpenStaff={openStaffDetail} />}
        {view === 'staff-detail' && activeStaffId && (
          <AdminStaffDetailView
            staffUserId={activeStaffId}
            adminUserId={session.userId}
            onBack={() => {
              setView('staff')
              setActiveStaffId(null)
            }}
          />
        )}
        {view === 'audit' && <AdminAuditView />}
      </main>

      <ToastContainer />

      {contextSelectOpen && (
        <ContextSelectView onCancel={() => setContextSelectOpen(false)} />
      )}
    </div>
  )
}

/** App.tsx から呼べるよう、現在のセッションが admin なら kind narrow して返す */
export function loadAdminSessionOrNull(): (AuthSession & { kind: 'admin' }) | null {
  const s = loadAuthSession()
  return s?.kind === 'admin' ? s : null
}
