/**
 * β-5: β リリース期間のフラグ。
 *
 * Vercel プロジェクト単位の env var `VITE_BETA_MODE=true` で有効化する想定。
 * dev / stg は true、prod は false。
 * UI で β バッジ・規約リンク・利用注意 banner を出し分ける。
 */
export const BETA_MODE: boolean =
  import.meta.env.VITE_BETA_MODE === 'true'

/** β 利用規約画面の path（main.tsx でルーティング、認証不要） */
export const BETA_TERMS_PATH = '/terms-beta'
