-- =====================================================================
-- 0043: β-2f — モック認証 password_hash カラム撤去
--
-- 背景:
--   0030 で Clerk 統合までの中継としてモック認証用に追加した
--   users.password_hash（SHA-256 hex、salt なし）は、β-2 で
--   Supabase Auth（bcrypt は auth.users 側が管理）へ完全移行したため不要。
--   フロントは β-2d-3 で signInWithPassword 一本化済、mock-login
--   Edge Function も撤去するため、本カラムを参照するコードは無い。
--
-- 注意:
--   - 0030 で同時に追加した staff_category は引き続き使用するため温存。
--   - 破壊的（データ復元不可）。ただし格納値はモック用 SHA-256 のみで
--     業務データではない。stg/dev に適用、prod は未作成。
-- =====================================================================

alter table public.users
  drop column if exists password_hash;
