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

export function loadOrganizations(): OrganizationStore {
  return readJson<OrganizationStore>(KEY_ORGS, {})
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

/** 短い ID 生成（モック用） */
export function newId(prefix = 'id'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`
}

/** 監査ログを 1 件記録するヘルパ（保存まで一気にやる） */
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
