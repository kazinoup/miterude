/**
 * Supabase クライアント — Phase G (Block A): 実 DB 連携の入口。
 *
 * - 認証は当面 anon キー（RLS 越し）。ポリシーはまだ deny-all なので、
 *   読み取りは将来サインインユーザの JWT を使う想定。デモ期間は
 *   `VITE_DEMO_ORG_ID` を明示的にクエリ条件として渡す。
 * - service_role キーは絶対にここに持ち込まない（Edge Function 側のみ）。
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
const demoOrgId = import.meta.env.VITE_DEMO_ORG_ID as string | undefined

if (!url || !anonKey) {
  console.warn(
    '[supabase] VITE_SUPABASE_URL または VITE_SUPABASE_ANON_KEY が未設定です。' +
      ' .env.local を確認してください。',
  )
}

/**
 * createClient は空文字や空 URL を渡すと例外を投げる（"supabaseUrl is required"）。
 * env が未設定の環境（Vercel に env を設定し忘れた等）で **モジュール読み込み自体が失敗** し、
 * 結果 React がマウントできず真っ白になるのを避けるため、ダミー URL を渡しておく。
 * 実際の API 呼び出しは isSupabaseConfigured() で UI 側がガードする。
 */
export const supabase: SupabaseClient = createClient(
  url || 'https://invalid.supabase.co',
  anonKey || 'invalid-anon-key',
  {
    // β-2: Supabase Auth を採用。セッションを localStorage に永続化し、
    // JWT を自動リフレッシュ（Custom Access Token Hook の claim 更新も追従）。
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  },
)

/** デフォルトの組織 ID（フォールバック用）。URL から slug を解決できないときに使う。 */
export const DEMO_ORG_ID =
  demoOrgId ?? '00000000-0000-0000-0000-00000000d001'

/* ---------- アクティブな組織コンテキスト（Phase K: URL ルーティング） ----------
 * URL の <slug> から解決されたテナント。supabaseQueries の各クエリは
 * この値を参照する。slug が分からないブート段階では DEMO_ORG_ID を使う。 */
let _activeOrgId: string = DEMO_ORG_ID
let _activeOrgSlug: string | null = null

export function getActiveOrgId(): string {
  return _activeOrgId
}

export function getActiveOrgSlug(): string | null {
  return _activeOrgSlug
}

export function setActiveOrgContext(orgId: string, slug: string | null): void {
  _activeOrgId = orgId
  _activeOrgSlug = slug
}

/** Supabase 設定が揃っているか（env が空でもクラッシュさせず UI 側で扱えるように） */
export function isSupabaseConfigured(): boolean {
  return Boolean(url && anonKey)
}
