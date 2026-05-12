/**
 * Phase A-4: テナント新規作成ダイアログ。
 *
 * - name / slug / plan を入力。slug は name から自動生成（編集可）
 * - 作成すると localStorage の organizations に新規 Organization を追加
 * - 直後にテナント詳細画面に遷移する想定（onCreated で id を返す）
 *
 * Phase A-4 では「初期管理者の招待」までは実装しない（既存ユーザーがいる場合は
 * Phase A-5 のスタッフ管理画面で割り当てる、新規作成顧客は外部での招待フロー想定）。
 */
import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import {
  loadOrganizations,
  newId,
  saveOrganizations,
  upsertOrganization,
} from '../lib/adminStorage'
import { toast } from '../../lib/toast'
import {
  seedDefaultCategoriesForOrg,
  seedMilesightIntegrationForOrg,
  upsertOrganizationInSupabase,
} from '../../lib/supabaseQueries'
import { isSupabaseConfigured } from '../../lib/supabase'
import type {
  BillingCycle,
  ContractType,
  Organization,
  PaymentMethod,
} from '../../types'

type Props = {
  onClose: () => void
  onCreated: (orgId: string) => void
}

/**
 * 契約 ID として使える文字: URL セーフな英数字 + `-` / `_`
 * （RFC 3986 の unreserved に近いが、人が読み上げる場面が多いので `.` / `~` は外す）
 */
const CONTRACT_ID_REGEX = /^[a-z0-9](?:[a-z0-9_-]{0,18}[a-z0-9])?$/
const CONTRACT_ID_MAX_LEN = 20

/**
 * 5 文字のランダム英数字を生成（基本的に手動入力前提なのでデフォルト値用）。
 * 読み間違えやすい `0/o`, `1/l/i` を除外。
 */
function generateDefaultContractId(): string {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789'
  let out = ''
  for (let i = 0; i < 5; i += 1) {
    out += chars[Math.floor(Math.random() * chars.length)]
  }
  return out
}

/** 入力途中の正規化（小文字 + 不正文字除去 + 長さ制限）だけ行う */
function normalizeContractIdInput(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '')
    .slice(0, CONTRACT_ID_MAX_LEN)
}

export function CreateTenantDialog({ onClose, onCreated }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const [name, setName] = useState('')
  // 契約 ID は手動入力前提だが、空のままだと手戻りが多いので 5 文字ランダムをデフォルトに置く
  const [slug, setSlug] = useState(() => generateDefaultContractId())
  const [billingCycle, setBillingCycle] = useState<BillingCycle>('annual')
  const [paymentMethod, setPaymentMethod] =
    useState<PaymentMethod>('bank_transfer')
  const [contractType, setContractType] =
    useState<ContractType>('subscription')
  const [tsukurudeAi, setTsukurudeAi] = useState(false)

  useEffect(() => {
    const dlg = ref.current
    if (!dlg) return
    if (!dlg.open) dlg.showModal()
    // StrictMode 二重マウントで cleanup の dlg.close() が onClose を発火するため、
    // 明示 close はしない（unmount で DOM ごと外れる）。
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmedName = name.trim()
    const trimmedSlug = slug.trim()
    if (!trimmedName) {
      alert('テナント名を入力してください。')
      return
    }
    if (!trimmedSlug) {
      alert('契約IDを入力してください。')
      return
    }
    if (!CONTRACT_ID_REGEX.test(trimmedSlug)) {
      alert(
        '契約IDは半角英小文字・数字・ハイフン/アンダースコアのみ、2〜20文字、先頭末尾は英数字で入力してください。',
      )
      return
    }

    const orgs = loadOrganizations()
    // 契約 ID の重複チェック（URL 兼用なので衝突は致命的）
    const dup = Object.values(orgs).find((o) => o.slug === trimmedSlug)
    if (dup) {
      alert(
        `契約ID「${trimmedSlug}」は既に「${dup.name}」で使われています。別のIDを指定してください。`,
      )
      return
    }

    // 契約期間の既定: 開始 = 今日、終了 = サイクルに応じて 1 ヶ月 / 1 年後
    const startedAt = new Date()
    const expiresAt = new Date(startedAt)
    if (billingCycle === 'annual') {
      expiresAt.setFullYear(expiresAt.getFullYear() + 1)
    } else {
      expiresAt.setMonth(expiresAt.getMonth() + 1)
    }

    const id = newId('org')
    const org: Organization = {
      id,
      name: trimmedName,
      slug: trimmedSlug,
      createdAt: startedAt,
      billingCycle,
      contractStartedAt: startedAt,
      contractExpiresAt: expiresAt,
      paymentMethod,
      autoInvoice: paymentMethod === 'bank_transfer',
      contractType,
      tsukurudeAiEnabled: tsukurudeAi,
    }

    // Supabase 側を先に書く（成功してから localStorage を更新するとリロード時に同期する）。
    if (isSupabaseConfigured()) {
      try {
        await upsertOrganizationInSupabase(org)
        // デフォルトの 3 区分 + Milesight integration プレースホルダを並列で seed
        await Promise.all([
          seedDefaultCategoriesForOrg(id),
          seedMilesightIntegrationForOrg(id),
        ])
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[create-tenant] supabase write failed', err)
        toast(`テナント保存に失敗: ${msg.slice(0, 100)}`, 'error')
        return
      }
    }

    saveOrganizations(upsertOrganization(orgs, org))
    toast(`テナント「${trimmedName}」を作成しました`, 'success')
    onCreated(id)
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
      <form className="app-dialog-form" onSubmit={handleSubmit}>
        <header className="app-dialog-head">
          <h2>新規テナント</h2>
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
          <div className="form-row">
            <label className="form-label" htmlFor="tenant-name">
              名前
            </label>
            <input
              id="tenant-name"
              className="form-input"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              placeholder="例: ABC 食品株式会社"
            />
            <p className="form-help">顧客企業の正式名称。後から変更可能。</p>
          </div>

          <div className="form-row">
            <label className="form-label" htmlFor="tenant-slug">
              契約ID
            </label>
            <div className="form-input-with-action">
              <input
                id="tenant-slug"
                className="form-input mono"
                type="text"
                value={slug}
                onChange={(e) =>
                  setSlug(normalizeContractIdInput(e.target.value))
                }
                placeholder="abc-foods"
                maxLength={CONTRACT_ID_MAX_LEN}
                inputMode="text"
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setSlug(generateDefaultContractId())}
                title="ランダムな 5 文字を再生成"
              >
                ランダム再生成
              </button>
            </div>
            <p className="form-help">
              顧客とのやり取りや URL に使う識別子（例: <code>abc-foods</code>）。
              半角英数字とハイフン / アンダースコアのみ、2〜20 文字。
              基本は手動入力推奨。デフォルトはランダム 5 文字。
            </p>
          </div>

          <div className="form-row">
            <label className="form-label" htmlFor="tenant-contract-type">
              契約種別
            </label>
            <select
              id="tenant-contract-type"
              className="select"
              value={contractType}
              onChange={(e) =>
                setContractType(e.target.value as ContractType)
              }
            >
              <option value="subscription">
                サブスクプラン（デバイス代込み・月額継続）
              </option>
              <option value="purchase">
                買取プラン（デバイス代を初回一括）
              </option>
              <option value="typeless">
                タイプレス（既存サービスからの移行・統合契約）
              </option>
              <option value="demo">デモ（料金なし・検証用）</option>
            </select>
          </div>

          <div className="form-row">
            <label className="form-label">ツクルデAI 連携</label>
            <label className="form-checkbox">
              <input
                type="checkbox"
                checked={tsukurudeAi}
                onChange={(e) => setTsukurudeAi(e.target.checked)}
              />
              <span>このテナントはツクルデAIと連携している</span>
            </label>
          </div>

          <div className="form-row">
            <label className="form-label" htmlFor="tenant-cycle">
              請求サイクル
            </label>
            <select
              id="tenant-cycle"
              className="select"
              value={billingCycle}
              onChange={(e) => setBillingCycle(e.target.value as BillingCycle)}
            >
              <option value="annual">年契約（既定）</option>
              <option value="monthly">月契約</option>
            </select>
            <p className="form-help">
              契約期限は今日からサイクル分（年契約なら 1 年）後に自動セット。後で詳細画面から変更可。
            </p>
          </div>

          <div className="form-row">
            <label className="form-label" htmlFor="tenant-payment">
              決済手段
            </label>
            <select
              id="tenant-payment"
              className="select"
              value={paymentMethod}
              onChange={(e) =>
                setPaymentMethod(e.target.value as PaymentMethod)
              }
            >
              <option value="bank_transfer">銀行振込（既定）</option>
              <option value="credit_card">クレジットカード</option>
            </select>
            <p className="form-help">
              銀行振込なら請求書自動送信を ON で作成（送付先メールは詳細画面で設定）。
            </p>
          </div>
        </div>

        <footer className="app-dialog-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            キャンセル
          </button>
          <button type="submit" className="btn btn-primary">
            作成
          </button>
        </footer>
      </form>
    </dialog>
  )
}
