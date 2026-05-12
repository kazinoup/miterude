/**
 * URL の <slug> → 組織（Supabase の row）を解決するブートストラップ — Phase K
 *
 * 設計方針:
 * - main.tsx の React mount より前に await で 1 回だけ走る。
 * - URL の先頭セグメントを slug として扱い、organizations から SELECT。
 * - 見つからない or slug 無しのときは、localStorage のセッションが持つ
 *   organizationId か、最終手段としてデフォルト demo 組織にフォールバック。
 * - 結果を setActiveOrgContext で supabase.ts に流し込む。
 * - localStorage に session が無い場合は、resolved 組織で tenant セッションを起動。
 */
import { supabase, setActiveOrgContext, isSupabaseConfigured, DEMO_ORG_ID } from './supabase'

type ResolvedOrg = {
  id: string
  slug: string | null
  source: 'url-slug' | 'session' | 'demo-fallback' | 'admin-context'
}

/** URL の先頭セグメントが admin か */
function isAdminPath(pathname: string): boolean {
  return pathname.startsWith('/admin')
}

/** URL から slug を抽出（最初の / 区切りセグメント）。admin / 空のときは null。 */
function readSlugFromPath(pathname: string): string | null {
  if (isAdminPath(pathname)) return null
  const parts = pathname.split('/').filter(Boolean)
  return parts[0] ?? null
}

/** slug で organizations を 1 件 fetch。 */
async function fetchOrgBySlug(slug: string): Promise<{ id: string; slug: string } | null> {
  if (!isSupabaseConfigured()) return null
  const { data, error } = await supabase
    .from('organizations')
    .select('id, slug')
    .eq('slug', slug)
    .maybeSingle()
  if (error) {
    console.warn('[tenant-resolver] org lookup by slug failed', slug, error)
    return null
  }
  return data ?? null
}

/** id で organizations を 1 件 fetch（セッションの organizationId が UUID のとき）。 */
async function fetchOrgById(id: string): Promise<{ id: string; slug: string } | null> {
  if (!isSupabaseConfigured()) return null
  const { data, error } = await supabase
    .from('organizations')
    .select('id, slug')
    .eq('id', id)
    .maybeSingle()
  if (error) return null
  return data ?? null
}

/** localStorage のセッションが指す組織 ID を取り出す（kind=tenant のとき）。 */
function readSessionOrgId(): string | null {
  try {
    const raw = localStorage.getItem('miterude:auth:session')
    if (!raw) return null
    const s = JSON.parse(raw) as { kind?: string; organizationId?: string }
    return s.kind === 'tenant' ? (s.organizationId ?? null) : null
  } catch {
    return null
  }
}

/** ブート時に呼ぶ。返り値の slug を URL の正規化（slug が無いときの redirect）に使う。 */
export async function resolveActiveOrgFromUrl(): Promise<ResolvedOrg> {
  const pathname = typeof window !== 'undefined' ? window.location.pathname : '/'

  // /admin/* のときは admin コンテキスト。active org は触らない（admin が複数テナント操作するため）。
  if (isAdminPath(pathname)) {
    return { id: DEMO_ORG_ID, slug: null, source: 'admin-context' }
  }

  const urlSlug = readSlugFromPath(pathname)
  if (urlSlug) {
    const found = await fetchOrgBySlug(urlSlug)
    if (found) {
      setActiveOrgContext(found.id, found.slug)
      return { id: found.id, slug: found.slug, source: 'url-slug' }
    }
    // 一致するテナントが Supabase に居ないので、フォールバック
  }

  // session の organizationId（UUID 想定）を試す
  const sessionOrgId = readSessionOrgId()
  if (sessionOrgId && /^[0-9a-f-]{36}$/i.test(sessionOrgId)) {
    const found = await fetchOrgById(sessionOrgId)
    if (found) {
      setActiveOrgContext(found.id, found.slug)
      return { id: found.id, slug: found.slug, source: 'session' }
    }
  }

  // 最終フォールバック: demo
  const demo = await fetchOrgById(DEMO_ORG_ID)
  if (demo) {
    setActiveOrgContext(demo.id, demo.slug)
    return { id: demo.id, slug: demo.slug, source: 'demo-fallback' }
  }

  // Supabase 未設定 or demo も無い場合は env の値だけセット（slug は null）
  setActiveOrgContext(DEMO_ORG_ID, null)
  return { id: DEMO_ORG_ID, slug: null, source: 'demo-fallback' }
}
