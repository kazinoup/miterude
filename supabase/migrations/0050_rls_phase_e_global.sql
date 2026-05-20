-- =====================================================================
-- 0050: β-1 Phase E — グローバル + 暫定撤去
--
-- 対象:
--   - manual_categories / manual_pages  (全認証 read / super_admin write)
--   - manual-images storage bucket      (public read / super_admin write)
--   - webhook_inbox                     (is_staff SELECT、書込は service_role のみ)
--
-- report_delivery_links は PublicReportView が anon 直 SELECT を残しているため、
-- 先に share-report Edge Function 化（別チケット）を済ませてから厳格化する。
--
-- ※ 0028 の暫定方針コメント末尾「Phase 6 で厳格化」をここで実施。
-- =====================================================================

-- ---------- manual_categories / manual_pages ----------
do $$
declare t text;
declare tables text[] := array['manual_categories','manual_pages'];
begin
  foreach t in array tables loop
    execute format('drop policy if exists "%s read" on public.%I', t, t);
    execute format('drop policy if exists "%s write tmp" on public.%I', t, t);
    execute format('drop policy if exists claim_select on public.%I', t);
    execute format('drop policy if exists claim_write on public.%I', t);

    -- 全認証ユーザーが read（テナント・staff 共に同一コンテンツ）
    execute format(
      'create policy claim_select on public.%I for select to authenticated using (true)',
      t
    );
    -- 書込は super_admin のみ
    execute format(
      'create policy claim_insert on public.%I for insert to authenticated with check (public.is_super_admin())',
      t
    );
    execute format(
      'create policy claim_update on public.%I for update to authenticated using (public.is_super_admin()) with check (public.is_super_admin())',
      t
    );
    execute format(
      'create policy claim_delete on public.%I for delete to authenticated using (public.is_super_admin())',
      t
    );
  end loop;
end$$;

-- ---------- manual-images storage bucket（read public / write super_admin） ----------
drop policy if exists "manual-images write"  on storage.objects;
drop policy if exists "manual-images update" on storage.objects;
drop policy if exists "manual-images delete" on storage.objects;

create policy "manual-images write"
  on storage.objects for insert
  with check (bucket_id = 'manual-images' and public.is_super_admin());

create policy "manual-images update"
  on storage.objects for update
  using (bucket_id = 'manual-images' and public.is_super_admin());

create policy "manual-images delete"
  on storage.objects for delete
  using (bucket_id = 'manual-images' and public.is_super_admin());
-- read は 0028 の anon 含む select policy をそのまま残す（公開バケット）

-- ---------- webhook_inbox ----------
-- 旧 "webhook_inbox select tmp" を撤去し、staff のみ閲覧可に。
-- 書込は webhook-milesight EF（service_role）のみ＝ bypassrls で許可済。
drop policy if exists "webhook_inbox select tmp" on public.webhook_inbox;
drop policy if exists claim_select on public.webhook_inbox;

create policy claim_select on public.webhook_inbox
  for select to authenticated
  using (public.is_staff());
-- INSERT/UPDATE/DELETE は付与しない（service_role のみが書ける）
