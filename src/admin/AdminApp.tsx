/**
 * Phase A-4: スーパーアドミン専用シェル（/admin 相当）。
 *
 * session.kind === 'admin' のときに App.tsx から呼ばれる。
 * Phase A-4 ではテナント一覧 / 作成 / 詳細のみ。
 * Phase A-5 でスタッフ管理 + impersonation、A-7 で監査ログを足す。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Building2, Users2, History, ShieldCheck, BookOpen } from 'lucide-react'
import { UserMenu } from '../components/UserMenu'
import { ContextSelectView } from '../components/ContextSelectView'
import { ToastContainer } from '../components/ToastContainer'
import { AdminTenantsView } from './views/AdminTenantsView'
import { AdminTenantDetailView } from './views/AdminTenantDetailView'
import { AdminStaffView } from './views/AdminStaffView'
import { AdminStaffDetailView } from './views/AdminStaffDetailView'
import { AdminAuditView } from './views/AdminAuditView'
import { AdminManualView } from './views/AdminManualView'
import {
  loadOrganizations,
  loadUsers,
  loadAuthSession,
  saveUsers,
  saveOrganizations,
  saveOrganizationMembers,
  saveStaffAssignments,
  saveAuditLogs,
  saveManualCategories,
  saveManualPages,
} from './lib/adminStorage'
import { globalUnmatchedDeviceCount } from './lib/webhookInbox'
import {
  fetchAuditLogsList,
  fetchManualCategoriesList,
  fetchManualPagesList,
  fetchMembersList,
  fetchOrganizationsList,
  fetchStaffAssignmentsList,
  fetchUsersList,
} from '../lib/supabaseQueries'
import { isSupabaseConfigured } from '../lib/supabase'
import {
  parsePath,
  pathFromAdminState,
  pushPath,
  replacePath,
  useCurrentPath,
} from '../lib/router'
import type {
  AppUserStore,
  AuthSession,
  ManualCategoryStore,
  ManualPageStore,
  OrganizationMemberStore,
  OrganizationStore,
  StaffAssignmentStore,
  StaffAuditLogStore,
  UserSession,
} from '../types'

export type AdminViewKey =
  | 'tenants'
  | 'tenant-detail'
  | 'staff'
  | 'staff-detail'
  | 'audit'
  | 'manual'

type Props = {
  /** 現在の admin セッション */
  session: AuthSession & { kind: 'admin' }
}

export function AdminApp({ session }: Props) {
  const [view, setView] = useState<AdminViewKey>('tenants')
  const [activeTenantId, setActiveTenantId] = useState<string | null>(null)
  const [activeStaffId, setActiveStaffId] = useState<string | null>(null)
  const [contextSelectOpen, setContextSelectOpen] = useState(false)
  // テナント詳細のタブ（contract/members/sensors/gateways/integration/audit）
  const [tenantTab, setTenantTab] = useState<string | undefined>(undefined)
  // マニュアル: 選択中カテゴリ / ページ
  const [manualCategoryId, setManualCategoryId] = useState<string | null>(null)
  const [manualPageId, setManualPageId] = useState<string | null>(null)
  // organizations が Supabase からハイドレートされたか（URL slug → id 解決のため）
  const [orgsHydrated, setOrgsHydrated] = useState(false)

  /** サイドバー「テナント」項目の未登録 DevEUI バッジ用カウンタ。
   *  本番では Realtime / SWR で push 更新する想定。モックでは
   *  画面遷移ごとに recount する + storage event でも更新する。 */
  const [unmatchedCount, setUnmatchedCount] = useState<number>(() =>
    globalUnmatchedDeviceCount(),
  )

  useEffect(() => {
    // 別タブで操作されたとき（webhook_inbox 更新）に追従
    function onStorage(e: StorageEvent) {
      if (e.key === 'miterude:admin:webhook_inbox') {
        setUnmatchedCount(globalUnmatchedDeviceCount())
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  // Admin Console 用ハイドレーション。
  // users はマージ方式（localStorage に居て Supabase に居ない admin ユーザーは
  //   その admin の seed なので残し、ついでに Supabase 側に push もする）。
  // members / assignments / audit logs は Supabase が真値で置き換える。
  useEffect(() => {
    if (!isSupabaseConfigured()) return
    let cancelled = false
    ;(async () => {
      try {
        const [
          usersList,
          membersList,
          assignList,
          auditList,
          orgsList,
          manualCatsList,
          manualPagesList,
        ] = await Promise.all([
          fetchUsersList(),
          fetchMembersList(),
          fetchStaffAssignmentsList(),
          fetchAuditLogsList({ limit: 1000 }),
          fetchOrganizationsList(),
          fetchManualCategoriesList().catch(() => [] as ManualCategoryStore[keyof ManualCategoryStore][]),
          fetchManualPagesList().catch(() => [] as ManualPageStore[keyof ManualPageStore][]),
        ])
        if (cancelled) return

        // organizations: Supabase が真値で置き換え（admin が複数テナントを横断するため）
        const orgsStore: OrganizationStore = {}
        for (const o of orgsList) orgsStore[o.id] = o
        saveOrganizations(orgsStore)
        setOrgsHydrated(true)

        // users: マージ + ローカル限定ユーザーを Supabase に push
        const localUsers = loadUsers()
        const supabaseUserIds = new Set(usersList.map((u) => u.id))
        const mergedUsers: AppUserStore = {}
        for (const u of usersList) mergedUsers[u.id] = u
        const pushTargets: typeof usersList = []
        for (const u of Object.values(localUsers)) {
          if (!supabaseUserIds.has(u.id)) {
            mergedUsers[u.id] = u
            pushTargets.push(u)
          }
        }
        saveUsers(mergedUsers)
        if (pushTargets.length > 0) {
          const { upsertUserInSupabase } = await import('../lib/supabaseQueries')
          for (const u of pushTargets) {
            await upsertUserInSupabase(u).catch((e) =>
              console.warn('[admin-hydration] push user failed', u.id, e),
            )
          }
        }

        const memberStore: OrganizationMemberStore = {}
        for (const m of membersList) memberStore[m.id] = m
        const assignStore: StaffAssignmentStore = {}
        for (const a of assignList) assignStore[a.id] = a
        const auditStore: StaffAuditLogStore = {}
        for (const l of auditList) auditStore[l.id] = l
        saveOrganizationMembers(memberStore)
        saveStaffAssignments(assignStore)
        saveAuditLogs(auditStore)

        // Manual は Supabase が真値で置き換え（全テナント共通コンテンツ）
        const manualCatStore: ManualCategoryStore = {}
        for (const c of manualCatsList) manualCatStore[c.id] = c
        const manualPageStore: ManualPageStore = {}
        for (const p of manualPagesList) manualPageStore[p.id] = p
        saveManualCategories(manualCatStore)
        saveManualPages(manualPageStore)
      } catch (e) {
        console.warn('[admin-hydration] failed', e)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // view / tenantId が変わるたびに recount
  useEffect(() => {
    setUnmatchedCount(globalUnmatchedDeviceCount())
  }, [view, activeTenantId])

  /* ---------------- Phase K: URL <-> view state 同期 ----------------
   * テナント URL は slug ベース。slug ↔ tenant.id の解決は localStorage の
   * organizations を見て行う（AdminTenantsView のハイドレーションで先に
   * Supabase から取り込まれている）。 */
  const currentPath = useCurrentPath()
  const initialUrlAppliedRef = useRef(false)

  function tenantSlugById(id: string | null): string | null {
    if (!id) return null
    const orgs = loadOrganizations()
    return orgs[id]?.slug ?? null
  }

  function tenantIdBySlug(slug: string | null): string | null {
    if (!slug) return null
    const orgs = loadOrganizations()
    const found = Object.values(orgs).find((o) => o.slug === slug)
    return found?.id ?? null
  }

  // popstate / マウント時: URL → state
  // URL に slug があるのに orgs がまだロードされていない場合は、ハイドレート完了まで
  // 待ってから tenantIdBySlug を呼ぶ（早すぎる解決で activeTenantId=null になり、
  // 直後の state→URL effect で URL が /admin/tenants に書き換わるのを防ぐ）。
  useEffect(() => {
    const parsed = parsePath(currentPath)
    if (!parsed || parsed.kind !== 'admin') return
    // slug が必要なのに orgs 未ハイドレートなら一旦スキップ（次の orgsHydrated 変化で再実行）
    if (parsed.activeTenantSlug && !orgsHydrated && Object.keys(loadOrganizations()).length === 0) {
      return
    }
    setView(parsed.view)
    setActiveTenantId(tenantIdBySlug(parsed.activeTenantSlug))
    setActiveStaffId(parsed.activeStaffId)
    setTenantTab(parsed.tenantTab)
    setManualCategoryId(parsed.manualCategoryId ?? null)
    setManualPageId(parsed.manualPageId ?? null)
    initialUrlAppliedRef.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPath, orgsHydrated])

  // state → URL
  useEffect(() => {
    if (!initialUrlAppliedRef.current) return
    const next = pathFromAdminState({
      kind: 'admin',
      view,
      activeTenantSlug: tenantSlugById(activeTenantId),
      activeStaffId,
      tenantTab,
      manualCategoryId,
      manualPageId,
    })
    pushPath(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, activeTenantId, activeStaffId, tenantTab, manualCategoryId, manualPageId])

  // 初回マウント: URL を正規化（例: /admin → /admin/tenants）
  useEffect(() => {
    const parsed = parsePath(window.location.pathname)
    if (parsed && parsed.kind === 'admin') return
    replacePath(
      pathFromAdminState({
        kind: 'admin',
        view: 'tenants',
        activeTenantSlug: null,
        activeStaffId: null,
      }),
    )
  }, [])

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
          <div className="admin-sidebar-brand-line">
            <ShieldCheck size={16} />
            <span className="admin-sidebar-brand-name">ミテルデ</span>
          </div>
          <div className="admin-sidebar-brand-sub">Admin Console</div>
        </div>

        <nav className="admin-sidebar-nav">
          <button
            type="button"
            className={`admin-nav-item ${view === 'tenants' || view === 'tenant-detail' ? 'is-active' : ''}`}
            onClick={() => {
              setView('tenants')
              setActiveTenantId(null)
            }}
            title={
              unmatchedCount > 0
                ? `${unmatchedCount} 件のテナントで未登録 DevEUI が観測されています`
                : undefined
            }
          >
            <Building2 size={16} />
            <span>テナント</span>
            {unmatchedCount > 0 && (
              <span
                className="admin-nav-badge"
                aria-label={`未登録 DevEUI ${unmatchedCount} 件`}
              >
                {unmatchedCount}
              </span>
            )}
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
          <button
            type="button"
            className={`admin-nav-item ${view === 'manual' ? 'is-active' : ''}`}
            onClick={() => {
              setView('manual')
              setManualCategoryId(null)
              setManualPageId(null)
            }}
          >
            <BookOpen size={16} />
            <span>マニュアル</span>
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
            adminUserId={session.userId}
            initialTab={tenantTab}
            onTabChange={setTenantTab}
            onBack={() => {
              setView('tenants')
              setActiveTenantId(null)
              setTenantTab(undefined)
            }}
            onTenantStateChanged={() =>
              setUnmatchedCount(globalUnmatchedDeviceCount())
            }
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
        {view === 'manual' && (
          <AdminManualView
            adminUserId={session.userId}
            activeCategoryId={manualCategoryId}
            activePageId={manualPageId}
            onSelectionChange={(catId, pageId) => {
              setManualCategoryId(catId)
              setManualPageId(pageId)
            }}
          />
        )}
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
