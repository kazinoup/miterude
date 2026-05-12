-- Phase 1.7a: pg_cron で dispatch-notifications を 1 分おきに起動する
--
-- 認証は project anon key（公開 JWT）を Authorization に渡して通す。
-- 実 DB 操作は Edge Function 内で service_role を使うので、anon でゲートを通すだけで OK。
--
-- 失敗・遅延はあくまで通知配信側で吸収する（dispatch-notifications が retry を持つ）。

-- 既存ジョブがあれば一度落とす（再適用しやすくするため）
do $$
begin
  if exists (select 1 from cron.job where jobname = 'dispatch-notifications-every-min') then
    perform cron.unschedule('dispatch-notifications-every-min');
  end if;
end$$;

select cron.schedule(
  'dispatch-notifications-every-min',
  '* * * * *',
  $cron$
    select net.http_post(
      url := 'https://kktwzllydtlsoahvdhzl.supabase.co/functions/v1/dispatch-notifications',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtrdHd6bGx5ZHRsc29haHZkaHpsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg0MzYzODIsImV4cCI6MjA5NDAxMjM4Mn0.TXcNZVMDZ-G4W-v4yOPwP5IU5FQLYFkCLEJ9t_YAJcA'
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 30000
    ) as request_id;
  $cron$
);
