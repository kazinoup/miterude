-- C1 (リファクタ第2弾): fetchLatestReadings の 1000 件 truncation 解消
--
-- 旧実装: sensor_readings を .in(sensor_ids).order(measured_at desc).limit(N*10)
--   → PostgREST max_rows=1000 で切られ、測定頻度の高いセンサーが上位を
--     占めると下位センサーの最新値が 0 行になり恒常欠落（100台超で顕在化）。
--
-- 新実装: DISTINCT ON (sensor_id) で「各センサーの最新 1 行」のみ返す。
--   戻り行数 = センサー数に圧縮されるため 1000 件制限に当たらない。
--   sensor_readings_sensor_time_idx (sensor_id, measured_at desc) を使う。
--
-- security: 明示しない = SECURITY INVOKER。呼び出しロール（anon）の RLS が
--   効くため、β-1 で RLS を厳格化すれば本関数も自動的に追従する。

create or replace function public.get_latest_readings(
  p_org_id uuid,
  p_sensor_ids uuid[]
)
returns table (
  sensor_id uuid,
  measured_at timestamptz,
  temperature numeric,
  humidity numeric
)
language sql
stable
as $$
  select distinct on (sr.sensor_id)
    sr.sensor_id, sr.measured_at, sr.temperature, sr.humidity
  from public.sensor_readings sr
  where sr.organization_id = p_org_id
    and sr.sensor_id = any(p_sensor_ids)
  order by sr.sensor_id, sr.measured_at desc
$$;

comment on function public.get_latest_readings(uuid, uuid[]) is
  '各センサーの最新計測値を1クエリで返す（DISTINCT ON）。fetchLatestReadings の 1000件 truncation 対策。SECURITY INVOKER で RLS に従う。';

grant execute on function public.get_latest_readings(uuid, uuid[])
  to anon, authenticated;
