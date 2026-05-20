/**
 * Phase 1.8: 公開レポート閲覧ビュー（/share/report/<token>）
 *
 * メールに記載された配信リンクから、ログイン不要で開かれるページ。
 * `report_delivery_links.token` で該当行を引いて、
 * 期間 / 対象センサー / 組織名を取得し、既存の ReportPreview を流用して
 * センサーごとに描画する。ブラウザの「印刷 → PDF として保存」で PDF 化する想定。
 */
import { useEffect, useMemo, useState } from 'react'
import { Printer, FileBarChart2 } from 'lucide-react'
import { ReportPreview } from '../ReportPreview'
import type {
  ReportKind,
  SensorReading,
  SensorThresholds,
  YearMonth,
} from '../../types'

type LinkRow = {
  id: string
  organization_id: string
  schedule_id: string
  report_kind: ReportKind
  period_start: string // YYYY-MM-DD
  period_end: string
  target_sensor_ids: string[] | null
  expires_at: string | null
}

type OrgRow = { id: string; name: string }

type SensorMeta = {
  id: string
  name: string | null
  device_number: string | null
  serial_number: string
  thresholds: SensorThresholds | undefined
}

type Props = { token: string }

/** Supabase の period_start を YearMonth に変換 */
function ymdToYearMonth(ymd: string): YearMonth {
  const [y, m] = ymd.split('-').map((s) => Number(s))
  return { year: y, month: m }
}

/** Supabase の period_start "YYYY-MM-DD" を Date (UTC midnight) に変換 */
function ymdToDate(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map((s) => Number(s))
  return new Date(Date.UTC(y, m - 1, d))
}

export function PublicReportView({ token }: Props) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string>('')
  const [link, setLink] = useState<LinkRow | null>(null)
  const [org, setOrg] = useState<OrgRow | null>(null)
  const [sensors, setSensors] = useState<SensorMeta[]>([])
  /** sensor_id → readings */
  const [readingsBySensor, setReadingsBySensor] = useState<Record<string, SensorReading[]>>({})

  useEffect(() => {
    let cancelled = false
    setStatus('loading')

    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
    if (!supabaseUrl) {
      setStatus('error')
      setError('Supabase URL が設定されていません')
      return
    }

    // β-1 E.5: share-report Edge Function 経由で取得（service_role）。
    // 旧 anon 直 SELECT は claim ベース RLS で塞がれているため EF を経由する。
    fetch(
      `${supabaseUrl}/functions/v1/share-report?token=${encodeURIComponent(token)}`,
    )
      .then(async (r) => {
        const body = await r.json().catch(() => null)
        if (!r.ok || !body?.ok) {
          const msg = body?.error
          if (msg === 'expired') throw new Error('このレポート URL は有効期限が切れています')
          if (msg === 'not-found') throw new Error('指定されたレポート URL は無効です')
          throw new Error(msg ?? `${r.status} ${r.statusText}`)
        }
        if (cancelled) return

        const l = body.link as LinkRow
        const o = body.organization as OrgRow
        const sensorMetas: SensorMeta[] = (body.sensors as Array<{
          id: string
          name: string | null
          device_number: string | null
          serial_number: string
          thresholds: SensorThresholds | null
        }>).map((s) => ({
          id: s.id,
          name: s.name,
          device_number: s.device_number,
          serial_number: s.serial_number,
          thresholds: s.thresholds ?? undefined,
        }))

        const allReadings: Record<string, SensorReading[]> = {}
        const rbs = body.readingsBySensor as Record<string, Array<{
          sensor_id: string
          measured_at: string
          temperature: number | null
          humidity: number | null
          battery: number | null
        }>>
        for (const [sid, rows] of Object.entries(rbs ?? {})) {
          const list: SensorReading[] = []
          for (const r of rows) {
            if (r.temperature == null && r.humidity == null) continue
            list.push({
              deviceId: r.sensor_id,
              measuredAt: new Date(r.measured_at),
              temperature: r.temperature ?? NaN,
              humidity: r.humidity ?? NaN,
              battery: r.battery ?? undefined,
            })
          }
          allReadings[sid] = list
        }

        setLink(l)
        setOrg(o)
        setSensors(sensorMetas)
        setReadingsBySensor(allReadings)
        setStatus('ready')
      })
      .catch((e) => {
        if (cancelled) return
        console.error('[public-report] load failed', e)
        setStatus('error')
        setError(e instanceof Error ? e.message : String(e))
      })

    return () => {
      cancelled = true
    }
  }, [token])

  const kindLabel = useMemo(() => {
    if (!link) return ''
    return link.report_kind === 'monthly' ? '月報' : '週報'
  }, [link])

  if (status === 'loading') {
    return (
      <div className="public-report-loading">
        <div className="public-report-loading-inner">
          <FileBarChart2 size={32} />
          <p>レポートを読み込んでいます…</p>
        </div>
      </div>
    )
  }

  if (status === 'error' || !link || !org) {
    return (
      <div className="public-report-loading">
        <div className="public-report-loading-inner">
          <h1>レポートを表示できません</h1>
          <p className="muted">{error || 'URL が無効か、期限切れの可能性があります。'}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="public-report-shell">
      <header className="public-report-head no-print">
        <div className="public-report-head-text">
          <h1>
            <FileBarChart2 size={20} className="head-icon" />
            {org.name} — {kindLabel}
          </h1>
          <p className="muted">
            対象期間: {link.period_start} 〜 {link.period_end} / 対象センサー {sensors.length} 台
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => window.print()}
        >
          <Printer size={14} />
          <span>印刷 / PDF として保存</span>
        </button>
      </header>

      {sensors.length === 0 ? (
        <div className="public-report-empty">対象センサーがありません。</div>
      ) : (
        <div className="public-report-pages">
          {sensors.map((s) => {
            const readings = readingsBySensor[s.id] ?? []
            const label = s.name || s.device_number || s.serial_number
            if (link.report_kind === 'monthly') {
              return (
                <ReportPreview
                  key={s.id}
                  deviceId={s.id}
                  deviceLabel={label}
                  readings={readings}
                  thresholds={s.thresholds}
                  kind="monthly"
                  ym={ymdToYearMonth(link.period_start)}
                />
              )
            }
            return (
              <ReportPreview
                key={s.id}
                deviceId={s.id}
                deviceLabel={label}
                readings={readings}
                thresholds={s.thresholds}
                kind="weekly"
                weekStart={ymdToDate(link.period_start)}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
