/**
 * 管理者・テナント横断のメタ情報を保持する localStorage レイヤ — Phase A-1
 *
 * Supabase 移行前提の概念モデル（docs/database-schema.md 参照）を
 * モックでも使えるよう、最低限のストアと CRUD ヘルパを提供する。
 *
 * 取り扱うエンティティ:
 *  - users（全ユーザー、systemRole 含む）
 *  - organizations（テナント）
 *  - organization_members（多対多）
 *  - staff_assignments（サポート割当）
 *  - staff_audit_logs（監査）
 *  - auth_session（現在のログインセッション）
 *
 * 業務データ（センサー / ダッシュボード等）はテナント別に
 *   miterude:tenant:<orgId>:state:v4 として別ストアに保存する。
 */
import type {
  AppUser,
  AppUserStore,
  AuthSession,
  ManualCategory,
  ManualCategoryStore,
  ManualPage,
  ManualPageStore,
  Organization,
  OrganizationMember,
  OrganizationMemberStore,
  OrganizationStore,
  StaffAssignment,
  StaffAssignmentStore,
  StaffAuditLog,
  StaffAuditLogStore,
} from '../../types'

const KEY_USERS = 'miterude:admin:users'
const KEY_ORGS = 'miterude:admin:organizations'
const KEY_MEMBERS = 'miterude:admin:organization_members'
const KEY_ASSIGNMENTS = 'miterude:admin:staff_assignments'
const KEY_AUDIT = 'miterude:admin:audit_logs'
const KEY_SESSION = 'miterude:auth:session'
const KEY_MANUAL_CATEGORIES = 'miterude:admin:manual_categories'
const KEY_MANUAL_PAGES = 'miterude:admin:manual_pages'

/* ---------- 共通 JSON 化ヘルパ ---------- */

const DATE_MARKER = '__d'

function replacer(_k: string, v: unknown): unknown {
  if (v instanceof Date) return { [DATE_MARKER]: v.toISOString() }
  return v
}

function reviver(_k: string, v: unknown): unknown {
  if (
    v &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    DATE_MARKER in v &&
    Object.keys(v as object).length === 1
  ) {
    const iso = (v as Record<string, unknown>)[DATE_MARKER]
    if (typeof iso === 'string') return new Date(iso)
  }
  return v
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw, reviver) as T
  } catch {
    return fallback
  }
}

/** localStorage quota 超過時に犠牲にできるキー（古い順に削除）。
 *  audit_logs が最も肥大しやすいので最優先で落とす。 */
const EVICTABLE_KEYS = [
  'miterude:admin:audit_logs',
  // 必要なら redownload で復元できるキャッシュ系。順番は重要度の低い順。
  'miterude:admin:manual_pages',
  'miterude:admin:manual_categories',
  'miterude:admin:staff_assignments',
  'miterude:admin:organization_members',
]

function isQuotaError(e: unknown): boolean {
  if (!(e instanceof Error)) return false
  return (
    e.name === 'QuotaExceededError' ||
    e.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    /quota/i.test(e.message)
  )
}

function writeJson<T>(key: string, value: T): void {
  const json = JSON.stringify(value, replacer)
  try {
    localStorage.setItem(key, json)
    return
  } catch (e) {
    if (!isQuotaError(e)) {
      console.warn('[miterude-admin] write failed:', key, e)
      return
    }
    // quota 超過: 犠牲キーを 1 つずつ落としてリトライ
    for (const evict of EVICTABLE_KEYS) {
      if (evict === key) continue
      try {
        localStorage.removeItem(evict)
      } catch {
        /* noop */
      }
      try {
        localStorage.setItem(key, json)
        console.warn(
          `[miterude-admin] quota recovered by evicting ${evict}, key=${key}`,
        )
        return
      } catch (e2) {
        if (!isQuotaError(e2)) {
          console.warn('[miterude-admin] write failed after eviction:', key, e2)
          return
        }
      }
    }
    console.warn('[miterude-admin] write failed (quota, unrecoverable):', key)
  }
}

/* ---------- Users ---------- */

export function loadUsers(): AppUserStore {
  return readJson<AppUserStore>(KEY_USERS, {})
}

export function saveUsers(store: AppUserStore): void {
  writeJson(KEY_USERS, store)
}

export function upsertUser(store: AppUserStore, user: AppUser): AppUserStore {
  return { ...store, [user.id]: user }
}

/* ---------- Organizations ---------- */

/** JSON 経由で string になっている可能性のあるフィールドを Date に戻す。 */
function reviveOrgDates(o: Organization): Organization {
  const toDate = (v: unknown): Date | undefined => {
    if (!v) return undefined
    if (v instanceof Date) return v
    if (typeof v === 'string') {
      const d = new Date(v)
      return Number.isNaN(d.getTime()) ? undefined : d
    }
    return undefined
  }
  return {
    ...o,
    createdAt: toDate(o.createdAt) ?? new Date(),
    contractStartedAt: toDate(o.contractStartedAt),
    contractExpiresAt: toDate(o.contractExpiresAt),
    deactivatedAt: toDate(o.deactivatedAt),
    physicalDeleteAfter: toDate(o.physicalDeleteAfter),
    migrationMode: o.migrationMode
      ? {
          startedAt: toDate(o.migrationMode.startedAt) ?? new Date(),
          finishedAt: toDate(o.migrationMode.finishedAt),
        }
      : undefined,
  }
}

export function loadOrganizations(): OrganizationStore {
  const raw = readJson<OrganizationStore>(KEY_ORGS, {})
  const out: OrganizationStore = {}
  for (const [id, o] of Object.entries(raw)) {
    out[id] = reviveOrgDates(o as Organization)
  }
  return out
}

export function saveOrganizations(store: OrganizationStore): void {
  writeJson(KEY_ORGS, store)
}

export function upsertOrganization(
  store: OrganizationStore,
  org: Organization,
): OrganizationStore {
  return { ...store, [org.id]: org }
}

/* ---------- Organization Members ---------- */

export function loadOrganizationMembers(): OrganizationMemberStore {
  return readJson<OrganizationMemberStore>(KEY_MEMBERS, {})
}

export function saveOrganizationMembers(store: OrganizationMemberStore): void {
  writeJson(KEY_MEMBERS, store)
}

export function upsertOrganizationMember(
  store: OrganizationMemberStore,
  m: OrganizationMember,
): OrganizationMemberStore {
  return { ...store, [m.id]: m }
}

/** ユーザーが所属する組織メンバーシップを返す。 */
export function membershipsOfUser(
  store: OrganizationMemberStore,
  userId: string,
): OrganizationMember[] {
  return Object.values(store).filter((m) => m.userId === userId)
}

/* ---------- Staff Assignments ---------- */

export function loadStaffAssignments(): StaffAssignmentStore {
  return readJson<StaffAssignmentStore>(KEY_ASSIGNMENTS, {})
}

export function saveStaffAssignments(store: StaffAssignmentStore): void {
  writeJson(KEY_ASSIGNMENTS, store)
}

export function upsertStaffAssignment(
  store: StaffAssignmentStore,
  a: StaffAssignment,
): StaffAssignmentStore {
  return { ...store, [a.id]: a }
}

/** 有効なアサインメントだけ抽出（revokedAt なし、expiresAt 未来 or null） */
export function activeAssignmentsOfStaff(
  store: StaffAssignmentStore,
  staffUserId: string,
  now: Date = new Date(),
): StaffAssignment[] {
  return Object.values(store).filter((a) => {
    if (a.staffUserId !== staffUserId) return false
    if (a.revokedAt) return false
    if (a.expiresAt && a.expiresAt.getTime() <= now.getTime()) return false
    return true
  })
}

/* ---------- Staff Audit Logs ---------- */

/** 監査ログは localStorage には保持しない（容量逼迫の原因になるため）。
 *  AdminAuditView は Supabase から都度フェッチ（fetchAuditLogsList）する前提。
 *  互換のためのスタブ。 */
export function loadAuditLogs(): StaffAuditLogStore {
  return {}
}

/** 監査ログは localStorage に書き込まない（no-op）。
 *  - 書き込みが必要なときは appendAuditLogInSupabase 経由で Supabase に直接書く。
 *  - 旧データの掃除は AdminApp ハイドレーションで removeItem 実行済み。 */
export function saveAuditLogs(_store: StaffAuditLogStore): void {
  // 念のためレガシーキーの掃除
  try {
    localStorage.removeItem(KEY_AUDIT)
  } catch {
    /* noop */
  }
}

export function appendAuditLog(
  store: StaffAuditLogStore,
  entry: StaffAuditLog,
): StaffAuditLogStore {
  return { ...store, [entry.id]: entry }
}

/** ID 生成。Supabase の uuid カラムと整合させるため UUID で採番する。
 *  prefix 引数は呼び出し側互換のため残しているが利用しない。 */
export function newId(_prefix = 'id'): string {
  return crypto.randomUUID()
}

/** 監査ログを 1 件記録するヘルパ。
 *  - localStorage には書かない（容量保全のため）。
 *  - Supabase に fire-and-forget で書き込む。失敗しても本体動作には影響させない。 */
export function logStaffAction(params: {
  staffUserId: string
  organizationId?: string
  action: string
  targetTable?: string
  targetId?: string
  metadata?: Record<string, unknown>
}): void {
  const entry: StaffAuditLog = {
    id: newId('al'),
    staffUserId: params.staffUserId,
    organizationId: params.organizationId,
    action: params.action,
    targetTable: params.targetTable,
    targetId: params.targetId,
    metadata: params.metadata,
    occurredAt: new Date(),
  }

  void (async () => {
    try {
      const supabaseModule = await import('../../lib/supabaseQueries')
      const supabaseRoot = await import('../../lib/supabase')
      if (!supabaseRoot.isSupabaseConfigured()) return
      await supabaseModule.appendAuditLogInSupabase(entry)
    } catch (e) {
      console.warn('[audit-log] supabase write failed', e)
    }
  })()
}

/* ---------- Auth Session ---------- */

export function loadAuthSession(): AuthSession {
  return readJson<AuthSession>(KEY_SESSION, null)
}

export function saveAuthSession(session: AuthSession): void {
  if (session === null) {
    localStorage.removeItem(KEY_SESSION)
    return
  }
  const json = JSON.stringify(session, replacer)

  // Step 1: 通常の setItem
  try {
    localStorage.setItem(KEY_SESSION, json)
    return
  } catch (e) {
    if (!isQuotaError(e)) {
      console.error('[miterude-admin] saveAuthSession failed (non-quota):', e)
      return
    }
  }

  // Step 2: EVICTABLE_KEYS を全部削除して再試行
  for (const k of EVICTABLE_KEYS) {
    try {
      localStorage.removeItem(k)
    } catch {
      /* noop */
    }
  }
  try {
    localStorage.setItem(KEY_SESSION, json)
    console.warn(
      '[miterude-admin] saveAuthSession recovered by evicting EVICTABLE_KEYS',
    )
    return
  } catch (e) {
    if (!isQuotaError(e)) {
      console.error('[miterude-admin] saveAuthSession failed after evict:', e)
      return
    }
  }

  // Step 3: 最終手段 — session 以外の miterude: プレフィックス全削除
  // （impersonation を絶対に通すため。テナント業務データも消えうるが、
  //  どのみち再ハイドレーションで戻る or サインアウト相当）
  const toDelete: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (!k) continue
    if (k === KEY_SESSION) continue
    if (k.startsWith('miterude:')) toDelete.push(k)
  }
  for (const k of toDelete) {
    try {
      localStorage.removeItem(k)
    } catch {
      /* noop */
    }
  }
  try {
    localStorage.setItem(KEY_SESSION, json)
    console.warn(
      `[miterude-admin] saveAuthSession recovered by clearing ${toDelete.length} miterude:* keys`,
    )
    return
  } catch (e) {
    console.error('[miterude-admin] saveAuthSession ultimately failed:', e)
  }
}

/** ストレージキー名のテナントスコープ版。
 *  miterude:tenant:<orgId>:state:v4 を返す。
 *  既存の miterude:state:v3 はマイグレーションで demo テナントに移行する。 */
export function tenantStateKey(organizationId: string): string {
  return `miterude:tenant:${organizationId}:state:v4`
}

/* ---------- Manual Categories ---------- */

function reviveManualCategory(c: ManualCategory): ManualCategory {
  return {
    ...c,
    updatedAt:
      c.updatedAt instanceof Date
        ? c.updatedAt
        : new Date(c.updatedAt as unknown as string),
  }
}

export function loadManualCategories(): ManualCategoryStore {
  const raw = readJson<ManualCategoryStore>(KEY_MANUAL_CATEGORIES, {})
  const out: ManualCategoryStore = {}
  for (const [id, c] of Object.entries(raw)) {
    out[id] = reviveManualCategory(c as ManualCategory)
  }
  return out
}

export function saveManualCategories(store: ManualCategoryStore): void {
  writeJson(KEY_MANUAL_CATEGORIES, store)
  // 同一ウィンドウ内の購読者（AdminManualView / ManualView）に変更を伝える
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('miterude:manual-changed'))
  }
}

export function upsertManualCategory(
  store: ManualCategoryStore,
  c: ManualCategory,
): ManualCategoryStore {
  return { ...store, [c.id]: c }
}

export function deleteManualCategory(
  store: ManualCategoryStore,
  id: string,
): ManualCategoryStore {
  const out = { ...store }
  delete out[id]
  return out
}

/* ---------- Manual Pages ---------- */

function reviveManualPage(p: ManualPage): ManualPage {
  return {
    ...p,
    updatedAt:
      p.updatedAt instanceof Date
        ? p.updatedAt
        : new Date(p.updatedAt as unknown as string),
  }
}

export function loadManualPages(): ManualPageStore {
  const raw = readJson<ManualPageStore>(KEY_MANUAL_PAGES, {})
  const out: ManualPageStore = {}
  for (const [id, p] of Object.entries(raw)) {
    out[id] = reviveManualPage(p as ManualPage)
  }
  return out
}

export function saveManualPages(store: ManualPageStore): void {
  writeJson(KEY_MANUAL_PAGES, store)
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('miterude:manual-changed'))
  }
}

export function upsertManualPage(
  store: ManualPageStore,
  p: ManualPage,
): ManualPageStore {
  return { ...store, [p.id]: p }
}

export function deleteManualPage(
  store: ManualPageStore,
  id: string,
): ManualPageStore {
  const out = { ...store }
  delete out[id]
  return out
}

/** 指定カテゴリ配下のページを sortOrder 昇順で返す */
export function pagesInCategory(
  store: ManualPageStore,
  categoryId: string,
): ManualPage[] {
  return Object.values(store)
    .filter((p) => p.categoryId === categoryId)
    .sort((a, b) => a.sortOrder - b.sortOrder)
}

/** カテゴリを sortOrder 昇順で返す */
export function sortedCategories(store: ManualCategoryStore): ManualCategory[] {
  return Object.values(store).sort((a, b) => a.sortOrder - b.sortOrder)
}
