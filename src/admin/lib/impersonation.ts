/**
 * スタッフが顧客テナント UI を「成り代わって」見る impersonation
 * 起動・解除ヘルパ（β-2d-3: RPC + JWT claim ベースに移行）。
 *
 * - 起動: RPC start_impersonation（SECURITY DEFINER。auth.uid()→users で
 *   super_admin/support を検証、support は staff_assignments 必須、
 *   impersonation_sessions に行を作り staff_audit_logs に記録）。その後
 *   refreshClaims() で JWT に impersonating_org_id を載せ直し、画面遷移。
 * - 解除: RPC end_impersonation（自分の有効セッションを ended_at）。
 *   refreshClaims() 後リロード。
 *
 * localStorage 退避や logStaffAction（フロント記録）は全廃。監査は RPC 内。
 */
import { supabase } from '../../lib/supabase'
import { refreshClaims } from '../../lib/authSession'

export async function startImpersonation(params: {
  organizationId: string
  reason: string
  durationMinutes?: number
  /** リロード時に開くテナント URL。未指定なら現在の URL のまま reload。 */
  redirectTo?: string
}): Promise<void> {
  const { error } = await supabase.rpc('start_impersonation', {
    p_target_org: params.organizationId,
    p_reason: params.reason,
    p_duration_minutes: params.durationMinutes ?? 60,
  })
  if (error) {
    console.error('[impersonation] start failed', error)
    throw new Error(error.message)
  }
  // JWT に impersonating_org_id を反映（reload 後 getSession が新 claim を読む）
  await refreshClaims()
  if (params.redirectTo) {
    window.location.assign(params.redirectTo)
  } else {
    window.location.reload()
  }
}

export async function endImpersonation(): Promise<void> {
  const { error } = await supabase.rpc('end_impersonation')
  if (error) {
    console.error('[impersonation] end failed', error)
    throw new Error(error.message)
  }
  await refreshClaims()
  window.location.reload()
}
