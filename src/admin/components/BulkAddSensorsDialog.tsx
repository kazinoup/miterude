/**
 * Admin: テナント詳細 > センサータブ > kebab > 「一括追加（TSV/CSV）」から開く一括フォーム。
 *
 * 操作フロー:
 *   1. テキストエリアに TSV/CSV を貼り付け
 *   2. プレビュー（行ごとに自動マッチ + バリデーション）
 *   3. 確定 → sensors に bulk INSERT
 *
 * 列順は SENSOR_TSV_HEADERS 参照（id, sn, devEUI, name, model, mfr, gw, kind）。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { X, Check, AlertCircle } from 'lucide-react'
import { logStaffAction } from '../lib/adminStorage'
import {
  SENSOR_TSV_HEADERS,
  commitSensorDrafts,
  parsePastedRows,
  rowToSensorDraft,
  validateSensorDrafts,
  type SensorDraft,
  type ValidationIssue,
} from '../lib/sensorRegistration'
import type { Organization } from '../../types'

type Props = {
  org: Organization
  adminUserId: string
  onClose: () => void
  onCreated: () => void
}

type Step = 'edit' | 'preview' | 'done'

export function BulkAddSensorsDialog({ org, adminUserId, onClose, onCreated }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dlg = ref.current
    if (!dlg) return
    if (!dlg.open) dlg.showModal()
    // StrictMode 対策: cleanup で close() しない（onClose 連鎖発火を防ぐため）
  }, [])

  const [step, setStep] = useState<Step>('edit')
  const [text, setText] = useState('')
  const [drafts, setDrafts] = useState<SensorDraft[]>([])
  const [issues, setIssues] = useState<ValidationIssue[]>([])
  const [addedCount, setAddedCount] = useState(0)

  function handlePreview() {
    const rows = parsePastedRows(text)
    if (rows.length === 0) {
      alert('貼り付け内容が空です。')
      return
    }
    // 1 行目がヘッダかどうかを推測（先頭セルが「ID」を含むなら header としてスキップ）
    const startIdx =
      rows[0]?.[0] && /id/i.test(rows[0][0]) && rows[0].length >= 4 ? 1 : 0
    const dataRows = rows.slice(startIdx)
    if (dataRows.length === 0) {
      alert('データ行がありません。')
      return
    }
    const ds = dataRows.map(rowToSensorDraft)
    setDrafts(ds)
    setIssues(validateSensorDrafts(ds, org.id))
    setStep('preview')
  }

  function handleCommit() {
    if (issues.length > 0) {
      alert('未解決のエラーがあります。修正してから再度プレビューしてください。')
      return
    }
    const { added } = commitSensorDrafts(drafts, org.id)
    logStaffAction({
      staffUserId: adminUserId,
      organizationId: org.id,
      action: 'sensors_bulk_added_by_admin',
      targetTable: 'sensors',
      metadata: { count: added },
    })
    setAddedCount(added)
    setStep('done')
  }

  /* ---------- プレビュー時のサマリー ---------- */
  const issuesByRow = useMemo(() => {
    const map = new Map<number, ValidationIssue[]>()
    for (const i of issues) {
      const list = map.get(i.index) ?? []
      list.push(i)
      map.set(i.index, list)
    }
    return map
  }, [issues])

  return (
    <dialog
      ref={ref}
      className="app-dialog app-dialog-wide"
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
    >
      <form className="app-dialog-form" onSubmit={(e) => e.preventDefault()}>
        <header className="app-dialog-head">
          <h2>センサーを一括追加</h2>
          <button type="button" className="icon-btn" aria-label="閉じる" onClick={onClose}>
            <X size={16} />
          </button>
        </header>

        {step === 'edit' && (
          <div className="app-dialog-body">
            <p className="form-help">
              Excel / Google Sheets から下記の <strong>{SENSOR_TSV_HEADERS.length} 列</strong>
              をコピーして貼り付けてください（タブ / カンマ区切り両対応）。1 行目はヘッダ可。
            </p>

            <div className="bulk-cols">
              <strong>列順:</strong>
              <ol>
                {SENSOR_TSV_HEADERS.map((h, i) => (
                  <li key={i}>{h}</li>
                ))}
              </ol>
            </div>

            <textarea
              className="form-input bulk-textarea"
              rows={10}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="CK01\t6785D19065740023\t24E124785D190657\t3F製品冷凍庫1\tEM320-TH\tMilesight\tGW01\t温湿度"
              autoFocus
            />

            <p className="form-help">
              「種別」列は省略可（既定: 温湿度）。シリアル / DevEUI が空の行はエラーになります。
            </p>
          </div>
        )}

        {step === 'preview' && (
          <div className="app-dialog-body bulk-preview-body">
            <div className="bulk-preview-summary">
              <div>
                <strong>{drafts.length} 行</strong> 中{' '}
                {issues.length === 0 ? (
                  <span className="bool-yes-inline">
                    <Check size={12} /> 全件 追加可能
                  </span>
                ) : (
                  <span className="warn">
                    <AlertCircle size={12} /> {new Set(issues.map((i) => i.index)).size} 件にエラー
                  </span>
                )}
              </div>
            </div>

            <div className="bulk-preview-table-wrap">
              <table className="bulk-preview-table">
                <thead>
                  <tr>
                    <th>#</th>
                    {SENSOR_TSV_HEADERS.map((h, i) => (
                      <th key={i}>{h}</th>
                    ))}
                    <th>状態</th>
                  </tr>
                </thead>
                <tbody>
                  {drafts.map((d, idx) => {
                    const rowIssues = issuesByRow.get(idx) ?? []
                    return (
                      <tr
                        key={idx}
                        className={rowIssues.length > 0 ? 'has-error' : ''}
                      >
                        <td className="num">{idx + 1}</td>
                        <td className="mono">{d.id}</td>
                        <td className="mono">{d.serialNumber}</td>
                        <td className="mono">{d.devEUI}</td>
                        <td>{d.name}</td>
                        <td>{d.model}</td>
                        <td>{d.manufacturer}</td>
                        <td className="mono">{d.gatewayId}</td>
                        <td>{d.kind}</td>
                        <td>
                          {rowIssues.length === 0 ? (
                            <span className="bool-yes-inline">
                              <Check size={12} /> OK
                            </span>
                          ) : (
                            <span className="bulk-issue-list">
                              {rowIssues.map((i, k) => (
                                <span key={k} className="bulk-issue">
                                  {i.message}
                                </span>
                              ))}
                            </span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {step === 'done' && (
          <div className="app-dialog-body">
            <div className="bulk-done">
              <div className="bulk-done-icon">
                <Check size={20} />
              </div>
              <div>
                <strong>{addedCount} 件のセンサーを追加しました</strong>
                <p>テナントのセンサー一覧に反映されています。</p>
              </div>
            </div>
          </div>
        )}

        <footer className="app-dialog-foot">
          {step === 'edit' && (
            <>
              <button type="button" className="btn btn-ghost" onClick={onClose}>
                キャンセル
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handlePreview}
                disabled={!text.trim()}
              >
                プレビュー
              </button>
            </>
          )}
          {step === 'preview' && (
            <>
              <button type="button" className="btn btn-ghost" onClick={() => setStep('edit')}>
                編集に戻る
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleCommit}
                disabled={issues.length > 0 || drafts.length === 0}
              >
                {drafts.length} 件を追加
              </button>
            </>
          )}
          {step === 'done' && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={onCreated}
            >
              閉じる
            </button>
          )}
        </footer>
      </form>
    </dialog>
  )
}
