-- Phase 1.8: レポート定期配信
--
-- report_schedules: 週次 / 月次レポートの配信設定。
-- report_delivery_links: 各回配信ごとに発行されるランダムトークン付き URL。
-- 公開ビュー (/share/report/<token>) はこのトークンで該当行を SELECT し、
-- そこに格納された組織 / 期間 / 対象センサーを読んで描画する。

create table public.report_schedules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  enabled boolean not null default true,
  /** weekly | monthly */
  report_kind text not null check (report_kind in ('weekly', 'monthly')),
  /** UUID 配列。空ならテナント内の全センサー扱い */
  target_sensor_ids uuid[] not null default '{}',
  notification_group_id uuid references public.notification_groups(id) on delete set null,
  /** "HH:MM"（24h JST 想定） */
  delivery_time text not null default '09:00',
  /** weekly のみ参照: 0=日, 1=月, ..., 6=土 */
  weekly_day_of_week int check (weekly_day_of_week between 0 and 6),
  /** monthly のみ参照: 1..28 */
  monthly_day_of_month int check (monthly_day_of_month between 1 and 28),
  /** 「直近送った期間」を 'YYYY-MM' / 'YYYY-Www' などで持つ。重複配信防止用。 */
  last_dispatched_period_key text,
  last_dispatched_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index report_schedules_org_idx on public.report_schedules (organization_id);
create index report_schedules_enabled_idx on public.report_schedules (enabled) where enabled = true;

alter table public.report_schedules enable row level security;
create policy "report_schedules all tmp"
  on public.report_schedules for all
  using (true) with check (true);

-- ---------- 配信ごとに発行されるトークン付きリンク ----------

create table public.report_delivery_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  schedule_id uuid not null references public.report_schedules(id) on delete cascade,
  /** URL に乗る公開トークン。UUID で十分に推測困難。 */
  token uuid not null unique default gen_random_uuid(),
  /** weekly | monthly */
  report_kind text not null check (report_kind in ('weekly', 'monthly')),
  /** 集計対象期間（inclusive 〜 inclusive） */
  period_start date not null,
  period_end date not null,
  /** スナップショット時点の対象センサー（schedule が後で変わっても、配布済みリンクは固定） */
  target_sensor_ids uuid[] not null default '{}',
  /** 任意。null なら有効期限なし。 */
  expires_at timestamptz,
  /** 監査用 */
  last_viewed_at timestamptz,
  view_count integer not null default 0,
  created_at timestamptz not null default now()
);

create index report_delivery_links_token_idx on public.report_delivery_links (token);
create index report_delivery_links_schedule_idx on public.report_delivery_links (schedule_id, created_at desc);

alter table public.report_delivery_links enable row level security;
-- 公開ビュー（未ログイン）から token で SELECT できるよう permissive にする。
-- INSERT / UPDATE は service_role でのみ行う想定。
create policy "report_delivery_links select tmp"
  on public.report_delivery_links for select
  using (true);
create policy "report_delivery_links service write tmp"
  on public.report_delivery_links for all
  using (true) with check (true);

-- updated_at の自動更新
create or replace function public.set_report_schedules_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_report_schedules_updated_at
  before update on public.report_schedules
  for each row execute function public.set_report_schedules_updated_at();
