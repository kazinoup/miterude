-- =====================================================================
-- 0045: β-1 Phase A — alert_logs を claim ベース RLS に
--
-- 0022 で sensor_notes / dashboard_checkins と同形に作られた alert_logs を、
-- 0042 で 2 表に適用した「claim ベース + demo_*/admin_full 撤去」と同じ
-- 形に揃える。Admin Console は alert_logs を直接 cross-tenant 参照しない
-- ため is_staff バイパスは置かない（impersonation 中の staff は
-- current_org_id() 経由で自動的に target org の行を見られる）。
-- =====================================================================

drop policy if exists demo_select on public.alert_logs;
drop policy if exists demo_insert on public.alert_logs;
drop policy if exists demo_update on public.alert_logs;
drop policy if exists demo_delete on public.alert_logs;
drop policy if exists admin_full  on public.alert_logs;

drop policy if exists claim_select on public.alert_logs;
create policy claim_select on public.alert_logs
  for select to authenticated
  using (organization_id = public.current_org_id());

drop policy if exists claim_insert on public.alert_logs;
create policy claim_insert on public.alert_logs
  for insert to authenticated
  with check (organization_id = public.current_org_id());

drop policy if exists claim_update on public.alert_logs;
create policy claim_update on public.alert_logs
  for update to authenticated
  using (organization_id = public.current_org_id())
  with check (organization_id = public.current_org_id());

drop policy if exists claim_delete on public.alert_logs;
create policy claim_delete on public.alert_logs
  for delete to authenticated
  using (organization_id = public.current_org_id());
