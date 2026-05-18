/**
 * β-2d-3: 認証 Context（正攻法）。
 *
 * - マウント時に getResolvedAuth() で現在のセッションを解決
 * - onAuthChange() で以降の変化（ログイン/ログアウト/リフレッシュ）を購読
 * - 解決するまでは loading 表示（旧 localStorage 同期読み取りを全廃）
 * - useAuth() で各コンポーネントが ResolvedAuth を同期的に参照
 */
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { getResolvedAuth, onAuthChange, type ResolvedAuth } from './authSession'

const AuthCtx = createContext<ResolvedAuth | null>(null)

export function useAuth(): ResolvedAuth {
  const v = useContext(AuthCtx)
  if (!v) {
    throw new Error('useAuth() は <AuthProvider> の内側で使ってください')
  }
  return v
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<ResolvedAuth | null>(null)

  useEffect(() => {
    let mounted = true
    getResolvedAuth().then((a) => {
      if (mounted) setAuth(a)
    })
    const off = onAuthChange((a) => {
      if (mounted) setAuth(a)
    })
    return () => {
      mounted = false
      off()
    }
  }, [])

  if (!auth) {
    return (
      <div className="login-page" role="status" aria-live="polite">
        <div className="login-card">
          <div className="login-brand">
            <span className="login-brand-name">ミテルデ</span>
            <span className="login-brand-sub">読み込み中…</span>
          </div>
        </div>
      </div>
    )
  }

  return <AuthCtx.Provider value={auth}>{children}</AuthCtx.Provider>
}
