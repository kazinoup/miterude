/**
 * ロールベースの UI 制御ヘルパ（β-2d-3: claim ベースに移行）。
 *
 * 実効ロールは JWT claim 由来の `ResolvedAuth.appRole`（authClaims の AppRole）
 * がそのまま該当する。本モジュールは role を引数で受ける純関数のみを提供し、
 * 同期グローバル（旧 getEffectiveRole / getAdminRole = localStorage 依存）は廃止。
 * 呼び出し側は useAuth().appRole を渡す。
 */
import type { EffectiveRole } from '../types'

/** 編集系の操作（作成/更新/削除）が許可されているか */
export function canEdit(role: EffectiveRole): boolean {
  return role === 'super_admin' || role === 'support' || role === 'editor'
}

/** dashboard_confirmer 専用の判定（読み取り + 確認チェックインのみ） */
export function isConfirmer(role: EffectiveRole): boolean {
  return role === 'dashboard_confirmer'
}

/** Admin Console の権限。
 *  - 'super_admin': フルアクセス
 *  - 'support': 制限付き（割当テナントのみ + impersonation、編集不可）
 *  - null: Admin Console アクセス不可 */
export type AdminRole = 'super_admin' | 'support'

export function adminRoleFromRole(role: EffectiveRole): AdminRole | null {
  if (role === 'super_admin') return 'super_admin'
  if (role === 'support') return 'support'
  return null
}

/** super_admin のみがアクセスできる Admin Console 機能か判定 */
export function isSuperAdminOnly(role: AdminRole | null): boolean {
  return role === 'super_admin'
}
