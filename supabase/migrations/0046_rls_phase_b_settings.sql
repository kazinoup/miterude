-- =====================================================================
-- 0046: β-1 Phase B — 設定系テナント表を claim ベース RLS に
--
-- 対象:
--   - sensor_categories         (tenant only)
--   - sensor_groups             (tenant only)
--   - manufacturer_integrations (tenant only)
--   - report_schedules          (tenant only)
--   - notification_groups       (tenant + is_staff バイパス。Admin Console が
--                                AdminTenantDetailView で cross-tenant 操作する)
--
-- 共通方針:
--   - 旧 demo_*/admin_full と暫定 *_tmp は撤去
--   - claim_select/insert/update/delete を authenticated に付与
--   - service_role は bypassrls で自動バイパス（webhook / cron / 通知系 EF）
--   - report_delivery_links は token-keyed の公開アクセス設計が必要なため
--     Phase E（webhook_inbox tmp 全廃と一緒）で扱う
-- =====================================================================

-- ---------- tenant-only 表（4 表は同形） ----------
do $$
declare t text;
declare tables text[] := array[
  'sensor_categories','sensor_groups','manufacturer_integrations','report_schedules'
];
begin
  foreach t in array tables loop
    -- 旧 / 暫定ポリシー撤去
    execute format('drop policy if exists demo_select on public.%I', t);
    execute format('drop policy if exists demo_insert on public.%I', t);
    execute format('drop policy if exists demo_update on public.%I', t);
    execute format('drop policy if exists demo_delete on public.%I', t);
    execute format('drop policy if exists admin_full  on public.%I', t);
    execute format('drop policy if exists "report_schedules all tmp" on public.%I', t);

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

-- ---------- notification_groups（is_staff バイパス併設） ----------
-- 旧ポリシー撤去
drop policy if exists demo_select on public.notification_groups;
drop policy if exists demo_insert on public.notification_groups;
drop policy if exists demo_update on public.notification_groups;
drop policy if exists demo_delete on public.notification_groups;
drop policy if exists admin_full  on public.notification_groups;

-- claim + staff（Admin Console から各テナントの通知グループを管理できる）
drop policy if exists claim_select on public.notification_groups;
create policy claim_select on public.notification_groups
  for select to authenticated
  using (organization_id = public.current_org_id() or public.is_staff());

drop policy if exists claim_insert on public.notification_groups;
create policy claim_insert on public.notification_groups
  for insert to authenticated
  with check (organization_id = public.current_org_id() or public.is_staff());

drop policy if exists claim_update on public.notification_groups;
create policy claim_update on public.notification_groups
  for update to authenticated
  using (organization_id = public.current_org_id() or public.is_staff())
  with check (organization_id = public.current_org_id() or public.is_staff());

drop policy if exists claim_delete on public.notification_groups;
create policy claim_delete on public.notification_groups
  for delete to authenticated
  using (organization_id = public.current_org_id() or public.is_staff());
