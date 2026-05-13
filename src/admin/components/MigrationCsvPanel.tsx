/**
 * Phase F-3 (mock 段階): admin の移行 CSV 一括インポートパネル。
 *
 * 配置: Admin Console > テナント詳細 > センサータブ
 * 表示条件: tenant.migrationMode.startedAt && !finishedAt のときのみ
 *
 * 状態遷移（ローカル UI のみ。tenant.migrationMode は永続化される）:
 *   idle    : 「移行モードを開始」ボタン or ドロップゾーン
 *   preview : ドロップ後のプレビュー表（自動マッチ + 手動上書き）
 *   importing: bulk insert 実行中（簡易プログレス）
 *   done    : 結果表示 + 「続ける」「移行を完了」
 */
import { useMemo, useState } from 'react'
import {
  Upload,
  FileText,
  ArrowLeft,
  Check,
  AlertCircle,
  StopCircle,
  RefreshCw,
} from 'lucide-react'
import {
  loadOrganizations,
  logStaffAction,
  saveOrganizations,
  upsertOrganization,
} from '../lib/adminStorage'
import { loadState, saveState, sensorsFromState } from '../../lib/storage'
import { toast } from '../../lib/toast'
import {
  computePreview,
  mergeReadings,
  parseAndMatch,
  type ImportPreview,
  type ImportResult,
  type MatchReason,
  type ParsedFile,
} from '../lib/csvMigration'
import type { Organization, SensorReading, SensorStore } from '../../types'

/* ---------- 外部から呼べるヘルパ: 移行モード開始 ----------
 *
 * 「移行モードを開始」のエントリポイントは SensorsTab のアクションメニューに
 * 置くため、関数として切り出しておく。 */
export function startMigrationMode(
  org: Organization,
  adminUserId: string,
): Organization {
  const orgs = loadOrganizations()
  const next: Organization = {
    ...org,
    migrationMode: { startedAt: new Date() },
  }
  saveOrganizations(upsertOrganization(orgs, next))
  logStaffAction({
    staffUserId: adminUserId,
    organizationId: org.id,
    action: 'migration_started',
    targetTable: 'organizations',
    targetId: org.id,
  })
  toast(`「${org.name}」の移行モードを開始しました`, 'info')
  return next
}

type Props = {
  /** 対象テナント */
  org: Organization
  /** 監査ログ用に admin の userId を渡す */
  adminUserId: string
  /** 状態が変わったら親に再読込みを促す（migrationMode の更新 / インポート反映） */
  onChanged: () => void
}

type Step = 'idle' | 'preview' | 'importing' | 'done'

function reasonLabel(r: MatchReason): string {
  if (r === 'devicenumber') return '自動（番号一致）'
  if (r === 'deveui') return '自動（DevEUI 一致）'
  if (r === 'serial') return '自動（シリアル一致）'
  if (r === 'name') return '自動（名前一致）'
  if (r === 'manual') return '手動'
  return '要選択'
}

function fmtDateTime(d: Date | null): string {
  if (!d) return '—'
  const dt = new Date(d as Date | string | number)
  if (Number.isNaN(dt.getTime())) return '—'
  return `${dt.getFullYear()}/${String(dt.getMonth() + 1).padStart(2, '0')}/${String(dt.getDate()).padStart(2, '0')}`
}

function fmtRange(p: ParsedFile['period']): string {
  if (!p.from || !p.to) return '—'
  return `${fmtDateTime(p.from)} 〜 ${fmtDateTime(p.to)}`
}

export function MigrationCsvPanel({ org, adminUserId, onChanged }: Props) {
  const isActive = !!org.migrationMode?.startedAt && !org.migrationMode?.finishedAt

  const [step, setStep] = useState<Step>('idle')
  const [files, setFiles] = useState<ParsedFile[]>([])
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState({ current: 0, total: 0 })
  const [result, setResult] = useState<ImportResult | null>(null)

  // テナントスコープ state（センサーマスタと既存 readings）
  const tenantState = useMemo(() => loadState(org.id), [org.id])
  const sensors: SensorStore = useMemo(
    () => (tenantState ? sensorsFromState(tenantState) : {}),
    [tenantState],
  )
  const existingByDeviceId: Record<string, SensorReading[]> = useMemo(
    () => tenantState?.devices ?? {},
    [tenantState],
  )

  /* ---------- 移行モードの終了 ---------- */
  // 開始は外部の `startMigrationMode()` ヘルパから（SensorsTab のメニューが呼ぶ）

  function finishMigration() {
    if (!confirm('移行モードを完了しますか？このパネルは表示されなくなります。')) return
    const orgs = loadOrganizations()
    const next: Organization = {
      ...org,
      migrationMode: {
        startedAt: org.migrationMode?.startedAt ?? new Date(),
        finishedAt: new Date(),
      },
    }
    saveOrganizations(upsertOrganization(orgs, next))
    logStaffAction({
      staffUserId: adminUserId,
      organizationId: org.id,
      action: 'migration_finished',
      targetTable: 'organizations',
      targetId: org.id,
    })
    toast('移行モードを完了しました', 'success')
    setStep('idle')
    setFiles([])
    setResult(null)
    onChanged()
  }

  /* ---------- ファイルドロップ ---------- */

  async function handleFiles(list: FileList | null) {
    if (!list || list.length === 0) return
    setBusy(true)
    try {
      const parsed: ParsedFile[] = []
      let i = 0
      for (const file of Array.from(list)) {
        if (!file.name.toLowerCase().endsWith('.csv')) continue
        const p = await parseAndMatch(file, sensors, i++)
        parsed.push(p)
      }
      if (parsed.length === 0) {
        alert('CSV ファイルが見つかりませんでした。')
        return
      }
      setFiles(parsed)
      setStep('preview')
    } finally {
      setBusy(false)
    }
  }

  /* ---------- プレビュー時の編集 ---------- */

  function setSelected(key: string, sensorId: string | 'skip' | null) {
    setFiles((prev) =>
      prev.map((f) =>
        f.key === key
          ? {
              ...f,
              selectedSensorId: sensorId,
              matchReason:
                sensorId === f.suggestedSensorId
                  ? f.matchReason
                  : sensorId === 'skip' || sensorId === null
                    ? f.matchReason
                    : 'manual',
            }
          : f,
      ),
    )
  }

  function removeFile(key: string) {
    setFiles((prev) => prev.filter((f) => f.key !== key))
  }

  /* ---------- 取り込み実行 ---------- */

  const preview: ImportPreview = useMemo(
    () => computePreview(files, existingByDeviceId),
    [files, existingByDeviceId],
  )
  const canCommit =
    preview.fileCount > 0 && preview.pendingFiles === 0 && !busy

  async function commitImport() {
    if (!canCommit) return
    setStep('importing')
    setBusy(true)
    setProgress({ current: 0, total: preview.fileCount })

    try {
      const state = loadState(org.id)
      if (!state) {
        alert('テナントの状態が読み込めませんでした。')
        setStep('preview')
        setBusy(false)
        return
      }
      let totalAdded = 0
      let totalSkipped = 0
      const unresolved: string[] = []
      const updatedDevices = { ...state.devices }

      let idx = 0
      for (const f of files) {
        if (f.parseError) continue
        if (f.selectedSensorId === null) {
          unresolved.push(f.filename)
          continue
        }
        if (f.selectedSensorId === 'skip') continue

        const sensorId = f.selectedSensorId
        const existing = updatedDevices[sensorId] ?? []
        const { merged, added, skipped } = mergeReadings(
          existing,
          f.readings,
          sensorId,
        )
        updatedDevices[sensorId] = merged
        totalAdded += added
        totalSkipped += skipped
        idx++
        setProgress({ current: idx, total: preview.fileCount })
        // 体感プログレス用に微小な await
        await new Promise((r) => setTimeout(r, 50))
      }

      // 永続化（saveState は (state, organizationId) の順）
      saveState({ ...state, devices: updatedDevices }, org.id)

      // 監査ログ
      logStaffAction({
        staffUserId: adminUserId,
        organizationId: org.id,
        action: 'csv_import_by_admin',
        targetTable: 'sensor_readings',
        metadata: {
          fileCount: preview.fileCount,
          rowsAdded: totalAdded,
          rowsSkipped: totalSkipped,
        },
      })

      setResult({
        fileCount: preview.fileCount,
        rowsAdded: totalAdded,
        rowsSkipped: totalSkipped,
        unresolvedFiles: unresolved,
      })
      setStep('done')
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  /* ---------- 描画 ----------
   * 移行モード OFF の場合は **何も描画しない**。
   * 開始エントリポイントは SensorsTab のアクションメニューに置かれている。 */
  if (!isActive) return null

  return (
    <div className="migration-panel migration-panel-active">
      <header className="migration-head">
        <div>
          <h3>
            <Upload size={16} className="inline-icon" /> 移行 CSV インポート
          </h3>
          <small className="muted">
            移行モード中：開始 {fmtDateTime(org.migrationMode?.startedAt ?? null)}
          </small>
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-sm migration-finish-btn"
          onClick={finishMigration}
          disabled={busy}
        >
          <StopCircle size={14} />
          <span>移行モードを完了</span>
        </button>
      </header>

      {step === 'idle' && <DropZone onFiles={handleFiles} busy={busy} />}

      {step === 'preview' && (
        <PreviewView
          files={files}
          sensors={sensors}
          preview={preview}
          canCommit={canCommit}
          onSetSelected={setSelected}
          onRemove={removeFile}
          onAddMore={() => setStep('idle')}
          onCommit={commitImport}
          onBack={() => {
            setFiles([])
            setStep('idle')
          }}
        />
      )}

      {step === 'importing' && (
        <ImportingView current={progress.current} total={progress.total} />
      )}

      {step === 'done' && result && (
        <DoneView
          result={result}
          onContinue={() => {
            setFiles([])
            setResult(null)
            setStep('idle')
          }}
          onFinishMigration={finishMigration}
        />
      )}
    </div>
  )
}

/* ===== サブコンポーネント ===== */

function DropZone({
  onFiles,
  busy,
}: {
  onFiles: (list: FileList | null) => void
  busy: boolean
}) {
  const [hover, setHover] = useState(false)
  return (
    <div
      className={`migration-drop ${hover ? 'is-hover' : ''} ${busy ? 'is-busy' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        setHover(true)
      }}
      onDragLeave={() => setHover(false)}
      onDrop={(e) => {
        e.preventDefault()
        setHover(false)
        onFiles(e.dataTransfer.files)
      }}
    >
      <Upload size={28} />
      <div className="migration-drop-title">
        CSV ファイルをここにドロップ
      </div>
      <div className="migration-drop-sub">
        複数ファイル同時 OK / 1 ファイル = 1 センサーぶんの履歴
      </div>
      <label className="btn btn-secondary btn-sm migration-pick-btn">
        <input
          type="file"
          accept=".csv,text/csv"
          multiple
          hidden
          onChange={(e) => {
            onFiles(e.target.files)
            e.target.value = ''
          }}
        />
        <span>ファイルを選択</span>
      </label>
      {busy && (
        <div className="migration-drop-busy">
          <RefreshCw size={14} className="spinning" /> 解析中…
        </div>
      )}
    </div>
  )
}

function PreviewView({
  files,
  sensors,
  preview,
  canCommit,
  onSetSelected,
  onRemove,
  onAddMore,
  onCommit,
  onBack,
}: {
  files: ParsedFile[]
  sensors: SensorStore
  preview: ImportPreview
  canCommit: boolean
  onSetSelected: (key: string, sensorId: string | 'skip' | null) => void
  onRemove: (key: string) => void
  onAddMore: () => void
  onCommit: () => void
  onBack: () => void
}) {
  const sensorOptions = useMemo(
    () =>
      Object.values(sensors).sort((a, b) =>
        a.deviceNumber.localeCompare(b.deviceNumber),
      ),
    [sensors],
  )

  return (
    <div className="migration-preview">
      <div className="migration-preview-summary">
        <div>
          <strong>{files.length} ファイル</strong> 中{' '}
          <strong>{preview.fileCount}</strong> 件を取り込み予定
          {preview.skippedFiles > 0 && (
            <span className="muted"> ・ {preview.skippedFiles} 件スキップ</span>
          )}
          {preview.pendingFiles > 0 && (
            <span className="warn"> ・ {preview.pendingFiles} 件未選択</span>
          )}
        </div>
        <div className="muted">
          新規 <strong>{preview.rowsToAdd.toLocaleString()}</strong> 行 / 重複
          <strong> {preview.rowsToSkip.toLocaleString()}</strong> 行は skip
        </div>
      </div>

      <div className="migration-table-wrap">
        <table className="migration-table">
          <thead>
            <tr>
              <th>ファイル名</th>
              <th>期間</th>
              <th>行数</th>
              <th>対象センサー</th>
              <th>状態</th>
              <th aria-label="削除" />
            </tr>
          </thead>
          <tbody>
            {files.map((f) => {
              const target = f.selectedSensorId
              const stateLabel: { text: string; className: string } =
                f.parseError
                  ? { text: 'パース失敗', className: 'is-error' }
                  : target === null
                    ? { text: '要選択', className: 'is-warn' }
                    : target === 'skip'
                      ? { text: 'スキップ', className: 'is-muted' }
                      : { text: reasonLabel(f.matchReason), className: 'is-ok' }
              return (
                <tr key={f.key}>
                  <td className="migration-file">
                    <FileText size={13} className="inline-icon" />
                    <span className="migration-file-name">{f.filename}</span>
                  </td>
                  <td className="migration-period">{fmtRange(f.period)}</td>
                  <td className="num">
                    {f.parseError ? '—' : f.readings.length.toLocaleString()}
                  </td>
                  <td>
                    {f.parseError ? (
                      <span className="muted">—</span>
                    ) : (
                      <select
                        className="select"
                        value={target ?? ''}
                        onChange={(e) => {
                          const v = e.target.value
                          if (v === '') onSetSelected(f.key, null)
                          else if (v === 'skip') onSetSelected(f.key, 'skip')
                          else onSetSelected(f.key, v)
                        }}
                      >
                        <option value="">選択してください</option>
                        <option value="skip">— スキップ</option>
                        {sensorOptions.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.deviceNumber} ・ {s.name ?? '(未設定)'}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td>
                    <span className={`migration-state ${stateLabel.className}`}>
                      {stateLabel.text}
                    </span>
                    {f.parseError && (
                      <small
                        className="muted migration-error"
                        title={f.parseError}
                      >
                        {f.parseError}
                      </small>
                    )}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="icon-btn"
                      title="このファイルをリストから削除"
                      onClick={() => onRemove(f.key)}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <footer className="migration-preview-foot">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onBack}>
          <ArrowLeft size={14} />
          <span>やり直す</span>
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={onAddMore}
        >
          <Upload size={14} />
          <span>さらに追加</span>
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={onCommit}
          disabled={!canCommit}
        >
          <Check size={14} />
          <span>
            全 {preview.fileCount} 件を取り込む
            {preview.pendingFiles > 0 && '（未選択あり）'}
          </span>
        </button>
      </footer>
    </div>
  )
}

function ImportingView({ current, total }: { current: number; total: number }) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0
  return (
    <div className="migration-importing">
      <div className="migration-importing-label">
        取り込み中… {current} / {total} ファイル
      </div>
      <div className="migration-progress">
        <div className="migration-progress-bar" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function DoneView({
  result,
  onContinue,
  onFinishMigration,
}: {
  result: ImportResult
  onContinue: () => void
  onFinishMigration: () => void
}) {
  return (
    <div className="migration-done">
      <div className="migration-done-icon">
        <Check size={20} />
      </div>
      <div className="migration-done-text">
        <strong>取り込み完了</strong>
        <p>
          {result.fileCount} ファイル / {result.rowsAdded.toLocaleString()} 行を
          取り込みました。
          {result.rowsSkipped > 0 && (
            <>
              {' '}重複の {result.rowsSkipped.toLocaleString()} 行は skip。
            </>
          )}
        </p>
        {result.unresolvedFiles.length > 0 && (
          <p className="warn">
            <AlertCircle size={11} className="inline-icon" />
            未選択でスキップされたファイル: {result.unresolvedFiles.join(' / ')}
          </p>
        )}
      </div>
      <div className="migration-done-actions">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={onContinue}
        >
          <Upload size={13} />
          <span>続けて取り込む</span>
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={onFinishMigration}
        >
          <StopCircle size={13} />
          <span>移行モードを完了</span>
        </button>
      </div>
    </div>
  )
}
