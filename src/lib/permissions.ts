/**
 * Phase A-3: ロールベースの UI 制御ヘルパ。
 *
 * モック期は localStorage の AuthSession + AppUser + OrganizationMember から
 * 「実効ロール」を算出し、UI 出し分けに利用する。Supabase 統合後は
 * Clerk JWT のクレームから同じ EffectiveRole を導出する想定。
 */
import type { EffectiveRole } from '../types'
import {
  loadAuthSession,
  loadOrganizationMembers,
  loadUsers,
} from '../admin/lib/adminStorage'

/** 現在のログインに対する実効ロールを算出する */
export function getEffectiveRole(): EffectiveRole {
  const session = loadAuthSession()
  if (!session) return 'guest'
  const users = loadUsers()
  const user = users[session.userId]
  if (!user) return 'guest'

  // システム横断ロールが優先（super_admin / support は全テナントを跨いで動ける）
  if (user.systemRole === 'super_admin') return 'super_admin'
  if (user.systemRole === 'support') return 'support'

  if (session.kind === 'tenant') {
    const members = loadOrganizationMembers()
    const m = Object.values(members).find(
      (x) => x.userId === user.id && x.organizationId === session.organizationId,
    )
    if (m?.role === 'editor') return 'editor'
    if (m?.role === 'dashboard_confirmer') return 'dashboard_confirmer'
  }
  return 'guest'
}

/** 編集系の操作（作成/更新/削除）が許可されているか */
export function canEdit(role: EffectiveRole): boolean {
  return role === 'super_admin' || role === 'support' || role === 'editor'
}

/** dashboard_confirmer 専用の判定（読み取り + 確認チェックインのみ） */
export function isConfirmer(role: EffectiveRole): boolean {
  return role === 'dashboard_confirmer'
}
