-- β-2d: 認証フロント用 RPC（impersonation / アクティブテナント切替）
--
-- impersonation_sessions は RLS 有効・ポリシー無しのためフロント直書き不可。
-- users.active_organization_id も RLS 厳格化（β-1）後は直 update させたくない。
-- いずれも auth.uid() → users.auth_user_id で本人確認し、SECURITY DEFINER で
-- RLS をバイパスして安全に書く。フロントは RPC 実行後 refreshSession() で
-- JWT claim（impersonating_org_id / org_id）を更新する。

-- ---------- start_impersonation ----------
create or replace function public.start_impersonation(
  p_target_org uuid,
  p_reason text,
  p_duration_minutes int default 60
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_user_id uuid;
  v_role text;
begin
  v_uid := auth.uid();
  if v_uid is null then raise exception 'not-authenticated'; end if;
  select id, system_role into v_user_id, v_role
    from public.users where auth_user_id = v_uid limit 1;
  if v_user_id is null then raise exception 'user-not-found'; end if;
  if v_role is null or v_role not in ('super_admin', 'support') then
    raise exception 'forbidden';
  end if;
  -- support は staff_assignments で割当必須
  if v_role = 'support' and not exists (
    select 1 from public.staff_assignments
    where staff_user_id = v_user_id
      and organization_id = p_target_org
      and revoked_at is null
      and (expires_at is null or expires_at > now())
  ) then
    raise exception 'no-assignment';
  end if;
  -- 既存の有効セッションを閉じてから新規作成（1スタッフ1有効セッション）
  update public.impersonation_sessions
    set ended_at = now()
    where staff_user_id = v_user_id and ended_at is null;
  insert into public.impersonation_sessions
    (staff_user_id, target_organization_id, reason, expires_at)
  values (
    v_user_id, p_target_org,
    coalesce(nullif(p_reason, ''), '(理由未記入)'),
    now() + make_interval(mins => greatest(1, p_duration_minutes))
  );
  insert into public.staff_audit_logs
    (staff_user_id, organization_id, action, target_table, target_id, metadata)
  values (
    v_user_id, p_target_org, 'impersonation_started',
    'organizations', p_target_org::text,
    jsonb_build_object('reason', p_reason)
  );
end;
$$;

-- ---------- end_impersonation ----------
create or replace function public.end_impersonation()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_user_id uuid;
  v_org uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then raise exception 'not-authenticated'; end if;
  select id into v_user_id
    from public.users where auth_user_id = v_uid limit 1;
  if v_user_id is null then raise exception 'user-not-found'; end if;
  select target_organization_id into v_org
    from public.impersonation_sessions
    where staff_user_id = v_user_id and ended_at is null
    order by started_at desc limit 1;
  update public.impersonation_sessions
    set ended_at = now()
    where staff_user_id = v_user_id and ended_at is null;
  if v_org is not null then
    insert into public.staff_audit_logs
      (staff_user_id, organization_id, action, target_table, target_id)
    values (v_user_id, v_org, 'impersonation_ended',
            'organizations', v_org::text);
  end if;
end;
$$;

-- ---------- set_active_organization ----------
create or replace function public.set_active_organization(p_org uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_user_id uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then raise exception 'not-authenticated'; end if;
  select id into v_user_id
    from public.users where auth_user_id = v_uid limit 1;
  if v_user_id is null then raise exception 'user-not-found'; end if;
  if not exists (
    select 1 from public.organization_members
    where user_id = v_user_id and organization_id = p_org
  ) then
    raise exception 'not-a-member';
  end if;
  update public.users
    set active_organization_id = p_org, updated_at = now()
    where id = v_user_id;
end;
$$;

comment on function public.start_impersonation(uuid, text, int) is
  'β-2d: super_admin/support が対象テナントの impersonation を開始。実行後フロントは refreshSession()。';
comment on function public.end_impersonation() is
  'β-2d: 自分の有効 impersonation を終了。実行後フロントは refreshSession()。';
comment on function public.set_active_organization(uuid) is
  'β-2d: 複数所属テナントのアクティブ切替（B1）。実行後フロントは refreshSession()。';

grant execute on function public.start_impersonation(uuid, text, int) to authenticated;
grant execute on function public.end_impersonation() to authenticated;
grant execute on function public.set_active_organization(uuid) to authenticated;
revoke execute on function public.start_impersonation(uuid, text, int) from anon;
revoke execute on function public.end_impersonation() from anon;
revoke execute on function public.set_active_organization(uuid) from anon;
