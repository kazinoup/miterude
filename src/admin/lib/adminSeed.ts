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
export const DEMO_SALES_ID = 'user-sales-001'

const LEGACY_STATE_KEY = 'miterude:state:v3'
/** Phase A-5 で support スタッフのシードを追加 → v2、
 *  契約期限・決済手段・メンバーログイン項目を追加 → v3、
 *  契約種別（買取 / サブスク）と ツクルデAI 連携フラグを追加 → v4、
 *  contractType に 'demo' を追加し plan===demo を contractType===demo にマッピング → v5、
 *  staffCategory(support/sales) と請求書事前通知設定を追加 → v6。
 *  既存ユーザーの localStorage は idempotent マージ + 不足フィールドの補完のみ走るため、
 *  以前作ったテナント / メンバー / アサインメントは保持される。 */
const SEED_FLAG_KEY = 'miterude:admin:seeded:v6'

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
      staffCategory: 'support',
      createdAt: now,
    },
    {
      id: DEMO_SALES_ID,
      email: 'sales-demo@canbright.co.jp',
      displayName: '田中 営業',
      systemRole: 'support',
      staffCategory: 'sales',
      createdAt: now,
    },
  ]
}

/** 既定のテナント（demo） */
function buildDefaultOrgs(): Organization[] {
  const now = nowFloor()
  // 契約は今日開始 → 1 年後を期限の既定とする
  const contractStartedAt = new Date(now)
  const contractExpiresAt = new Date(now)
  contractExpiresAt.setFullYear(contractExpiresAt.getFullYear() + 1)
  return [
    {
      id: DEMO_ORG_ID,
      name: 'CanBright（デモ組織）',
      slug: 'canbright-demo',
      createdAt: now,
      billingCycle: 'annual',
      contractStartedAt,
      contractExpiresAt,
      paymentMethod: 'bank_transfer',
      billingEmail: 'inoue@canbright.co.jp',
      autoInvoice: true,
      contractType: 'demo',
      tsukurudeAiEnabled: false,
      preNotifyDaysBefore: 3,
      preNotifyRecipients: [
        { kind: 'staff', userId: DEMO_SALES_ID },
      ],
    },
  ]
}

/** 既定のメンバーシップ */
function buildDefaultMembers(): OrganizationMember[] {
  const now = nowFloor()
  // 招待 → 初回ログイン → 最終ログイン の典型的なタイムスタンプを擬似生成
  const invited = new Date(now)
  invited.setDate(invited.getDate() - 14)
  const firstLogin = new Date(now)
  firstLogin.setDate(firstLogin.getDate() - 12)
  const lastLogin = new Date(now)
  lastLogin.setHours(lastLogin.getHours() - 2)
  return [
    {
      id: 'member-demo-001',
      organizationId: DEMO_ORG_ID,
      userId: DEMO_SUPER_ADMIN_ID,
      role: 'editor',
      invitedAt: invited,
      firstLoginAt: firstLogin,
      lastLoginAt: lastLogin,
    },
    {
      id: 'member-demo-002',
      organizationId: DEMO_ORG_ID,
      userId: DEMO_EDITOR_ID,
      role: 'editor',
      invitedAt: invited,
      firstLoginAt: firstLogin,
      lastLoginAt: new Date(now.getTime() - 24 * 60 * 60 * 1000),
    },
    {
      id: 'member-demo-003',
      organizationId: DEMO_ORG_ID,
      userId: DEMO_CONFIRMER_ID,
      role: 'dashboard_confirmer',
      invitedAt: invited,
      // 確認者はまだ初回ログイン前を演出
      firstLoginAt: undefined,
      lastLoginAt: undefined,
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
    if (!users[u.id]) {
      users = upsertUser(users, u)
    } else {
      // v5 → v6: 既存スタッフに staffCategory が無ければ補完
      const existing = users[u.id]
      if (u.staffCategory && !existing.staffCategory) {
        users = upsertUser(users, {
          ...existing,
          staffCategory: u.staffCategory,
        })
      }
    }
  }
  saveUsers(users)

  // 2) Organizations
  let orgs = loadOrganizations()
  for (const o of buildDefaultOrgs()) {
    if (!orgs[o.id]) {
      orgs = upsertOrganization(orgs, o)
    } else {
      // v2 → v3: 契約系フィールドを補完。
      // v3 → v4: 契約種別 / ツクルデAI フラグも補完。
      // v4 → v5: 旧 plan === 'demo' は contractType === 'demo' に上書き（プラン統合）。
      const existing = orgs[o.id]
      const promoteDemo = existing.plan === 'demo'
      const merged: Organization = {
        ...existing,
        billingCycle: existing.billingCycle ?? o.billingCycle,
        contractStartedAt: existing.contractStartedAt ?? o.contractStartedAt,
        contractExpiresAt: existing.contractExpiresAt ?? o.contractExpiresAt,
        paymentMethod: existing.paymentMethod ?? o.paymentMethod,
        billingEmail: existing.billingEmail ?? o.billingEmail,
        autoInvoice: existing.autoInvoice ?? o.autoInvoice,
        contractType: promoteDemo
          ? 'demo'
          : existing.contractType ?? o.contractType,
        tsukurudeAiEnabled:
          existing.tsukurudeAiEnabled ?? o.tsukurudeAiEnabled,
        preNotifyDaysBefore:
          existing.preNotifyDaysBefore ?? o.preNotifyDaysBefore,
        preNotifyRecipients:
          existing.preNotifyRecipients ?? o.preNotifyRecipients,
      }
      // 旧 plan は今後参照しないが、互換のため値は残しておく（型は deprecated）
      orgs = upsertOrganization(orgs, merged)
    }
  }
  saveOrganizations(orgs)

  // 3) Organization members
  let members = loadOrganizationMembers()
  for (const m of buildDefaultMembers()) {
    if (!members[m.id]) {
      members = upsertOrganizationMember(members, m)
    } else {
      // v2 → v3: joinedAt 廃止に伴い、firstLoginAt / lastLoginAt が無いメンバーへ既定値を補完。
      // joinedAt が入っていた既存メンバーには、それを firstLoginAt と lastLoginAt の初期値として流用する
      // （joinedAt 自体は型から消えても、未知フィールドとして localStorage 上には残る → 触らない）。
      const existing = members[m.id] as OrganizationMember & { joinedAt?: Date | string }
      const legacyJoined = existing.joinedAt ? new Date(existing.joinedAt) : undefined
      const merged: OrganizationMember = {
        ...existing,
        firstLoginAt: existing.firstLoginAt ?? legacyJoined ?? m.firstLoginAt,
        lastLoginAt: existing.lastLoginAt ?? legacyJoined ?? m.lastLoginAt,
      }
      // joinedAt キーは型から無くなったので明示的に削除
      delete (merged as Record<string, unknown>).joinedAt
      members = upsertOrganizationMember(members, merged)
    }
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
