/**
 * 管理者・テナント情報のシードデータと既存ストアの移行処理 — Phase A-1
 *
 * 役割:
 *  1. 初回起動時にデフォルトの users / organizations / members を投入
 *  2. 旧 miterude:state:v3（単一テナント前提）が存在すれば、
 *     miterude:tenant:demo-001:state:v4 にコピーして「demo テナント」として登録
 *  3. 認証セッションが無ければ「demo テナントに editor として入る」状態を初期値に
 */
import type {
  AppUser,
  Organization,
  OrganizationMember,
} from '../../types'
import {
  loadAuthSession,
  loadOrganizationMembers,
  loadOrganizations,
  loadUsers,
  saveAuthSession,
  saveOrganizationMembers,
  saveOrganizations,
  saveUsers,
  tenantStateKey,
  upsertOrganization,
  upsertOrganizationMember,
  upsertUser,
} from './adminStorage'

/** 既定のテナント ID（demo データ用） */
export const DEMO_ORG_ID = 'org-demo-001'
/** 既定のユーザー ID（モック既存ユーザー） */
export const DEMO_SUPER_ADMIN_ID = 'user-super-admin-001'
export const DEMO_EDITOR_ID = 'user-editor-001'
export const DEMO_CONFIRMER_ID = 'user-confirmer-001'
export const DEMO_SUPPORT_ID = 'user-support-001'

const LEGACY_STATE_KEY = 'miterude:state:v3'
/** Phase A-5 で support スタッフのシードを追加するため v2 に bump。
 *  既存ユーザーの localStorage は idempotent な if-not-exists マージのみ走るため、
 *  以前作ったテナント / メンバー / アサインメントは保持される。 */
const SEED_FLAG_KEY = 'miterude:admin:seeded:v2'

function nowFloor(): Date {
  // 日付だけ揃える（テストの差分が出にくいよう）
  const d = new Date()
  d.setSeconds(0, 0)
  return d
}

/** モック用の初期ユーザー */
function buildDefaultUsers(): AppUser[] {
  const now = nowFloor()
  return [
    {
      id: DEMO_SUPER_ADMIN_ID,
      email: 'inoue@canbright.co.jp',
      displayName: '井上 太郎',
      systemRole: 'super_admin',
      createdAt: now,
    },
    {
      id: DEMO_EDITOR_ID,
      email: 'editor-demo@example.com',
      displayName: '山田 花子',
      createdAt: now,
    },
    {
      id: DEMO_CONFIRMER_ID,
      email: 'confirmer-demo@example.com',
      displayName: '佐藤 次郎',
      createdAt: now,
    },
    {
      id: DEMO_SUPPORT_ID,
      email: 'support-demo@canbright.co.jp',
      displayName: '鈴木 サポート',
      systemRole: 'support',
      createdAt: now,
    },
  ]
}

/** 既定のテナント（demo） */
function buildDefaultOrgs(): Organization[] {
  return [
    {
      id: DEMO_ORG_ID,
      name: 'CanBright（デモ組織）',
      slug: 'canbright-demo',
      plan: 'demo',
      createdAt: nowFloor(),
    },
  ]
}

/** 既定のメンバーシップ */
function buildDefaultMembers(): OrganizationMember[] {
  const now = nowFloor()
  return [
    {
      id: 'member-demo-001',
      organizationId: DEMO_ORG_ID,
      userId: DEMO_SUPER_ADMIN_ID,
      role: 'editor',
      invitedAt: now,
      joinedAt: now,
    },
    {
      id: 'member-demo-002',
      organizationId: DEMO_ORG_ID,
      userId: DEMO_EDITOR_ID,
      role: 'editor',
      invitedAt: now,
      joinedAt: now,
    },
    {
      id: 'member-demo-003',
      organizationId: DEMO_ORG_ID,
      userId: DEMO_CONFIRMER_ID,
      role: 'dashboard_confirmer',
      invitedAt: now,
      joinedAt: now,
    },
  ]
}

/** 旧 v3 ストアが残っていれば、demo テナントの v4 ストアに移す。
 *  すでに v4 ストアが存在する場合は何もしない（上書きしない）。 */
function migrateLegacyTenantState(): void {
  try {
    const legacy = localStorage.getItem(LEGACY_STATE_KEY)
    const targetKey = tenantStateKey(DEMO_ORG_ID)
    const existingTarget = localStorage.getItem(targetKey)
    if (legacy && !existingTarget) {
      localStorage.setItem(targetKey, legacy)
      // 旧キーは安全のため残す（戻したい場合のフォールバック）
      // 必要なら後続フェーズで removeItem する
    }
  } catch (e) {
    console.warn('[miterude-admin] legacy state migration failed', e)
  }
}

/** 初回のみシードを実行 */
export function ensureSeedData(): void {
  if (localStorage.getItem(SEED_FLAG_KEY) === '1') return

  // 1) Users
  let users = loadUsers()
  for (const u of buildDefaultUsers()) {
    if (!users[u.id]) users = upsertUser(users, u)
  }
  saveUsers(users)

  // 2) Organizations
  let orgs = loadOrganizations()
  for (const o of buildDefaultOrgs()) {
    if (!orgs[o.id]) orgs = upsertOrganization(orgs, o)
  }
  saveOrganizations(orgs)

  // 3) Organization members
  let members = loadOrganizationMembers()
  for (const m of buildDefaultMembers()) {
    if (!members[m.id]) members = upsertOrganizationMember(members, m)
  }
  saveOrganizationMembers(members)

  // 4) 旧 v3 ストアを demo テナントへ
  migrateLegacyTenantState()

  // 5) セッション既定値
  if (!loadAuthSession()) {
    saveAuthSession({
      kind: 'tenant',
      userId: DEMO_SUPER_ADMIN_ID,
      organizationId: DEMO_ORG_ID,
    })
  }

  localStorage.setItem(SEED_FLAG_KEY, '1')
}

/** 開発時に強制的にシードをリセットしたい場合用（Console から呼ぶ） */
export function resetAdminMockData(): void {
  localStorage.removeItem(SEED_FLAG_KEY)
  localStorage.removeItem('miterude:admin:users')
  localStorage.removeItem('miterude:admin:organizations')
  localStorage.removeItem('miterude:admin:organization_members')
  localStorage.removeItem('miterude:admin:staff_assignments')
  localStorage.removeItem('miterude:admin:audit_logs')
  localStorage.removeItem('miterude:auth:session')
}
