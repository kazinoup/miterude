/**
 * β-2: JWT(app_metadata) claim 読み取り。
 *
 * Custom Access Token Hook（custom_access_token_hook、migration 0039）が
 * アクセストークン JWT の payload.app_metadata に注入する:
 *   - app_user_id          : 内部 users.id
 *   - app_role             : super_admin | support | editor | dashboard_confirmer | guest
 *   - org_id               : tenant の active_organization_id
 *   - impersonating_org_id : 有効な impersonation_sessions があれば target org
 *
 * supabase-js の session.user.app_metadata は /auth/v1/user 由来でカスタム
 * クレームを反映しないことがあるため、access_token を自前デコードして読む。
 */
import type { Session } from '@supabase/supabase-js'

export type AppRole =
  | 'super_admin'
  | 'support'
  | 'editor'
  | 'dashboard_confirmer'
  | 'guest'

export type AppClaims = {
  appUserId: string | null
  appRole: AppRole
  orgId: string | null
  impersonatingOrgId: string | null
}

const ROLES: AppRole[] = [
  'super_admin',
  'support',
  'editor',
  'dashboard_confirmer',
  'guest',
]

const EMPTY: AppClaims = {
  appUserId: null,
  appRole: 'guest',
  orgId: null,
  impersonatingOrgId: null,
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  try {
    const part = token.split('.')[1]
    if (!part) return {}
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/')
    const json = decodeURIComponent(
      Array.prototype.map
        .call(
          atob(b64),
          (c: string) =>
            '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2),
        )
        .join(''),
    )
    return JSON.parse(json) as Record<string, unknown>
  } catch {
    return {}
  }
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

export function readAppClaims(session: Session | null): AppClaims {
  if (!session?.access_token) return EMPTY
  const payload = decodeJwtPayload(session.access_token)
  const m = (payload.app_metadata ?? {}) as Record<string, unknown>
  const rawRole = typeof m.app_role === 'string' ? m.app_role : 'guest'
  const appRole = (ROLES as string[]).includes(rawRole)
    ? (rawRole as AppRole)
    : 'guest'
  return {
    appUserId: str(m.app_user_id),
    appRole,
    orgId: str(m.org_id),
    impersonatingOrgId: str(m.impersonating_org_id),
  }
}
