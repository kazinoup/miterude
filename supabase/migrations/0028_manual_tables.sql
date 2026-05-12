-- Phase 1.1: マニュアル機能の Supabase 同期
-- ============================================================
-- 全テナント共通の「マニュアル」をテーブル化する。
-- super_admin のみ編集、認証済すべて閲覧（テナントユーザー含む）。
--
-- Mock 認証期間（Phase 5 で Clerk 統合）中は anon key で読み書きする運用なので、
-- 書き込み制限は code 側（AdminApp / AdminManualView）で実装している。
-- Phase 6 (RLS整備) で `current_user_system_role()` 等を用いた厳格化を行う。
-- ============================================================

-- ------------------------------
-- 1) テーブル
-- ------------------------------

create table public.manual_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sort_order integer not null default 0,
  updated_at timestamptz not null default now()
);

create table public.manual_pages (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.manual_categories(id) on delete cascade,
  title text not null,
  sort_order integer not null default 0,
  content jsonb,                            -- BlockNote の Block[] を JSON 化したもの
  updated_by_user_id uuid references public.users(id),
  updated_at timestamptz not null default now()
);

create index manual_pages_category_id_sort_idx
  on public.manual_pages (category_id, sort_order);

-- ------------------------------
-- 2) RLS
-- ------------------------------
--
-- 暫定方針:
--   - SELECT: 認証済（anon 含む）すべて許可
--   - INSERT/UPDATE/DELETE: 暫定で `true`（Phase 6 で super_admin 限定に置換）
--
-- 厳格版（Phase 6 で有効化）はファイル末尾にコメントで残してある。

alter table public.manual_categories enable row level security;
alter table public.manual_pages enable row level security;

create policy "manual_categories read"
  on public.manual_categories for select
  using (true);

create policy "manual_pages read"
  on public.manual_pages for select
  using (true);

-- TODO(Phase6): super_admin 限定に置き換える
create policy "manual_categories write tmp"
  on public.manual_categories for all
  using (true)
  with check (true);

create policy "manual_pages write tmp"
  on public.manual_pages for all
  using (true)
  with check (true);

-- ------------------------------
-- 3) Storage: manual-images バケット
-- ------------------------------
--
-- BlockNote から画像をアップロードする先。public read で URL から直接配信。
-- 書き込みは暫定で anon 許可（Phase 6 で super_admin 限定に置換）。

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'manual-images',
  'manual-images',
  true,
  10485760, -- 10 MB
  array['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "manual-images read" on storage.objects;
drop policy if exists "manual-images write" on storage.objects;
drop policy if exists "manual-images update" on storage.objects;
drop policy if exists "manual-images delete" on storage.objects;

create policy "manual-images read"
  on storage.objects for select
  using (bucket_id = 'manual-images');

create policy "manual-images write"
  on storage.objects for insert
  with check (bucket_id = 'manual-images');

create policy "manual-images update"
  on storage.objects for update
  using (bucket_id = 'manual-images');

create policy "manual-images delete"
  on storage.objects for delete
  using (bucket_id = 'manual-images');

-- ============================================================
-- 厳格版 RLS（Phase 6 で有効化予定 — このコメントはまだ実行しない）
-- ============================================================
--
-- drop policy "manual_categories write tmp" on public.manual_categories;
-- drop policy "manual_pages write tmp"      on public.manual_pages;
--
-- create policy "manual_categories write"
--   on public.manual_categories for all
--   using (current_user_system_role() = 'super_admin')
--   with check (current_user_system_role() = 'super_admin');
--
-- create policy "manual_pages write"
--   on public.manual_pages for all
--   using (current_user_system_role() = 'super_admin')
--   with check (current_user_system_role() = 'super_admin');
--
-- -- Storage 書き込みも super_admin 限定に
-- drop policy "manual-images write"  on storage.objects;
-- drop policy "manual-images update" on storage.objects;
-- drop policy "manual-images delete" on storage.objects;
--
-- create policy "manual-images write"
--   on storage.objects for insert
--   with check (bucket_id = 'manual-images' and current_user_system_role() = 'super_admin');
-- create policy "manual-images update"
--   on storage.objects for update
--   using (bucket_id = 'manual-images' and current_user_system_role() = 'super_admin');
-- create policy "manual-images delete"
--   on storage.objects for delete
--   using (bucket_id = 'manual-images' and current_user_system_role() = 'super_admin');
