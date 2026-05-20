-- =====================================================================
-- 0049: β-1 Phase D — 横断系テーブルを claim ベース RLS に
--
-- 対象:
--   - organizations        (SELECT: 自テナント or staff / 書込: staff)
--   - users                (SELECT: 本人 or staff / 書込: staff)
--   - organization_members (SELECT: 自テナント or staff / 書込: staff)
--   - staff_assignments    (CRUD: staff)
--   - staff_audit_logs     (SELECT/INSERT: staff、UPDATE/DELETE policy 無し
--                           = 不変)
--
-- 補足:
--   - RPC（start/end_impersonation, set_active_organization）は SECURITY
--     DEFINER で関数所有者権限実行のため RLS をバイパス。本ポリシーは
--     直接 API 経由のアクセスを制限するためのもの
--   - service_role（Edge Function / cron）は bypassrls で自動バイパス
--   - support の cross-tenant 範囲を staff_assignments で絞る正確な制御は
--     β-1 後続の refinement。本 phase は is_staff() = super_admin/support
--     一括バイパスで成立させる
-- =====================================================================

-- ---------- organizations ----------
drop policy if exists demo_select on public.organizations;
drop policy if exists admin_full  on public.organizations;

drop policy if exists claim_select on public.organizations;
create policy claim_select on public.organizations
  for select to authenticated
  using (id = public.current_org_id() or public.is_staff());

drop policy if exists claim_insert on public.organizations;
create policy claim_insert on public.organizations
  for insert to authenticated
  with check (public.is_staff());

drop policy if exists claim_update on public.organizations;
create policy claim_update on public.organizations
  for update to authenticated
  using (public.is_staff())
  with check (public.is_staff());

drop policy if exists claim_delete on public.organizations;
create policy claim_delete on public.organizations
  for delete to authenticated
  using (public.is_staff());

-- ---------- users ----------
drop policy if exists admin_full on public.users;

drop policy if exists claim_select on public.users;
create policy claim_select on public.users
  for select to authenticated
  using (auth_user_id = auth.uid() or public.is_staff());

drop policy if exists claim_insert on public.users;
create policy claim_insert on public.users
  for insert to authenticated
  with check (public.is_staff());

drop policy if exists claim_update on public.users;
create policy claim_update on public.users
  for update to authenticated
  using (public.is_staff())
  with check (public.is_staff());

drop policy if exists claim_delete on public.users;
create policy claim_delete on public.users
  for delete to authenticated
  using (public.is_staff());

-- ---------- organization_members ----------
drop policy if exists admin_full on public.organization_members;

drop policy if exists claim_select on public.organization_members;
create policy claim_select on public.organization_members
  for select to authenticated
  using (organization_id = public.current_org_id() or public.is_staff());

drop policy if exists claim_insert on public.organization_members;
create policy claim_insert on public.organization_members
  for insert to authenticated
  with check (public.is_staff());

drop policy if exists claim_update on public.organization_members;
create policy claim_update on public.organization_members
  for update to authenticated
  using (public.is_staff())
  with check (public.is_staff());

drop policy if exists claim_delete on public.organization_members;
create policy claim_delete on public.organization_members
  for delete to authenticated
  using (public.is_staff());

-- ---------- staff_assignments ----------
drop policy if exists admin_full on public.staff_assignments;

drop policy if exists claim_select on public.staff_assignments;
create policy claim_select on public.staff_assignments
  for select to authenticated
  using (public.is_staff());

drop policy if exists claim_insert on public.staff_assignments;
create policy claim_insert on public.staff_assignments
  for insert to authenticated
  with check (public.is_staff());

drop policy if exists claim_update on public.staff_assignments;
create policy claim_update on public.staff_assignments
  for update to authenticated
  using (public.is_staff())
  with check (public.is_staff());

drop policy if exists claim_delete on public.staff_assignments;
create policy claim_delete on public.staff_assignments
  for delete to authenticated
  using (public.is_staff());

-- ---------- staff_audit_logs（不変 = UPDATE/DELETE policy 無し） ----------
drop policy if exists admin_full on public.staff_audit_logs;

drop policy if exists claim_select on public.staff_audit_logs;
create policy claim_select on public.staff_audit_logs
  for select to authenticated
  using (public.is_staff());

drop policy if exists claim_insert on public.staff_audit_logs;
create policy claim_insert on public.staff_audit_logs
  for insert to authenticated
  with check (public.is_staff());
-- UPDATE / DELETE は policy を作らない = 不可（service_role と SECURITY
-- DEFINER の RPC のみが書ける）
