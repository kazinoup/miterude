-- =====================================================================
-- 0051: β-1 E.5 完了 — report_delivery_links を厳格化
--
-- 公開レポートの参照経路は share-report Edge Function（service_role）に
-- 切替済（β-1 E.5、PublicReportView を 0050 直後に修正）。anon の直
-- SELECT は不要になったため、旧 *_tmp policy を撤去し、SELECT を
-- is_staff() のみに絞る。書込は service_role（dispatch-report-schedules）
-- のみで bypassrls により付与不要。
-- =====================================================================

drop policy if exists "report_delivery_links select tmp"       on public.report_delivery_links;
drop policy if exists "report_delivery_links service write tmp" on public.report_delivery_links;
drop policy if exists claim_select on public.report_delivery_links;

create policy claim_select on public.report_delivery_links
  for select to authenticated
  using (public.is_staff());
-- INSERT/UPDATE/DELETE は付与しない（service_role のみが書ける）
