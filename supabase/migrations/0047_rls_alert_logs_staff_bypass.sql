-- =====================================================================
-- 0047: β-1 Phase A 補正 — alert_logs に is_staff() バイパスを追加
--
-- AdminDashboardView が直近 24 時間の alert_logs を cross-tenant に
-- 直接 SELECT するため、0045 で導入した SELECT policy（claim のみ）だと
-- 非 impersonation の staff には 0 件返却となり Admin ダッシュボードの
-- 「最近のアラート」セクションが沈黙故障する。
-- SELECT のみ staff バイパスを追加（書き込みはテナント claim に厳格化を維持）。
-- =====================================================================

drop policy if exists claim_select on public.alert_logs;
create policy claim_select on public.alert_logs
  for select to authenticated
  using (organization_id = public.current_org_id() or public.is_staff());
