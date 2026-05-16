-- β-2a: Supabase Auth 統合の土台
--
-- - users.auth_user_id         : auth.users への紐付け（users.id は不変・FK 無傷）
-- - users.active_organization_id : マルチテナント所属時のアクティブテナント（B1 方式）
-- - impersonation_sessions      : custom claim 方式の impersonation 管理（A 方式）
--
-- ※ 移行は stg 先行。dev/main は mock-login 温存のため当面未適用。

-- ---------- users.auth_user_id ----------
alter table public.users
  add column if not exists auth_user_id uuid unique
    references auth.users(id) on delete set null;

comment on column public.users.auth_user_id is
  'Supabase Auth (auth.users.id) との紐付け。RLS は auth.uid() = users.auth_user_id で評価。id 統一は FK カスケード回避のため不採用。';

-- ---------- users.active_organization_id ----------
alter table public.users
  add column if not exists active_organization_id uuid
    references public.organizations(id) on delete set null;

comment on column public.users.active_organization_id is
  'tenant ユーザーの現在アクティブなテナント。複数所属時の切替対象（Custom Access Token Hook が org_id claim に使う / B1 方式）。';

-- ---------- impersonation_sessions ----------
create table if not exists public.impersonation_sessions (
  id uuid primary key default gen_random_uuid(),
  staff_user_id uuid not null references public.users(id) on delete cascade,
  target_organization_id uuid not null references public.organizations(id) on delete cascade,
  reason text not null,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ended_at timestamptz,
  created_at timestamptz default now()
);

comment on table public.impersonation_sessions is
  'super_admin/support が別テナントになりすます際のセッション。Custom Access Token Hook が「ended_at is null and expires_at > now()」の行を見て impersonating_org_id claim を注入する（A 方式）。';

-- Hook が「特定 staff の有効な impersonation」を高速に引くため
create index if not exists impersonation_sessions_staff_active_idx
  on public.impersonation_sessions (staff_user_id, ended_at, expires_at);

-- RLS: 機密性が高いため anon/authenticated には開けない。
-- 書き込みは Edge Function（service_role）経由、読み取りは Hook（security definer）のみ。
-- ポリシーを敢えて作らない = anon/authenticated は一切アクセス不可、service_role はバイパス。
alter table public.impersonation_sessions enable row level security;
