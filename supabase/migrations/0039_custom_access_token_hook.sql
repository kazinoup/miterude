-- β-2b: Custom Access Token Hook
--
-- ログイン/リフレッシュ時に JWT の claims.app_metadata へ以下を注入する:
--   - app_user_id          : 内部 users.id（RLS で使いやすく）
--   - app_role             : super_admin | support | editor | dashboard_confirmer | guest
--   - org_id               : tenant の active_organization_id（なければ所属先頭）
--   - impersonating_org_id : 有効な impersonation_sessions があれば target org
--
-- security definer で実装する理由:
--   impersonation_sessions が RLS 有効・ポリシー無しのため、
--   invoker（supabase_auth_admin）では読めない。definer 権限で RLS をバイパスする。
--
-- ※ stg 先行。Hook の有効化（Authentication → Hooks）は Supabase ダッシュボード側で行う。

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  claims jsonb;
  v_auth_uid uuid;
  v_user_id uuid;
  v_system_role text;
  v_active_org uuid;
  v_app_role text;
  v_org_id uuid;
  v_member_role text;
  v_imp_org uuid;
begin
  v_auth_uid := (event->>'user_id')::uuid;
  claims := event->'claims';

  select id, system_role, active_organization_id
    into v_user_id, v_system_role, v_active_org
    from public.users
   where auth_user_id = v_auth_uid
   limit 1;

  -- 未紐付け（移行前 or 不整合）: claims を素通し（app_role なし）
  if v_user_id is null then
    return event;
  end if;

  -- app_metadata を確保
  if claims->'app_metadata' is null
     or jsonb_typeof(claims->'app_metadata') = 'null' then
    claims := jsonb_set(claims, '{app_metadata}', '{}'::jsonb);
  end if;

  -- 内部 user id
  claims := jsonb_set(
    claims, '{app_metadata,app_user_id}', to_jsonb(v_user_id::text));

  if v_system_role = 'super_admin' then
    v_app_role := 'super_admin';
  elsif v_system_role = 'support' then
    v_app_role := 'support';
  else
    -- tenant: active_organization_id（なければ organization_members の先頭）
    v_org_id := v_active_org;
    if v_org_id is null then
      select organization_id into v_org_id
        from public.organization_members
       where user_id = v_user_id
       order by created_at asc
       limit 1;
    end if;
    if v_org_id is not null then
      select role into v_member_role
        from public.organization_members
       where user_id = v_user_id and organization_id = v_org_id
       limit 1;
      v_app_role := coalesce(v_member_role, 'guest');
      claims := jsonb_set(
        claims, '{app_metadata,org_id}', to_jsonb(v_org_id::text));
    else
      v_app_role := 'guest';
    end if;
  end if;

  claims := jsonb_set(
    claims, '{app_metadata,app_role}', to_jsonb(v_app_role));

  -- impersonation: スタッフの有効セッションがあれば target org を注入
  if v_system_role in ('super_admin', 'support') then
    select target_organization_id into v_imp_org
      from public.impersonation_sessions
     where staff_user_id = v_user_id
       and ended_at is null
       and expires_at > now()
     order by started_at desc
     limit 1;
    if v_imp_org is not null then
      claims := jsonb_set(
        claims, '{app_metadata,impersonating_org_id}',
        to_jsonb(v_imp_org::text));
    end if;
  end if;

  event := jsonb_set(event, '{claims}', claims);
  return event;
end;
$$;

comment on function public.custom_access_token_hook(jsonb) is
  'Supabase Auth Custom Access Token Hook。JWT の app_metadata に app_role / org_id / impersonating_org_id / app_user_id を注入する（β-2）。security definer で impersonation_sessions の RLS をバイパス。';

-- Hook 実行ロール（supabase_auth_admin）のみ実行可能にする
grant execute on function public.custom_access_token_hook(jsonb)
  to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb)
  from authenticated, anon, public;
