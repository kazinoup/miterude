-- =====================================================================
-- 0044: β-1 — RLS 共通ヘルパ
--
-- 0042 で導入した public.current_org_id() に加えて、staff バイパス用の
-- 述語関数を整備する。以降の β-1 各 migration が `using (... OR
-- public.is_staff())` の形で使い回す。
--
-- 設計方針:
-- - is_staff(): app_role が super_admin/support のとき真。Admin Console が
--   cross-tenant に SELECT/INSERT する表（organizations / users /
--   organization_members / staff_* / manual_* / webhook_inbox /
--   notification_groups）の policy に併設する
-- - is_super_admin(): super_admin 限定（manual の write など、support は
--   不可にしたい操作で使う）
-- - service_role は bypassrls で自動バイパスのため、これらの述語に依存しない
-- =====================================================================

create or replace function public.is_staff()
returns boolean
language sql
stable
as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'app_role', '') in
         ('super_admin','support')
$$;

comment on function public.is_staff() is
  'JWT app_role が super_admin/support なら true。Admin Console の cross-tenant 読み書き許可に使う（β-1）。';

create or replace function public.is_super_admin()
returns boolean
language sql
stable
as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'app_role', '') = 'super_admin'
$$;

comment on function public.is_super_admin() is
  'JWT app_role が super_admin のときのみ true（β-1 / manual write 等で使用）。';
