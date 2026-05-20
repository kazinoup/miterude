-- =====================================================================
-- 0048: β-1 Phase C — コアデータ表を claim ベース RLS に
--
-- 対象:
--   - devices         (org_id 直持ち, claim + is_staff バイパス。Admin
--                      ダッシュボードが cross-tenant SELECT する)
--   - sensor_props    (PK=device_id のみ。devices への exists で間接スコープ)
--   - gateway_props   (同上)
--   - sensor_readings (org_id 直持ち, テナント SELECT 限定。書き込みは
--                      service_role 経由のみ＝webhook-milesight が担う)
--   - dashboards      (org_id 直持ち, テナント claim 限定。公開共有は
--                      share-dashboard EF が service_role 利用のため無影響)
--
-- 共通方針:
--   - 旧 demo_*/admin_full は撤去
--   - service_role は bypassrls で自動バイパス
--   - 公開共有（share-dashboard）は EF 経由なので anon 直 SELECT 不要
-- =====================================================================

-- ---------- devices ----------
drop policy if exists demo_select on public.devices;
drop policy if exists demo_insert on public.devices;
drop policy if exists demo_update on public.devices;
drop policy if exists demo_delete on public.devices;
drop policy if exists admin_full  on public.devices;

drop policy if exists claim_select on public.devices;
create policy claim_select on public.devices
  for select to authenticated
  using (organization_id = public.current_org_id() or public.is_staff());

drop policy if exists claim_insert on public.devices;
create policy claim_insert on public.devices
  for insert to authenticated
  with check (organization_id = public.current_org_id() or public.is_staff());

drop policy if exists claim_update on public.devices;
create policy claim_update on public.devices
  for update to authenticated
  using (organization_id = public.current_org_id() or public.is_staff())
  with check (organization_id = public.current_org_id() or public.is_staff());

drop policy if exists claim_delete on public.devices;
create policy claim_delete on public.devices
  for delete to authenticated
  using (organization_id = public.current_org_id() or public.is_staff());

-- ---------- sensor_props / gateway_props（device_id 経由で間接スコープ） ----------
do $$
declare t text;
declare tables text[] := array['sensor_props','gateway_props'];
begin
  foreach t in array tables loop
    execute format('drop policy if exists demo_select on public.%I', t);
    execute format('drop policy if exists demo_insert on public.%I', t);
    execute format('drop policy if exists demo_update on public.%I', t);
    execute format('drop policy if exists demo_delete on public.%I', t);
    execute format('drop policy if exists admin_full  on public.%I', t);

    execute format('drop policy if exists claim_select on public.%I', t);
    execute format(
      'create policy claim_select on public.%I for select to authenticated using (exists (select 1 from public.devices d where d.id = %I.device_id and (d.organization_id = public.current_org_id() or public.is_staff())))',
      t, t
    );
    execute format('drop policy if exists claim_insert on public.%I', t);
    execute format(
      'create policy claim_insert on public.%I for insert to authenticated with check (exists (select 1 from public.devices d where d.id = %I.device_id and (d.organization_id = public.current_org_id() or public.is_staff())))',
      t, t
    );
    execute format('drop policy if exists claim_update on public.%I', t);
    execute format(
      'create policy claim_update on public.%I for update to authenticated using (exists (select 1 from public.devices d where d.id = %I.device_id and (d.organization_id = public.current_org_id() or public.is_staff()))) with check (exists (select 1 from public.devices d where d.id = %I.device_id and (d.organization_id = public.current_org_id() or public.is_staff())))',
      t, t, t
    );
    execute format('drop policy if exists claim_delete on public.%I', t);
    execute format(
      'create policy claim_delete on public.%I for delete to authenticated using (exists (select 1 from public.devices d where d.id = %I.device_id and (d.organization_id = public.current_org_id() or public.is_staff())))',
      t, t
    );
  end loop;
end$$;

-- ---------- sensor_readings（テナント SELECT のみ、書込は service_role） ----------
drop policy if exists demo_select on public.sensor_readings;
drop policy if exists admin_full  on public.sensor_readings;

drop policy if exists claim_select on public.sensor_readings;
create policy claim_select on public.sensor_readings
  for select to authenticated
  using (organization_id = public.current_org_id());
-- INSERT/UPDATE/DELETE は付与しない（service_role 経由のみ）

-- ---------- dashboards（テナント claim 限定。公開共有は EF 経由） ----------
drop policy if exists demo_select on public.dashboards;
drop policy if exists demo_insert on public.dashboards;
drop policy if exists demo_update on public.dashboards;
drop policy if exists demo_delete on public.dashboards;
drop policy if exists admin_full  on public.dashboards;

drop policy if exists claim_select on public.dashboards;
create policy claim_select on public.dashboards
  for select to authenticated
  using (organization_id = public.current_org_id());

drop policy if exists claim_insert on public.dashboards;
create policy claim_insert on public.dashboards
  for insert to authenticated
  with check (organization_id = public.current_org_id());

drop policy if exists claim_update on public.dashboards;
create policy claim_update on public.dashboards
  for update to authenticated
  using (organization_id = public.current_org_id())
  with check (organization_id = public.current_org_id());

drop policy if exists claim_delete on public.dashboards;
create policy claim_delete on public.dashboards
  for delete to authenticated
  using (organization_id = public.current_org_id());
