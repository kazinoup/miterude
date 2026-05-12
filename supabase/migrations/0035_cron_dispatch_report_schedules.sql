-- Phase 1.8: pg_cron で dispatch-report-schedules を 1 分おきに起動する。
-- delivery_time の最小精度が "HH:MM" なので、1 分粒度で十分。
-- last_dispatched_period_key の比較で重複起動は Edge Function 側で吸収する。

do $$
begin
  if exists (select 1 from cron.job where jobname = 'dispatch-report-schedules-every-min') then
    perform cron.unschedule('dispatch-report-schedules-every-min');
  end if;
end$$;

select cron.schedule(
  'dispatch-report-schedules-every-min',
  '* * * * *',
  $cron$
    select net.http_post(
      url := 'https://kktwzllydtlsoahvdhzl.supabase.co/functions/v1/dispatch-report-schedules',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtrdHd6bGx5ZHRsc29haHZkaHpsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg0MzYzODIsImV4cCI6MjA5NDAxMjM4Mn0.TXcNZVMDZ-G4W-v4yOPwP5IU5FQLYFkCLEJ9t_YAJcA'
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 30000
    ) as request_id;
  $cron$
);
