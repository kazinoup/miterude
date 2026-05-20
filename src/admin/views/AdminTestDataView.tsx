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
import { useEffect, useMemo, useState } from 'react'
import { Database, Loader2, Trash2, Wand2 } from 'lucide-react'
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

export function AdminTestDataView() {
  const [orgs, setOrgs] = useState<Organization[]>([])
  const [orgsLoading, setOrgsLoading] = useState(true)
  const [orgId, setOrgId] = useState<string>('')
  const [scenario, setScenario] = useState<Scenario>('normal')
  const [sensorCount, setSensorCount] = useState(5)
  const [days, setDays] = useState(7)
  const [clearExisting, setClearExisting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [lastResult, setLastResult] = useState<SeedResult | null>(null)

  useEffect(() => {
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
  }, [])

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
        </div>

        {lastResult && (
          <pre className="test-data-result">
            {JSON.stringify(lastResult, null, 2)}
          </pre>
        )}
      </section>
    </div>
  )
}
