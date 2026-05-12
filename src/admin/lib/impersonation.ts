/**
 * Phase A-5/A-6: スタッフが顧客テナント UI を「成り代わって」見るための
 * impersonation 起動・解除ヘルパ。
 *
 * - 起動: 起動前の AuthSession を localStorage に退避してから、
 *   AuthSession を kind='impersonation' で保存する。logStaffAction で
 *   監査ログ（action='impersonation_started'）を 1 行残す。
 * - 解除: 退避していた元のセッションへ戻す（無ければ admin への
 *   フォールバック）。logStaffAction で 'impersonation_ended' を残す。
 *
 * 起動・解除ともに、画面遷移はリロードで反映する（モックの簡略化）。
 */
import {
  loadAuthSession,
  logStaffAction,
  saveAuthSession,
} from './adminStorage'
import type { AuthSession } from '../../types'

/** 起動前の AuthSession を退避するキー（Phase A-6） */
const KEY_PREV_SESSION = 'miterude:auth:session:previous'

/** デフォルトの有効期限（モック）。実装では tenant 側設定で上書き可能にしたい */
const DEFAULT_DURATION_MS = 60 * 60 * 1000 // 1 時間

export function startImpersonation(params: {
  staffUserId: string
  organizationId: string
  reason: string
  durationMs?: number
  /** リロード時に開くテナント URL。未指定なら現在の URL のまま reload。 */
  redirectTo?: string
}): void {
  // Phase A-6: 起動前のセッションを退避（解除時に戻すため）
  const current = loadAuthSession()
  if (current) {
    try {
      localStorage.setItem(KEY_PREV_SESSION, JSON.stringify(current))
    } catch {
      // localStorage 書き込み失敗は致命的ではないので無視
    }
  }

  const startedAt = new Date()
  const expiresAt = new Date(
    startedAt.getTime() + (params.durationMs ?? DEFAULT_DURATION_MS),
  )
  const session: AuthSession = {
    kind: 'impersonation',
    userId: params.staffUserId,
    actingAsOrganizationId: params.organizationId,
    reason: params.reason,
    startedAt,
    expiresAt,
  }
  saveAuthSession(session)
  logStaffAction({
    staffUserId: params.staffUserId,
    organizationId: params.organizationId,
    action: 'impersonation_started',
    targetTable: 'organizations',
    targetId: params.organizationId,
    metadata: {
      reason: params.reason,
      expiresAt: expiresAt.toISOString(),
    },
  })
  // 画面状態が大きく変わるため reload で反映（テナント UI に切替）。
  // redirectTo があれば assign で URL ごと飛ばす。
  if (params.redirectTo) {
    window.location.assign(params.redirectTo)
  } else {
    window.location.reload()
  }
}

/**
 * impersonation を解除して、起動前のセッションへ戻す。
 * Phase A-6 で導入。退避が無ければ super_admin の admin セッションへフォールバック。
 *
 * @param fallbackAdminUserId 退避が無いときに admin セッションを作るための userId
 */
export function endImpersonation(fallbackAdminUserId: string): void {
  const current = loadAuthSession()
  if (current?.kind === 'impersonation') {
    logStaffAction({
      staffUserId: current.userId,
      organizationId: current.actingAsOrganizationId,
      action: 'impersonation_ended',
      targetTable: 'organizations',
      targetId: current.actingAsOrganizationId,
      metadata: {
        durationMs: Date.now() - new Date(current.startedAt).getTime(),
      },
    })
  }

  // 退避していたセッションを復元
  const prevRaw = localStorage.getItem(KEY_PREV_SESSION)
  let restored: AuthSession | null = null
  if (prevRaw) {
    try {
      restored = JSON.parse(prevRaw) as AuthSession
    } catch {
      restored = null
    }
  }
  if (restored) {
    saveAuthSession(restored)
  } else {
    saveAuthSession({ kind: 'admin', userId: fallbackAdminUserId })
  }
  localStorage.removeItem(KEY_PREV_SESSION)

  window.location.reload()
}
