-- Admin Console から「受信した Webhook」を表示するため、anon に SELECT を許可する。
-- 暫定（Phase F-1 と同様）— Clerk + 本番 RLS で組織スコープに絞る予定。

do $$
begin
  if not exists (
    select 1 from pg_policy
    where polrelid = 'public.webhook_inbox'::regclass and polname = 'webhook_inbox select tmp'
  ) then
    create policy "webhook_inbox select tmp"
      on public.webhook_inbox for select
      using (true);
  end if;
end$$;
