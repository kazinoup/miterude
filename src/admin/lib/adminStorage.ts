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

function writeJson<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value, replacer))
  } catch (e) {
    console.warn('[miterude-admin] write failed:', key, e)
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

export function loadAuditLogs(): StaffAuditLogStore {
  return readJson<StaffAuditLogStore>(KEY_AUDIT, {})
}

export function saveAuditLogs(store: StaffAuditLogStore): void {
  writeJson(KEY_AUDIT, store)
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

/** 監査ログを 1 件記録するヘルパ（保存まで一気にやる）。
 *  Supabase が設定されていれば fire-and-forget で Supabase 側にも書き込む。 */
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
  const store = loadAuditLogs()
  saveAuditLogs(appendAuditLog(store, entry))

  // Supabase 同期は fire-and-forget。失敗しても本体動作には影響させない。
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
  writeJson(KEY_SESSION, session)
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
