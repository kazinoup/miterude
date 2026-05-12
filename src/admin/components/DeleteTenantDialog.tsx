/**
 * Phase J: テナント削除確認ダイアログ。
 *
 * 安全装置:
 *  - ユーザに「組織 ID」と「組織名」を手入力させ、両方が完全一致したときのみボタンを有効化
 *  - 基本フローは「無効化（論理削除）」。180 日間は復活可能。
 *  - 物理削除は physical_delete_after を過ぎてからのみ可能。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { X, AlertTriangle, ShieldOff, Trash2 } from 'lucide-react'
import { toast } from '../../lib/toast'
import {
  deactivateOrganizationInSupabase,
  deleteOrganizationFromSupabase,
} from '../../lib/supabaseQueries'
import { isSupabaseConfigured } from '../../lib/supabase'
import { logStaffAction } from '../lib/adminStorage'
import type { Organization } from '../../types'

type Props = {
  org: Organization
  adminUserId: string
  onClose: () => void
  /** 無効化 / 物理削除どちらかが完了したら呼ばれる。 */
  onDone: (kind: 'deactivate' | 'destroy') => void
}

/** Date / string / undefined を許容して Date を返す（localStorage 経由で string になることがある）。 */
function asDate(v: Date | string | undefined | null): Date | undefined {
  if (!v) return undefined
  if (v instanceof Date) return v
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? undefined : d
}

function isPhysicalDeleteEligible(org: Organization): boolean {
  const phys = asDate(org.physicalDeleteAfter)
  if (!org.deactivatedAt || !phys) return false
  return phys.getTime() <= Date.now()
}

function formatDateTime(d: Date | string | undefined): string {
  const dd = asDate(d)
  if (!dd) return '—'
  return dd.toLocaleString('ja-JP')
}

export function DeleteTenantDialog({ org, adminUserId, onClose, onDone }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const [idInput, setIdInput] = useState('')
  const [nameInput, setNameInput] = useState('')
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)

  /** 物理削除が可能か（無効化済み + 猶予期間経過）。 */
  const canPhysicalDelete = useMemo(() => isPhysicalDeleteEligible(org), [org])

  /** すでに無効化されているか */
  const alreadyDeactivated = Boolean(org.deactivatedAt)

  const idMatches = idInput.trim() === org.id
  const nameMatches = nameInput.trim() === org.name
  const inputsValid = idMatches && nameMatches

  useEffect(() => {
    const dlg = ref.current
    if (!dlg) return
    if (!dlg.open) dlg.showModal()
    // クリーンアップで dlg.close() を呼ぶと <dialog onClose> 経由で
    // setDeleteOpen(false) が走って StrictMode の二重マウントと相性が悪い。
    // 親が deleteOpen=false にすればコンポーネント自体が unmount → DOM 削除されるので
    // ここでは明示的な close を行わない。
  }, [])

  async function handleDeactivate(e: React.FormEvent) {
    e.preventDefault()
    if (!inputsValid || submitting) return
    setSubmitting(true)
    try {
      if (isSupabaseConfigured()) {
        await deactivateOrganizationInSupabase({
          id: org.id,
          byUserId: adminUserId,
          reason: reason.trim() || undefined,
        })
      }
      logStaffAction({
        staffUserId: adminUserId,
        organizationId: org.id,
        action: 'tenant.deactivate',
        targetTable: 'organizations',
        targetId: org.id,
        metadata: { name: org.name, slug: org.slug, reason: reason.trim() || null },
      })
      toast(`テナント「${org.name}」を無効化しました（180 日後に物理削除可能）`, 'success')
      onDone('deactivate')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      toast(`無効化に失敗: ${msg.slice(0, 100)}`, 'error')
    } finally {
      setSubmitting(false)
    }
  }

  async function handlePhysicalDelete(e: React.FormEvent) {
    e.preventDefault()
    if (!inputsValid || submitting || !canPhysicalDelete) return
    if (
      !confirm(
        `本当に「${org.name}」を完全削除しますか？\n\nこのテナントの全データ（センサー / 計測値 / メンバー / 監査ログ）が連鎖削除され、復元できません。`,
      )
    )
      return
    setSubmitting(true)
    try {
      if (isSupabaseConfigured()) {
        await deleteOrganizationFromSupabase(org.id)
      }
      logStaffAction({
        staffUserId: adminUserId,
        organizationId: org.id,
        action: 'tenant.destroy',
        targetTable: 'organizations',
        targetId: org.id,
        metadata: { name: org.name, slug: org.slug },
      })
      toast(`テナント「${org.name}」を完全削除しました`, 'info')
      onDone('destroy')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      toast(`完全削除に失敗: ${msg.slice(0, 100)}`, 'error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <dialog
      ref={ref}
      className="app-dialog"
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onClose={onClose}
    >
      <div className="app-dialog-form">
        <header className="app-dialog-head">
          <h2>
            <AlertTriangle size={16} className="inline-icon" />
            テナント削除の確認
          </h2>
          <button
            type="button"
            className="icon-btn"
            aria-label="閉じる"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </header>

        <div className="app-dialog-body">
          <div className="admin-danger-zone">
            <h3>運用方針</h3>
            <p>
              テナント削除は <strong>最も危険な操作</strong> です。誤操作防止のため、
              下記の組織 ID と組織名を <strong>正確に手入力</strong> してください。
              <br />
              基本フローは <strong>無効化（論理削除）</strong> で、180 日間の猶予期間中は復活できます。
              この期間を過ぎてから初めて完全削除が可能になります。
            </p>
          </div>

          {alreadyDeactivated && (
            <div className="delete-tenant-status">
              <p>
                <strong>このテナントは既に無効化されています。</strong>
              </p>
              <p>
                無効化日時: {formatDateTime(org.deactivatedAt)}
                <br />
                物理削除可能日時: {formatDateTime(org.physicalDeleteAfter)}
                {canPhysicalDelete ? (
                  <span className="muted"> （猶予期間終了 → 完全削除が可能）</span>
                ) : (
                  <span className="muted">
                    {' '}
                    （あと{' '}
                    {Math.max(
                      0,
                      Math.ceil(
                        ((asDate(org.physicalDeleteAfter)?.getTime() ?? 0) -
                          Date.now()) /
                          (24 * 60 * 60 * 1000),
                      ),
                    )}{' '}
                    日で完全削除可能）
                  </span>
                )}
              </p>
            </div>
          )}

          <div className="form-row">
            <label className="form-label" htmlFor="delete-tenant-id">
              組織 ID（UUID）
            </label>
            <input
              id="delete-tenant-id"
              className={`form-input mono ${idMatches ? 'is-match' : idInput.trim() ? 'is-mismatch' : ''}`}
              type="text"
              value={idInput}
              onChange={(e) => setIdInput(e.target.value)}
              placeholder="00000000-0000-0000-0000-000000000000"
              autoComplete="off"
              spellCheck={false}
            />
            <p className="form-help mono dim">{org.id}</p>
          </div>

          <div className="form-row">
            <label className="form-label" htmlFor="delete-tenant-name">
              組織名
            </label>
            <input
              id="delete-tenant-name"
              className={`form-input ${nameMatches ? 'is-match' : nameInput.trim() ? 'is-mismatch' : ''}`}
              type="text"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              placeholder="正確な組織名を入力"
              autoComplete="off"
              spellCheck={false}
            />
            <p className="form-help dim">{org.name}</p>
          </div>

          {!alreadyDeactivated && (
            <div className="form-row">
              <label className="form-label" htmlFor="delete-tenant-reason">
                理由（任意）
              </label>
              <textarea
                id="delete-tenant-reason"
                className="form-input"
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="例: 契約終了 / テスト用に作成した一時テナント"
              />
              <p className="form-help">
                監査ログに記録します（顧客への説明可能性の確保）。
              </p>
            </div>
          )}
        </div>

        <footer className="app-dialog-foot delete-tenant-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            キャンセル
          </button>
          {!alreadyDeactivated && (
            <button
              type="button"
              className="btn btn-danger"
              onClick={handleDeactivate}
              disabled={!inputsValid || submitting}
              title={!inputsValid ? '組織 ID と組織名を正確に入力してください' : ''}
            >
              <ShieldOff size={14} />
              <span>無効化する（推奨）</span>
            </button>
          )}
          {canPhysicalDelete && (
            <button
              type="button"
              className="btn btn-danger"
              onClick={handlePhysicalDelete}
              disabled={!inputsValid || submitting}
              title={!inputsValid ? '組織 ID と組織名を正確に入力してください' : '完全削除（取り消し不可）'}
            >
              <Trash2 size={14} />
              <span>完全削除する</span>
            </button>
          )}
        </footer>
      </div>
    </dialog>
  )
}
