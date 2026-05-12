import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary'
import { installDemoResetHook } from './lib/demoReset'
import { resolveActiveOrgFromUrl } from './lib/tenantResolver'

// URL クエリ `?reset=demo` や console `miterudeResetDemo()` で
// localStorage を初期化できるようにする。React より前に実行。
installDemoResetHook()

// URL の <slug> から active org を解決してから React マウント。
// supabaseQueries の全クエリはこの後 getActiveOrgId() を参照する。
;(async () => {
  await resolveActiveOrgFromUrl().catch((e) => {
    console.warn('[boot] resolveActiveOrgFromUrl failed, falling back to demo', e)
  })
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  )
})()
