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
import { supabase } from '../../lib/supabase'
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

    ;(async () => {
      try {
        // 1) link 行を token で SELECT
        const { data: linkData, error: linkErr } = await supabase
          .from('report_delivery_links')
          .select(
            'id, organization_id, schedule_id, report_kind, period_start, period_end, target_sensor_ids',
          )
          .eq('token', token)
          .maybeSingle()
        if (linkErr) throw new Error(`link: ${linkErr.message}`)
        if (!linkData) throw new Error('指定されたレポート URL は無効です')
        const l = linkData as LinkRow

        // 2) 並列で 組織 + 対象センサー（メタ + thresholds）を取得
        const orgPromise = supabase
          .from('organizations')
          .select('id, name')
          .eq('id', l.organization_id)
          .maybeSingle()

        const targetIds = l.target_sensor_ids ?? []
        const hasTargetIds = targetIds.length > 0
        const sensorsPromise = hasTargetIds
          ? supabase
              .from('devices')
              .select('id, name, device_number, serial_number')
              .in('id', targetIds)
          : supabase
              .from('devices')
              .select('id, name, device_number, serial_number')
              .eq('organization_id', l.organization_id)
              .eq('device_type', 'sensor')

        const [orgRes, devicesRes] = await Promise.all([orgPromise, sensorsPromise])
        if (orgRes.error) throw new Error(`org: ${orgRes.error.message}`)
        if (!orgRes.data) throw new Error('組織が見つかりません')
        if (devicesRes.error) throw new Error(`devices: ${devicesRes.error.message}`)
        const devices = (devicesRes.data ?? []) as Array<{
          id: string
          name: string | null
          device_number: string | null
          serial_number: string
        }>

        // 3) thresholds を sensor_props から取る
        const sensorIds = devices.map((d) => d.id)
        const propsRes = sensorIds.length
          ? await supabase
              .from('sensor_props')
              .select('device_id, thresholds')
              .in('device_id', sensorIds)
          : { data: [], error: null as null | { message: string } }
        if (propsRes.error) throw new Error(`sensor_props: ${propsRes.error.message}`)
        const thresholdsByDevice: Record<string, SensorThresholds | undefined> = {}
        for (const row of (propsRes.data ?? []) as Array<{
          device_id: string
          thresholds: SensorThresholds | null
        }>) {
          thresholdsByDevice[row.device_id] = row.thresholds ?? undefined
        }

        const sensorMetas: SensorMeta[] = devices.map((d) => ({
          id: d.id,
          name: d.name,
          device_number: d.device_number,
          serial_number: d.serial_number,
          thresholds: thresholdsByDevice[d.id],
        }))

        // 4) 対象期間の sensor_readings を取得（センサーごと並列、1000 件単位ページング）
        //    period_end は inclusive なので、翌日 0:00 (UTC 想定) で < に切る
        const periodStartIso = `${l.period_start}T00:00:00+09:00`
        const endDate = ymdToDate(l.period_end)
        endDate.setUTCDate(endDate.getUTCDate() + 1)
        const periodEndIso = endDate.toISOString()

        async function fetchAllReadings(sensorId: string): Promise<SensorReading[]> {
          const PAGE = 1000
          const out: SensorReading[] = []
          let offset = 0
          // eslint-disable-next-line no-constant-condition
          while (true) {
            const { data, error } = await supabase
              .from('sensor_readings')
              .select('sensor_id, measured_at, temperature, humidity, battery')
              .eq('sensor_id', sensorId)
              .gte('measured_at', periodStartIso)
              .lt('measured_at', periodEndIso)
              .order('measured_at', { ascending: true })
              .range(offset, offset + PAGE - 1)
            if (error) throw error
            const rows = data ?? []
            for (const r of rows as Array<{
              sensor_id: string
              measured_at: string
              temperature: number | null
              humidity: number | null
              battery: number | null
            }>) {
              if (r.temperature == null && r.humidity == null) continue
              out.push({
                deviceId: r.sensor_id,
                measuredAt: new Date(r.measured_at),
                temperature: r.temperature ?? NaN,
                humidity: r.humidity ?? NaN,
                battery: r.battery ?? undefined,
              })
            }
            if (rows.length < PAGE) break
            offset += PAGE
          }
          return out
        }

        const allReadings: Record<string, SensorReading[]> = {}
        await Promise.all(
          sensorMetas.map(async (s) => {
            try {
              allReadings[s.id] = await fetchAllReadings(s.id)
            } catch (e) {
              console.warn('[public-report] reading fetch failed', s.id, e)
              allReadings[s.id] = []
            }
          }),
        )

        if (cancelled) return
        setLink(l)
        setOrg(orgRes.data as OrgRow)
        setSensors(sensorMetas)
        setReadingsBySensor(allReadings)
        setStatus('ready')

        // 監査用に view_count を加算（失敗しても本体には影響させない）
        supabase
          .from('report_delivery_links')
          .update({
            last_viewed_at: new Date().toISOString(),
            view_count: 1, // 単純加算: 後で increment 表現に置換可能
          })
          .eq('id', l.id)
          .then(() => undefined)
      } catch (e) {
        if (cancelled) return
        console.error('[public-report] load failed', e)
        setStatus('error')
        setError(e instanceof Error ? e.message : String(e))
      }
    })()

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
