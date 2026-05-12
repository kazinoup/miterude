/**
 * Phase 1.5a: モック認証ログイン画面 (/login)
 *
 * - email + password を mock-login Edge Function に投げて検証
 * - super_admin / support / sales: パスワード必須（共有: "Canbright0987"）
 * - tenant ユーザー: パスワード何でも OK
 * - デモログインチップで editor / dashboard_confirmer をワンクリック認証
 *
 * Clerk 統合時にこの画面ごと Clerk の SignIn コンポーネントに差し替える。
 */
import { useState } from 'react'
import { LogIn, UserCircle2, ShieldCheck, AlertCircle } from 'lucide-react'
import { saveAuthSession } from '../../admin/lib/adminStorage'
import type { AuthSession } from '../../types'

type ApiUser = {
  id: string
  email: string
  display_name: string
  clerk_user_id: string | null
  system_role: 'super_admin' | 'support' | null
  staff_category: 'system_admin' | 'support' | 'sales' | null
}
type ApiMembership = {
  organization_id: string
  role: 'editor' | 'dashboard_confirmer'
}
type ApiSuccess = { ok: true; user: ApiUser; memberships: ApiMembership[] }
type ApiError = { ok: false; error: string }
type ApiResponse = ApiSuccess | ApiError

const ERROR_LABELS: Record<string, string> = {
  'user-not-found': '該当ユーザーが見つかりません。管理者に連絡してください。',
  'invalid-password': 'パスワードが違います。',
  'password-required': 'パスワードを入力してください。',
  'no-password-set': 'このアカウントはまだパスワードが設定されていません。',
  'email-required': 'メールアドレスを入力してください。',
  'invalid-body': 'リクエストが不正です。',
  'lookup-failed': 'サーバーエラーが発生しました。時間を置いて再度お試しください。',
  'method-not-allowed': '内部エラー: メソッドが許可されていません。',
  'no-supabase-url':
    'Supabase の URL が設定されていません。Vercel の環境変数 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY を確認してください。',
  'network-error': 'サーバーに接続できませんでした。ネットワークを確認してください。',
}

async function callMockLogin(email: string, password: string): Promise<ApiResponse> {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
  if (!url) {
    return { ok: false, error: 'no-supabase-url' }
  }
  try {
    const res = await fetch(`${url}/functions/v1/mock-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    const body = (await res.json()) as ApiResponse
    return body
  } catch (e) {
    console.error('[login] fetch failed', e)
    return { ok: false, error: 'network-error' }
  }
}

/** API 応答を AuthSession に変換し、localStorage に保存 + 遷移先を返す */
function applyLoginResult(api: ApiSuccess): { redirectTo: string } {
  const u = api.user
  // 内部スタッフ (super_admin / support / sales)
  if (u.system_role === 'super_admin' || u.system_role === 'support') {
    const session: AuthSession = { kind: 'admin', userId: u.id }
    saveAuthSession(session)
    return { redirectTo: '/admin/tenants' }
  }
  // テナントユーザー: organization_members から所属を決定
  // 複数所属なら、ひとまず最初の org に入る（ContextSelectView は別途あるが、
  // ログイン直後はとりあえず 1 つに入る挙動が分かりやすい）
  const m = api.memberships[0]
  if (!m) {
    // メンバーシップが無い→ 行き先なし。エラーにする
    return { redirectTo: '/login?error=no-membership' }
  }
  const session: AuthSession = { kind: 'tenant', userId: u.id, organizationId: m.organization_id }
  saveAuthSession(session)
  // 次に router 解決のため一旦ルートにリダイレクト → main.tsx の resolveActiveOrgFromUrl が
  // session の organizationId から slug を引いて /<slug>/dashboard に書き換える
  return { redirectTo: '/' }
}

export function LoginView() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Supabase env が無いとき先に警告を出す（送信前に気づけるように）
  const supabaseUrlMissing = !import.meta.env.VITE_SUPABASE_URL

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (submitting) return
    setError(null)
    if (!email.trim()) {
      setError('メールアドレスを入力してください。')
      return
    }
    setSubmitting(true)
    const result = await callMockLogin(email.trim(), password)
    setSubmitting(false)
    if (!result.ok) {
      setError(ERROR_LABELS[result.error] ?? `ログインに失敗しました (${result.error})`)
      return
    }
    const { redirectTo } = applyLoginResult(result)
    window.location.href = redirectTo
  }

  /** デモログイン: 固定 email で mock-login を叩く（パスワード不要）。 */
  async function loginAs(demoEmail: string) {
    if (submitting) return
    setSubmitting(true)
    setError(null)
    const result = await callMockLogin(demoEmail, '')
    setSubmitting(false)
    if (!result.ok) {
      setError(`デモログイン失敗 (${result.error})`)
      return
    }
    const { redirectTo } = applyLoginResult(result)
    window.location.href = redirectTo
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-brand">
          <span className="login-brand-name">ミテルデ</span>
          <span className="login-brand-sub">IoT モニタリング — モック認証</span>
        </div>

        {supabaseUrlMissing && (
          <div className="login-error">
            <AlertCircle size={14} />
            <span>
              <strong>Supabase の環境変数が未設定です</strong>
              <br />
              Vercel のプロジェクト設定で{' '}
              <code>VITE_SUPABASE_URL</code> と{' '}
              <code>VITE_SUPABASE_ANON_KEY</code> を追加してから再デプロイしてください。
            </span>
          </div>
        )}

        <form className="login-form" onSubmit={handleSubmit}>
          <div className="form-row">
            <label className="form-label" htmlFor="login-email">
              メールアドレス
            </label>
            <input
              id="login-email"
              type="email"
              className="form-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              autoFocus
            />
          </div>

          <div className="form-row">
            <label className="form-label" htmlFor="login-password">
              パスワード
            </label>
            <input
              id="login-password"
              type="password"
              className="form-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="パスワード"
              autoComplete="current-password"
            />
          </div>

          {error && (
            <div className="login-error">
              <AlertCircle size={14} />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            className="btn btn-primary login-submit"
            disabled={submitting}
          >
            <LogIn size={16} />
            <span>{submitting ? 'サインイン中…' : 'サインイン'}</span>
          </button>
        </form>

        <div className="login-divider">
          <span>デモアカウントですぐ試す</span>
        </div>

        <div className="login-demo-row">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={submitting}
            onClick={() => loginAs('editor-demo@example.com')}
          >
            <UserCircle2 size={15} />
            <span>テナント編集者</span>
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={submitting}
            onClick={() => loginAs('confirmer-demo@example.com')}
          >
            <UserCircle2 size={15} />
            <span>テナント確認者</span>
          </button>
        </div>

        <p className="login-note muted">
          <ShieldCheck size={11} />{' '}
          super_admin / support / sales（運営側）はパスワード必須。
          テナントユーザーはモック期間中パスワード不要。
        </p>
      </div>
    </div>
  )
}
