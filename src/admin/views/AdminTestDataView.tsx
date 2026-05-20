/**
 * β-7e: テストデータ投入ビュー（super_admin 専用）
 *
 * Edge Function `seed-test-data` を Admin から呼び出して、選択した
 * テナントに 4 シナリオのテストデータ（devices + readings、+ deviation/
 * offline/battery アラート相当の値）を生成する。
 *
 * 関連: supabase/functions/seed-test-data/index.ts（β-7a）
 *      β-7b で pg_cron が同 EF を自動呼出予定
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Database,
  FileUp,
  Loader2,
  ShieldAlert,
  Trash2,
  Wand2,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { fetchOrganizationsList } from '../../lib/supabaseQueries'
import { toast } from '../../lib/toast'
import type { Organization } from '../../types'

type Scenario = 'normal' | 'with-deviations' | 'with-offline' | 'battery-low'

type SeedResult = {
  ok: boolean
  organization_id?: string
  scenario?: Scenario
  devices_created?: number
  readings_inserted?: number
  days?: number
  sensor_count?: number
  error?: string
}

const SCENARIO_OPTIONS: Array<{ value: Scenario; label: string; desc: string }> = [
  { value: 'normal', label: '正常運用', desc: '全センサーが基準内（5℃/50%RH 周辺）' },
  { value: 'with-deviations', label: '逸脱あり', desc: '1〜2 台が末尾期間で温度閾値外' },
  { value: 'with-offline', label: 'オフライン混入', desc: '1 台が直近 30h 無音' },
  { value: 'battery-low', label: '電池低下', desc: '1 台のバッテリーが 5〜9%' },
]

/** β-7e+: 本番（miterude.cloud apex）では破壊的操作の暴発を防ぐためタブ自体を
 *  ガードする。`VITE_ENABLE_TEST_DATA_TAB=false` で明示的に無効化も可能。 */
function isTestDataEnabled(): { enabled: boolean; reason?: string } {
  if (import.meta.env.VITE_ENABLE_TEST_DATA_TAB === 'false') {
    return { enabled: false, reason: 'VITE_ENABLE_TEST_DATA_TAB=false で無効化されています' }
  }
  if (typeof window !== 'undefined') {
    const host = window.location.hostname
    if (host === 'miterude.cloud' || host === 'www.miterude.cloud') {
      return { enabled: false, reason: '本番ドメイン（miterude.cloud）では無効です' }
    }
  }
  return { enabled: true }
}

type CsvRow = {
  device_id?: string
  device_number?: string
  measured_at: string
  temperature?: number
  humidity?: number
  battery?: number
}

/** 単純な CSV パーサ（ダブルクォート対応の最小限）。改行は \r\n / \n を許容。 */
function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const lines: string[][] = []
  let cur: string[] = []
  let field = ''
  let inQuote = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuote) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else inQuote = false
      } else field += c
      continue
    }
    if (c === '"') {
      inQuote = true
      continue
    }
    if (c === ',') {
      cur.push(field)
      field = ''
      continue
    }
    if (c === '\r') continue
    if (c === '\n') {
      cur.push(field)
      lines.push(cur)
      cur = []
      field = ''
      continue
    }
    field += c
  }
  if (field.length > 0 || cur.length > 0) {
    cur.push(field)
    lines.push(cur)
  }
  const headers = (lines.shift() ?? []).map((h) => h.trim())
  return { headers, rows: lines.filter((r) => r.some((c) => c.trim() !== '')) }
}

/** CSV を { device_id|device_number, measured_at, temperature, humidity, battery } 配列に変換 */
function csvToRows(text: string): { rows: CsvRow[]; errors: string[] } {
  const { headers, rows } = parseCsv(text)
  const idx = {
    device_id: headers.indexOf('device_id'),
    device_number: headers.indexOf('device_number'),
    measured_at: headers.indexOf('measured_at'),
    temperature: headers.indexOf('temperature'),
    humidity: headers.indexOf('humidity'),
    battery: headers.indexOf('battery'),
  }
  const errors: string[] = []
  if (idx.measured_at < 0) errors.push('measured_at 列が必要です')
  if (idx.device_id < 0 && idx.device_number < 0) {
    errors.push('device_id か device_number のどちらかの列が必要です')
  }
  if (errors.length > 0) return { rows: [], errors }
  const parsed: CsvRow[] = []
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]
    const get = (i: number) => (i >= 0 ? (row[i] ?? '').trim() : '')
    const num = (i: number): number | undefined => {
      const v = get(i)
      if (!v) return undefined
      const n = Number(v)
      return Number.isFinite(n) ? n : undefined
    }
    const measured = get(idx.measured_at)
    if (!measured) {
      errors.push(`行 ${r + 2}: measured_at 空`)
      continue
    }
    parsed.push({
      device_id: get(idx.device_id) || undefined,
      device_number: get(idx.device_number) || undefined,
      measured_at: measured,
      temperature: num(idx.temperature),
      humidity: num(idx.humidity),
      battery: num(idx.battery),
    })
  }
  return { rows: parsed, errors }
}

export function AdminTestDataView() {
  const enabledState = useMemo(() => isTestDataEnabled(), [])
  const [orgs, setOrgs] = useState<Organization[]>([])
  const [orgsLoading, setOrgsLoading] = useState(true)
  const [orgId, setOrgId] = useState<string>('')
  const [scenario, setScenario] = useState<Scenario>('normal')
  const [sensorCount, setSensorCount] = useState(5)
  const [days, setDays] = useState(7)
  const [clearExisting, setClearExisting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [lastResult, setLastResult] = useState<SeedResult | null>(null)
  // CSV import
  const [csvRows, setCsvRows] = useState<CsvRow[]>([])
  const [csvErrors, setCsvErrors] = useState<string[]>([])
  const [csvFileName, setCsvFileName] = useState<string>('')
  const [csvBusy, setCsvBusy] = useState(false)
  const [csvResult, setCsvResult] = useState<unknown>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!enabledState.enabled) return
    let mounted = true
    fetchOrganizationsList()
      .then((list) => {
        if (!mounted) return
        const sorted = [...list].sort((a, b) => a.name.localeCompare(b.name))
        setOrgs(sorted)
        if (sorted[0]) setOrgId(sorted[0].id)
      })
      .catch((e) => {
        console.warn('[admin-test-data] orgs load failed', e)
        toast('テナント一覧の取得に失敗しました', 'error')
      })
      .finally(() => {
        if (mounted) setOrgsLoading(false)
      })
    return () => {
      mounted = false
    }
  }, [enabledState.enabled])

  const selectedOrg = useMemo(
    () => orgs.find((o) => o.id === orgId) ?? null,
    [orgs, orgId],
  )

  async function callSeed(clear: boolean) {
    if (!orgId) {
      toast('テナントを選択してください', 'error')
      return
    }
    setBusy(true)
    setLastResult(null)
    try {
      const { data, error } = await supabase.functions.invoke<SeedResult>(
        'seed-test-data',
        {
          body: {
            organization_id: orgId,
            scenario,
            sensor_count: sensorCount,
            days,
            clear_existing: clear,
          },
        },
      )
      if (error) {
        const result: SeedResult = { ok: false, error: error.message }
        setLastResult(result)
        toast(`投入に失敗: ${error.message}`, 'error')
        return
      }
      if (!data?.ok) {
        setLastResult(data ?? { ok: false, error: 'no-response' })
        toast(`投入に失敗: ${data?.error ?? '不明'}`, 'error')
        return
      }
      setLastResult(data)
      toast(
        `${data.devices_created} 台 / ${data.readings_inserted} 件を投入しました`,
        'success',
      )
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      setLastResult({ ok: false, error: message })
      toast(`投入で例外: ${message}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  /** β-7e+: seed_test 全消去（投入なし） */
  async function callClearOnly() {
    if (!orgId) {
      toast('テナントを選択してください', 'error')
      return
    }
    if (
      !confirm(
        `${selectedOrg?.name ?? 'このテナント'} の seed_test マーク付き devices/readings をすべて削除します。元に戻せません。`,
      )
    ) {
      return
    }
    setBusy(true)
    try {
      const { data, error } = await supabase.functions.invoke<SeedResult & { mode?: string; devices_cleared?: number }>(
        'seed-test-data',
        { body: { organization_id: orgId, clear_only: true } },
      )
      if (error) {
        toast(`消去に失敗: ${error.message}`, 'error')
        setLastResult({ ok: false, error: error.message })
        return
      }
      setLastResult(data ?? null)
      toast(
        data?.ok
          ? `${(data as { devices_cleared?: number }).devices_cleared ?? 0} 台を削除しました`
          : `消去失敗: ${data?.error ?? '不明'}`,
        data?.ok ? 'success' : 'error',
      )
    } catch (e) {
      toast(`消去で例外: ${e instanceof Error ? e.message : String(e)}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  /** β-7e+: CSV ファイル選択 → パース → state へ格納 */
  function onCsvSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    setCsvFileName(f.name)
    setCsvErrors([])
    setCsvRows([])
    setCsvResult(null)
    const reader = new FileReader()
    reader.onload = () => {
      const text = String(reader.result ?? '')
      const { rows, errors } = csvToRows(text)
      setCsvRows(rows)
      setCsvErrors(errors)
    }
    reader.onerror = () => {
      setCsvErrors(['ファイルの読み込みに失敗しました'])
    }
    reader.readAsText(f)
  }

  async function callImportCsv() {
    if (!orgId) {
      toast('テナントを選択してください', 'error')
      return
    }
    if (csvRows.length === 0) {
      toast('投入する行がありません', 'error')
      return
    }
    if (csvErrors.length > 0) {
      if (!confirm(`${csvErrors.length} 件のパース警告があります。続行しますか？`)) return
    }
    setCsvBusy(true)
    setCsvResult(null)
    try {
      const { data, error } = await supabase.functions.invoke('import-csv-readings', {
        body: { organization_id: orgId, rows: csvRows },
      })
      if (error) {
        setCsvResult({ ok: false, error: error.message })
        toast(`CSV 投入失敗: ${error.message}`, 'error')
        return
      }
      setCsvResult(data)
      const inserted = (data as { inserted?: number })?.inserted ?? 0
      const skipped = (data as { skipped?: number })?.skipped ?? 0
      toast(
        `CSV: ${inserted} 件投入 / ${skipped} 件スキップ`,
        inserted > 0 ? 'success' : 'info',
      )
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setCsvResult({ ok: false, error: msg })
      toast(`CSV 投入で例外: ${msg}`, 'error')
    } finally {
      setCsvBusy(false)
    }
  }

  if (!enabledState.enabled) {
    return (
      <div className="admin-page admin-test-data-page">
        <header className="admin-page-head">
          <h1 className="admin-page-title">
            <Database size={20} /> テストデータ投入
          </h1>
        </header>
        <section className="admin-card test-data-disabled">
          <div className="test-data-disabled-icon">
            <ShieldAlert size={32} />
          </div>
          <h2>この環境では無効化されています</h2>
          <p className="muted">{enabledState.reason ?? '本番環境ではテストデータ投入は実行できません。'}</p>
        </section>
      </div>
    )
  }

  return (
    <div className="admin-page admin-test-data-page">
      <header className="admin-page-head">
        <h1 className="admin-page-title">
          <Database size={20} /> テストデータ投入
        </h1>
        <p className="admin-page-sub muted">
          検証用のセンサー・計測値を選んだテナントへ生成します。
          super_admin 専用。`metadata.seed_test=true` のマーカーで管理し、
          「既存テストデータを掃除してから投入」で再生成できます。
        </p>
      </header>

      <section className="admin-card test-data-form">
        <div className="form-row">
          <label className="form-label" htmlFor="td-org">対象テナント</label>
          {orgsLoading ? (
            <div className="muted">テナント一覧を取得中…</div>
          ) : (
            <select
              id="td-org"
              className="select"
              value={orgId}
              onChange={(e) => setOrgId(e.target.value)}
              disabled={busy}
            >
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}（{o.slug ?? o.id.slice(0, 8)}）
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="form-row">
          <span className="form-label">シナリオ</span>
          <div className="test-data-scenario-grid">
            {SCENARIO_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className={`test-data-scenario-card ${scenario === opt.value ? 'is-active' : ''}`}
              >
                <input
                  type="radio"
                  name="td-scenario"
                  value={opt.value}
                  checked={scenario === opt.value}
                  onChange={() => setScenario(opt.value)}
                  disabled={busy}
                />
                <div className="test-data-scenario-text">
                  <div className="test-data-scenario-label">{opt.label}</div>
                  <div className="test-data-scenario-desc muted">{opt.desc}</div>
                </div>
              </label>
            ))}
          </div>
        </div>

        <div className="form-row form-row-inline">
          <div className="form-col">
            <label className="form-label" htmlFor="td-count">センサー台数</label>
            <input
              id="td-count"
              type="number"
              className="form-input"
              min={1}
              max={20}
              value={sensorCount}
              onChange={(e) => setSensorCount(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
              disabled={busy}
            />
          </div>
          <div className="form-col">
            <label className="form-label" htmlFor="td-days">過去日数</label>
            <input
              id="td-days"
              type="number"
              className="form-input"
              min={1}
              max={30}
              value={days}
              onChange={(e) => setDays(Math.max(1, Math.min(30, Number(e.target.value) || 1)))}
              disabled={busy}
            />
          </div>
        </div>

        <div className="form-row">
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={clearExisting}
              onChange={(e) => setClearExisting(e.target.checked)}
              disabled={busy}
            />
            <span>既存のテストデータ（seed_test マーク）を先に削除する</span>
          </label>
        </div>

        <div className="test-data-actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !orgId}
            onClick={() => callSeed(clearExisting)}
          >
            {busy ? <Loader2 size={14} className="spin" /> : <Wand2 size={14} />}
            <span>投入</span>
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy || !orgId}
            onClick={() => {
              if (!confirm(`${selectedOrg?.name ?? 'このテナント'} の既存テストデータ（seed_test マーク）を削除します。よろしいですか？`)) return
              setClearExisting(true)
              void callSeed(true)
            }}
            title="既存テストデータを削除して再投入"
          >
            <Trash2 size={14} />
            <span>クリア + 再投入</span>
          </button>
          <button
            type="button"
            className="btn btn-ghost test-data-danger"
            disabled={busy || !orgId}
            onClick={() => void callClearOnly()}
            title="seed_test マークの devices/readings を全削除（投入なし）"
          >
            <Trash2 size={14} />
            <span>seed_test を全消去</span>
          </button>
        </div>

        {lastResult && (
          <pre className="test-data-result">
            {JSON.stringify(lastResult, null, 2)}
          </pre>
        )}
      </section>

      {/* β-7e+: CSV import */}
      <section className="admin-card test-data-form" style={{ marginTop: '1rem' }}>
        <h2 className="admin-page-title" style={{ fontSize: '1.05rem' }}>
          <FileUp size={18} /> CSV から sensor_readings を投入
        </h2>
        <p className="muted" style={{ marginTop: '-0.2rem' }}>
          ヘッダ: <code>device_id</code> または <code>device_number</code> /{' '}
          <code>measured_at</code>（ISO 形式） / <code>temperature</code> /{' '}
          <code>humidity</code> / <code>battery</code>。
          選択中のテナントに紐づく device のみ取り込み、組織違いは自動でスキップします。
        </p>

        <div className="form-row">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={onCsvSelected}
            disabled={csvBusy}
          />
        </div>

        {csvFileName && (
          <div className="form-row muted small">
            選択中: {csvFileName} ／ パース成功 {csvRows.length} 行
            {csvErrors.length > 0 && ` ／ 警告 ${csvErrors.length} 件`}
          </div>
        )}

        {csvErrors.length > 0 && (
          <div className="test-data-csv-warn">
            <AlertTriangle size={14} />
            <details>
              <summary>{csvErrors.length} 件のパース警告</summary>
              <ul>
                {csvErrors.slice(0, 50).map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
                {csvErrors.length > 50 && <li>… ほか {csvErrors.length - 50} 件</li>}
              </ul>
            </details>
          </div>
        )}

        <div className="test-data-actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={csvBusy || !orgId || csvRows.length === 0}
            onClick={() => void callImportCsv()}
          >
            {csvBusy ? <Loader2 size={14} className="spin" /> : <FileUp size={14} />}
            <span>CSV を投入（{csvRows.length} 行）</span>
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={csvBusy}
            onClick={() => {
              if (fileInputRef.current) fileInputRef.current.value = ''
              setCsvFileName('')
              setCsvRows([])
              setCsvErrors([])
              setCsvResult(null)
            }}
          >
            <span>クリア</span>
          </button>
        </div>

        {csvResult ? (
          <pre className="test-data-result">{JSON.stringify(csvResult, null, 2)}</pre>
        ) : null}
      </section>
    </div>
  )
}
