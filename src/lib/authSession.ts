/**
 * β-2: Supabase Auth セッションの抽象レイヤ。
 *
 * 旧 localStorage AuthSession（kind: tenant/admin/impersonation）の概念を
 * JWT claim から再現し、App.tsx / AdminApp.tsx の改修を最小化する。
 *
 * - getResolvedAuth(): 現在のセッション + claim + 旧 kind 互換を返す
 * - onAuthChange(cb): supabase.auth.onAuthStateChange のラッパ
 * - signOut(): Supabase Auth サインアウト
 * - refreshClaims(): RPC（impersonation / テナント切替）後に JWT を再発行
 */
import { supabase } from './supabase'
import { readAppClaims, type AppClaims, type AppRole } from './authClaims'

export type AuthKind = 'admin' | 'tenant' | 'impersonation' | 'guest'

export type ResolvedAuth = {
  authed: boolean
  appUserId: string | null
  appRole: AppRole
  kind: AuthKind
  /** tenant: org_id / impersonation: impersonating_org_id / それ以外: null */
  activeOrgId: string | null
  claims: AppClaims
}

const GUEST: ResolvedAuth = {
  authed: false,
  appUserId: null,
  appRole: 'guest',
  kind: 'guest',
  activeOrgId: null,
  claims: {
    appUserId: null,
    appRole: 'guest',
    orgId: null,
    impersonatingOrgId: null,
  },
}

function deriveKind(c: AppClaims): AuthKind {
  if (c.appRole === 'guest') return 'guest'
  const isStaff = c.appRole === 'super_admin' || c.appRole === 'support'
  if (isStaff) return c.impersonatingOrgId ? 'impersonation' : 'admin'
  return 'tenant'
}

function resolve(
  session: Parameters<typeof readAppClaims>[0],
): ResolvedAuth {
  if (!session) return GUEST
  const claims = readAppClaims(session)
  const kind = deriveKind(claims)
  const activeOrgId =
    kind === 'impersonation'
      ? claims.impersonatingOrgId
      : kind === 'tenant'
        ? claims.orgId
        : null
  return {
    authed: true,
    appUserId: claims.appUserId,
    appRole: claims.appRole,
    kind,
    activeOrgId,
    claims,
  }
}

/** 現在のセッションを取得して解決（非同期）。 */
export async function getResolvedAuth(): Promise<ResolvedAuth> {
  const { data } = await supabase.auth.getSession()
  return resolve(data.session)
}

/** 認証状態の変化を購読。返り値の unsubscribe で解除。 */
export function onAuthChange(
  cb: (auth: ResolvedAuth) => void,
): () => void {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    cb(resolve(session))
  })
  return () => data.subscription.unsubscribe()
}

/** RPC（impersonation / テナント切替）後に JWT を再発行して claim を更新。 */
export async function refreshClaims(): Promise<ResolvedAuth> {
  const { data, error } = await supabase.auth.refreshSession()
  if (error) {
    // リフレッシュ失敗時は現行セッションのまま解決（呼び出し側で再試行）
    return getResolvedAuth()
  }
  return resolve(data.session)
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut()
}
