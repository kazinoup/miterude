-- Phase 1.7a: 通知配信履歴テーブル
-- ============================================================
-- アラート発生 → 通知グループ → 各 channel への送信を 1 行ずつ記録する。
-- 即時 (immediate) も batch (1h/6h/12h/24h) も同じテーブル。送るタイミングは
-- scheduled_for で表現する:
--   - immediate: scheduled_for = now (= 即送信)
--   - batch-1h:  scheduled_for = now + 1h
--   - batch-6h:  scheduled_for = now + 6h
--   - ...
-- pg_cron が 1 分おきに dispatch-notifications を起動し、
-- `status='pending' AND scheduled_for <= now()` を拾って実送信する。

create table public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  alert_log_id uuid not null references public.alert_logs(id) on delete cascade,
  notification_group_id uuid references public.notification_groups(id) on delete set null,
  channel_kind text not null check (channel_kind in ('email', 'slack', 'webhook')),
  /** メールアドレス / Slack Incoming Webhook URL / 任意の Webhook URL */
  target text not null,
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'failed', 'skipped')),
  scheduled_for timestamptz not null default now(),
  attempted_at timestamptz,
  sent_at timestamptz,
  error_message text,
  retry_count integer not null default 0,
  /** Resend のメッセージ ID 等、送信先サービス側の参照キー */
  provider_message_id text,
  created_at timestamptz not null default now()
);

create index notification_deliveries_dispatch_idx
  on public.notification_deliveries (status, scheduled_for)
  where status = 'pending';

create index notification_deliveries_alert_idx
  on public.notification_deliveries (alert_log_id);

create index notification_deliveries_org_created_idx
  on public.notification_deliveries (organization_id, created_at desc);

alter table public.notification_deliveries enable row level security;

create policy "notification_deliveries select"
  on public.notification_deliveries for select
  using (true);

create policy "notification_deliveries write tmp"
  on public.notification_deliveries for all
  using (true)
  with check (true);
