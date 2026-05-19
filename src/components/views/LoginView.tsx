/**
 * ログイン画面 (/login) — β-2d-3: Supabase Auth。
 *
 * - email + password を `supabase.auth.signInWithPassword` で認証
 * - 成功後 getResolvedAuth() の kind で遷移先を決定
 *   （admin → /admin/dashboard、それ以外 → / で tenantResolver が解決）
 * - デモログインチップは stg 検証ユーザー（既知パスワード）でワンクリック
 */
import { useState } from 'react'
import { LogIn, UserCircle2, ShieldCheck, AlertCircle } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { getResolvedAuth } from '../../lib/authSession'

const DEMO_PASSWORD = 'StgTest2026!'

function jpError(message: string): string {
  const m = message.toLowerCase()
  if (m.includes('invalid login credentials')) {
    return 'メールアドレスまたはパスワードが違います。'
  }
  if (m.includes('email not confirmed')) {
    return 'メールアドレスが未確認です。管理者にお問い合わせください。'
  }
  if (m.includes('too many requests') || m.includes('rate limit')) {
    return '試行回数が多すぎます。しばらく待って再度お試しください。'
  }
  return `ログインに失敗しました（${message}）`
}

async function redirectAfterLogin(): Promise<void> {
  const auth = await getResolvedAuth()
  if (!auth.authed) {
    window.location.href = '/login?error=no-session'
    return
  }
  if (auth.kind === 'admin') {
    window.location.href = '/admin/dashboard'
    return
  }
  // tenant / impersonation / guest: ルートへ。tenantResolver が
  // claim の org_id から slug を解決して /<slug>/dashboard に正規化する。
  window.location.href = '/'
}

export function LoginView() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const supabaseUrlMissing = !import.meta.env.VITE_SUPABASE_URL

  async function signIn(em: string, pw: string): Promise<boolean> {
    setError(null)
    const { error: err } = await supabase.auth.signInWithPassword({
      email: em,
      password: pw,
    })
    if (err) {
      setError(jpError(err.message))
      return false
    }
    return true
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (submitting) return
    if (!email.trim()) {
      setError('メールアドレスを入力してください。')
      return
    }
    setSubmitting(true)
    const ok = await signIn(email.trim(), password)
    if (!ok) {
      setSubmitting(false)
      return
    }
    await redirectAfterLogin()
  }

  async function loginAs(demoEmail: string) {
    if (submitting) return
    setSubmitting(true)
    const ok = await signIn(demoEmail, DEMO_PASSWORD)
    if (!ok) {
      setSubmitting(false)
      return
    }
    await redirectAfterLogin()
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-brand">
          <span className="login-brand-name">ミテルデ</span>
          <span className="login-brand-sub">IoT モニタリング</span>
        </div>

        {supabaseUrlMissing && (
          <div className="login-error">
            <AlertCircle size={14} />
            <span>
              <strong>Supabase の環境変数が未設定です</strong>
              <br />
              Vercel のプロジェクト設定で <code>VITE_SUPABASE_URL</code> と{' '}
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
          <span>検証アカウントですぐ試す（stg）</span>
        </div>

        <div className="login-demo-row">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={submitting}
            onClick={() => loginAs('editor@stg.miterude.cloud')}
          >
            <UserCircle2 size={15} />
            <span>テナント編集者</span>
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={submitting}
            onClick={() => loginAs('confirmer@stg.miterude.cloud')}
          >
            <UserCircle2 size={15} />
            <span>テナント確認者</span>
          </button>
        </div>

        <p className="login-note muted">
          <ShieldCheck size={11} /> Supabase Auth による認証。検証ユーザーは
          stg 環境専用です。
        </p>
      </div>
    </div>
  )
}
