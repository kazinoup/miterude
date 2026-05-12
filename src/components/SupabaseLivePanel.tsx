/**
 * Supabase ライブ状況パネル — Phase G (Block A)
 *
 * Supabase の `devices` + `sensor_readings` を読み取り、デモ組織で
 * Webhook 経由に届いているリアルタイムのセンサー値を表示する。
 * 既存の localStorage ベース UI とは独立して動作し、まずは「Webhook → DB → UI」
 * の往復が成立していることを目視確認するためのもの。
 */
import { useCallback, useEffect, useState } from 'react'
import { RefreshCcw, Wifi, WifiOff, AlertCircle } from 'lucide-react'
import {
  fetchSensorDevices,
  fetchLatestReadings,
  type SupabaseDeviceRow,
  type LatestReading,
} from '../lib/supabaseQueries'
import { isSupabaseConfigured } from '../lib/supabase'
import { formatRelativeAgo } from '../lib/jp'

export function SupabaseLivePanel() {
  const [devices, setDevices] = useState<SupabaseDeviceRow[]>([])
  const [latest, setLatest] = useState<Map<string, LatestReading>>(new Map())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastFetched, setLastFetched] = useState<Date | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const ds = await fetchSensorDevices()
      setDevices(ds)
      const r = await fetchLatestReadings(ds.map((d) => d.id))
      setLatest(r)
      setLastFetched(new Date())
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (isSupabaseConfigured()) load()
  }, [load])

  if (!isSupabaseConfigured()) {
    return (
      <div className="panel-card supabase-live">
        <div className="supabase-live-header">
          <h3>
            <AlertCircle size={16} />
            Supabase ライブ状況
          </h3>
        </div>
        <p className="muted in-panel">
          Supabase の接続情報が未設定です（.env.local の VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY）。
        </p>
      </div>
    )
  }

  return (
    <div className="panel-card supabase-live">
      <div className="supabase-live-header">
        <h3>
          Supabase ライブ状況
          <span className="supabase-live-count">{devices.length} 台</span>
        </h3>
        <div className="supabase-live-meta">
          {lastFetched && (
            <span className="muted">
              更新: {formatRelativeAgo(lastFetched)}
            </span>
          )}
          <button
            type="button"
            className="btn btn-ghost"
            onClick={load}
            disabled={loading}
            title="再取得"
          >
            <RefreshCcw size={14} className={loading ? 'spin' : undefined} />
            <span>{loading ? '取得中…' : '更新'}</span>
          </button>
        </div>
      </div>

      {error && (
        <p className="supabase-live-error">
          <AlertCircle size={14} />
          取得に失敗しました: {error}
        </p>
      )}

      {!error && devices.length === 0 && !loading && (
        <p className="muted in-panel">
          まだ Webhook 経由で登録されたセンサーがありません。
        </p>
      )}

      {devices.length > 0 && (
        <table className="supabase-live-table">
          <thead>
            <tr>
              <th>状態</th>
              <th>device_number</th>
              <th>モデル</th>
              <th>devEUI</th>
              <th>温度</th>
              <th>湿度</th>
              <th>電池</th>
              <th>最終受信</th>
            </tr>
          </thead>
          <tbody>
            {devices.map((d) => {
              const r = latest.get(d.id)
              return (
                <tr key={d.id}>
                  <td>
                    {d.online ? (
                      <span className="badge badge-online">
                        <Wifi size={12} />
                        オンライン
                      </span>
                    ) : (
                      <span className="badge badge-offline">
                        <WifiOff size={12} />
                        オフライン
                      </span>
                    )}
                  </td>
                  <td className="mono">{d.device_number}</td>
                  <td>{d.model}</td>
                  <td className="mono dim">{d.external_key}</td>
                  <td className="num">
                    {r?.temperature != null ? `${r.temperature} ℃` : '—'}
                  </td>
                  <td className="num">
                    {r?.humidity != null ? `${r.humidity} %` : '—'}
                  </td>
                  <td className="num">
                    {d.sensor_props?.battery != null
                      ? `${d.sensor_props.battery}%`
                      : '—'}
                  </td>
                  <td className="dim">
                    {d.last_seen_at
                      ? formatRelativeAgo(new Date(d.last_seen_at))
                      : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}
