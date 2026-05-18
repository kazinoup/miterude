import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary'
import { AuthProvider } from './lib/AuthProvider'
import { installDemoResetHook } from './lib/demoReset'
import { PublicDashboardView } from './components/views/PublicDashboardView'
import { PublicReportView } from './components/views/PublicReportView'
import { LoginView } from './components/views/LoginView'

// URL クエリ `?reset=demo` や console `miterudeResetDemo()` で
// localStorage を初期化できるようにする。React より前に実行。
installDemoResetHook()

/** /share/dashboard/<token> なら公開ダッシュボード、
 *  /share/report/<token> なら公開レポート、
 *  それ以外は通常の App をマウント。 */
type SharePath =
  | { kind: 'dashboard'; token: string }
  | { kind: 'report'; token: string }
  | null

function extractSharePath(): SharePath {
  if (typeof window === 'undefined') return null
  const parts = window.location.pathname.split('/').filter(Boolean)
  if (parts[0] !== 'share' || !parts[2]) return null
  if (parts[1] === 'dashboard') return { kind: 'dashboard', token: parts[2] }
  if (parts[1] === 'report') return { kind: 'report', token: parts[2] }
  return null
}

function isLoginPath(): boolean {
  return typeof window !== 'undefined' && window.location.pathname === '/login'
}

const share = extractSharePath()

if (share?.kind === 'dashboard') {
  // 公開ダッシュボード: テナント解決もログイン状態のチェックもしない
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary>
        <PublicDashboardView token={share.token} />
      </ErrorBoundary>
    </StrictMode>,
  )
} else if (share?.kind === 'report') {
  // 公開レポート: メール配信リンクから開かれる、ログイン不要
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary>
        <PublicReportView token={share.token} />
      </ErrorBoundary>
    </StrictMode>,
  )
} else if (isLoginPath()) {
  // ログイン画面: セッション不要、テナント解決もしない
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary>
        <LoginView />
      </ErrorBoundary>
    </StrictMode>,
  )
} else {
  // 通常のアプリ起動。β-2d-3: 認証解決は AuthProvider が担い、
  // 未ログイン時のリダイレクト・テナント解決は App 側で行う。
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary>
        <AuthProvider>
          <App />
        </AuthProvider>
      </ErrorBoundary>
    </StrictMode>,
  )
}
