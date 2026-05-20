/**
 * Phase A-4: スーパーアドミン専用シェル（/admin 相当）。
 *
 * session.kind === 'admin' のときに App.tsx から呼ばれる。
 * Phase A-4 ではテナント一覧 / 作成 / 詳細のみ。
 * Phase A-5 でスタッフ管理 + impersonation、A-7 で監査ログを足す。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Building2, Users2, History, ShieldCheck, BookOpen, LayoutDashboard, Database } from 'lucide-react'
import { UserMenu } from '../components/UserMenu'
import { ContextSelectView } from '../components/ContextSelectView'
import { ToastContainer } from '../components/ToastContainer'
import { AdminTenantsView } from './views/AdminTenantsView'
import { AdminTenantDetailView } from './views/AdminTenantDetailView'
import { AdminStaffView } from './views/AdminStaffView'
import { AdminStaffDetailView } from './views/AdminStaffDetailView'
import { AdminAuditView } from './views/AdminAuditView'
import { AdminManualView } from './views/AdminManualView'
import { AdminDashboardView } from './views/AdminDashboardView'
import { AdminTestDataView } from './views/AdminTestDataView'
import {
  loadOrganizations,
  loadUsers,
  saveUsers,
  saveOrganizations,
  saveOrganizationMembers,
  saveStaffAssignments,
  saveManualCategories,
  saveManualPages,
} from './lib/adminStorage'
import type { ResolvedAuth } from '../lib/authSession'
import { globalUnmatchedDeviceCount } from './lib/webhookInbox'
import {
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
  ManualCategoryStore,
  ManualPageStore,
  OrganizationMemberStore,
  OrganizationStore,
  StaffAssignmentStore,
  UserSession,
} from '../types'

export type AdminViewKey =
  | 'dashboard'
  | 'tenants'
  | 'tenant-detail'
  | 'staff'
  | 'staff-detail'
  | 'audit'
  | 'manual'
  | 'test-data'

type Props = {
  /** 現在の認証状態（claim 由来）。kind は 'admin' 前提で App から渡される。 */
  auth: ResolvedAuth
}

export function AdminApp({ auth }: Props) {
  // β-2d-3: 権限は JWT claim（auth.appRole）で判定。
  //  super_admin: フルアクセス / support: 制限付き
  const userId = auth.appUserId ?? ''
  const isSuper = auth.appRole === 'super_admin'

  const [view, setView] = useState<AdminViewKey>('dashboard')
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
          orgsList,
          manualCatsList,
          manualPagesList,
        ] = await Promise.all([
          fetchUsersList(),
          fetchMembersList(),
          fetchStaffAssignmentsList(),
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
        // 旧モック ID（user-super-admin-001 等。UUID でない）が残っていると
        // 毎回 push 400 が返るうえ localStorage を膨らませる原因になるため、
        // UUID 形式の ID だけを残してマージ対象にする。
        const UUID_RE =
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
        const localUsers = loadUsers()
        const supabaseUserIds = new Set(usersList.map((u) => u.id))
        const mergedUsers: AppUserStore = {}
        for (const u of usersList) mergedUsers[u.id] = u
        const pushTargets: typeof usersList = []
        for (const u of Object.values(localUsers)) {
          if (!UUID_RE.test(u.id)) continue // 旧モック ID は破棄
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
        saveOrganizationMembers(memberStore)
        saveStaffAssignments(assignStore)
        // 監査ログは localStorage 容量を圧迫するため永続化しない。
        // AdminAuditView 側で Supabase から都度フェッチする。
        // 既存ユーザー向けに古い肥大エントリを一度だけ掃除。
        try {
          localStorage.removeItem('miterude:admin:audit_logs')
        } catch {
          /* noop */
        }

        // Manual は Supabase が真値で置き換え（全テナント共通コンテンツ）
        const manualCatStore: ManualCategoryStore = {}
        for (const c of manualCatsList) manualCatStore[c.id] = c
        const manualPageStore: ManualPageStore = {}
        for (const p of manualPagesList) manualPageStore[p.id] = p
        saveManualCategories(manualCatStore)
        saveManualPages(manualPageStore)

        // Phase 1.5a: hydration 完了を子ビューに通知（同タブ内では storage event が
        // 発火しないため、custom event で再評価を促す）
        window.dispatchEvent(new CustomEvent('miterude:admin-hydrated'))
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

  // 非 super_admin が /admin/staff 系・/admin/test-data に URL 直アクセスしたら
  // テナント一覧に戻す
  useEffect(() => {
    if (!isSuper && (view === 'staff' || view === 'staff-detail' || view === 'test-data')) {
      setView('tenants')
      setActiveStaffId(null)
    }
  }, [view, isSuper])

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

  /** UserMenu に渡すモック UserSession（admin 用）。
   *  staff_category に応じて表示ラベルと effectiveRole を出し分け。 */
  const userSession: UserSession = useMemo(() => {
    const users = loadUsers()
    const u = users[userId]
    const category = u?.staffCategory
    const orgLabel =
      category === 'system_admin'
        ? 'システム管理者 (/admin)'
        : category === 'sales'
          ? '営業 (/admin)'
          : category === 'support'
            ? 'サポート (/admin)'
            : 'スタッフ (/admin)'
    return {
      organizationName: orgLabel,
      userName: u?.displayName ?? '管理者',
      email: u?.email ?? '',
      effectiveRole: isSuper ? 'super_admin' : 'support',
    }
  }, [userId, isSuper])

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
            className={`admin-nav-item ${view === 'dashboard' ? 'is-active' : ''}`}
            onClick={() => setView('dashboard')}
          >
            <LayoutDashboard size={16} />
            <span>ダッシュボード</span>
          </button>
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
          {/* スタッフ一覧は super_admin のみ */}
          {isSuper && (
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
          )}
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
          {/* テストデータは super_admin 専用（seed-test-data EF も super_admin 限定） */}
          {isSuper && (
            <button
              type="button"
              className={`admin-nav-item ${view === 'test-data' ? 'is-active' : ''}`}
              onClick={() => setView('test-data')}
            >
              <Database size={16} />
              <span>テストデータ</span>
            </button>
          )}
        </nav>

        <div className="admin-sidebar-foot">
          <UserMenu
            session={userSession}
            onSwitchContext={() => setContextSelectOpen(true)}
          />
        </div>
      </aside>

      <main className="admin-main">
        {view === 'dashboard' && (
          <AdminDashboardView
            viewerUserId={userId}
            isSuperAdmin={isSuper}
            onOpenTenant={openTenantDetail}
            onGoTenants={() => {
              setView('tenants')
              setActiveTenantId(null)
            }}
          />
        )}
        {view === 'tenants' && (
          <AdminTenantsView
            onOpenTenant={openTenantDetail}
            viewerUserId={userId}
            isSuperAdmin={isSuper}
          />
        )}
        {view === 'tenant-detail' && activeTenantId && (
          <AdminTenantDetailView
            tenantId={activeTenantId}
            adminUserId={userId}
            isSuperAdmin={isSuper}
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
        {/* スタッフ一覧 / 詳細は super_admin のみ。直 URL アクセスもブロック。 */}
        {view === 'staff' && isSuper && (
          <AdminStaffView onOpenStaff={openStaffDetail} />
        )}
        {view === 'staff-detail' && activeStaffId && isSuper && (
          <AdminStaffDetailView
            staffUserId={activeStaffId}
            adminUserId={userId}
            onBack={() => {
              setView('staff')
              setActiveStaffId(null)
            }}
          />
        )}
        {view === 'audit' && (
          <AdminAuditView
            viewerUserId={userId}
            isSuperAdmin={isSuper}
          />
        )}
        {view === 'manual' && (
          <AdminManualView
            adminUserId={userId}
            isSuperAdmin={isSuper}
            activeCategoryId={manualCategoryId}
            activePageId={manualPageId}
            onSelectionChange={(catId, pageId) => {
              setManualCategoryId(catId)
              setManualPageId(pageId)
            }}
          />
        )}
        {view === 'test-data' && isSuper && <AdminTestDataView />}
      </main>

      <ToastContainer />

      {contextSelectOpen && (
        <ContextSelectView onCancel={() => setContextSelectOpen(false)} />
      )}
    </div>
  )
}
