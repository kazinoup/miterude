-- =====================================================================
-- 0042: β-2e — JWT claim ベース RLS の試験適用（1〜2 テーブル）
--
-- 目的: Custom Access Token Hook（0039）が注入する app_metadata claim
--   （org_id / impersonating_org_id）が RLS で実際に効くことを、
--   影響の小さい 2 テーブル（sensor_notes / dashboard_checkins）で実証する。
--
-- 方針:
--   - tenant ユーザー: 自分の org_id の行のみ可視
--   - impersonation 中の staff: impersonating_org_id の行が可視
--     （coalesce(impersonating_org_id, org_id) で 1 本化）
--   - 非 impersonation の super_admin/support: これら 2 テーブルは
--     claim に org が無いため不可視（Admin Console はこれらを
--     テナント横断では読まないため許容）。β-1 で全テーブルへ一般化する際に
--     staff 用特例（service_role / 別 claim）を設計する。
--   - anon: claim 無し → current_org_id() = null → 不可視
--     （sensor_notes / dashboard_checkins は公開共有対象外）
--
-- 旧 demo_*（organization_id = demo_org_id() を anon+authenticated に開放）
-- および admin_full（0024 のモック期 anon 全開放 = qual/with_check true）は
-- permissive OR 合成で claim_* を無効化するため、この 2 テーブルに限り撤去し、
-- claim ベースに置換する。他テーブルの demo_* / admin_full は β-1 まで残置。
-- =====================================================================

-- ---------- claim 読み取りヘルパ ----------
-- JWT の app_metadata から「実効テナント org」を返す。
-- impersonation 中は impersonating_org_id を優先。security invoker
-- （呼び出し元の JWT を参照）。STABLE。
create or replace function public.current_org_id()
returns uuid
language sql
stable
as $$
  select nullif(
    coalesce(
      auth.jwt() -> 'app_metadata' ->> 'impersonating_org_id',
      auth.jwt() -> 'app_metadata' ->> 'org_id'
    ),
    ''
  )::uuid
$$;

comment on function public.current_org_id() is
  'JWT app_metadata の coalesce(impersonating_org_id, org_id) を uuid で返す。RLS の組織スコープ判定に使う（β-2e 試験 → β-1 で全テーブルへ一般化）。';

-- ---------- sensor_notes / dashboard_checkins を claim ベースに ----------
do $$
declare t text;
declare tables text[] := array['sensor_notes','dashboard_checkins'];
begin
  foreach t in array tables loop
    -- 旧 demo_* / admin_full を撤去（この 2 テーブルのみ）
    execute format('drop policy if exists demo_select on public.%I', t);
    execute format('drop policy if exists demo_insert on public.%I', t);
    execute format('drop policy if exists demo_update on public.%I', t);
    execute format('drop policy if exists demo_delete on public.%I', t);
    execute format('drop policy if exists admin_full on public.%I', t);

    -- claim ベース（authenticated のみ）
    execute format('drop policy if exists claim_select on public.%I', t);
    execute format(
      'create policy claim_select on public.%I for select to authenticated using (organization_id = public.current_org_id())',
      t
    );
    execute format('drop policy if exists claim_insert on public.%I', t);
    execute format(
      'create policy claim_insert on public.%I for insert to authenticated with check (organization_id = public.current_org_id())',
      t
    );
    execute format('drop policy if exists claim_update on public.%I', t);
    execute format(
      'create policy claim_update on public.%I for update to authenticated using (organization_id = public.current_org_id()) with check (organization_id = public.current_org_id())',
      t
    );
    execute format('drop policy if exists claim_delete on public.%I', t);
    execute format(
      'create policy claim_delete on public.%I for delete to authenticated using (organization_id = public.current_org_id())',
      t
    );
  end loop;
end$$;
