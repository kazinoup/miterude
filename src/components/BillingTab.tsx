/**
 * テナント側の「契約・支払い」タブ。
 *
 * 構成（上から）:
 *  1. 契約情報（読み取り専用 — 組織名 / 契約ID（UUID 併記） / プラン / 請求サイクル
 *               / 契約開始日 / 次回更新日）
 *  2. 支払い方法（読み取り専用バッジ + 案内）
 *     - 銀行振込 or クレジットの切り替えは Admin 側でのみ操作可能。
 *       テナントから勝手に変えられないようにする。
 *     - クレジット: Stripe 連携モックでカード登録/変更/解除（カード自体の管理は
 *       テナントの責任なので残す）
 *     - 銀行振込: 請求書送付先メールを表示
 *  3. 請求書履歴（銀行振込テナントのみ）
 *
 * 設計方針:
 *  - 顧客のカード情報はミテルデが一切保管しない（PCI scope ゼロ）
 *  - 表示用のキャッシュ（cardBrand / cardLast4 / cardExpMonth/Year）のみ Stripe Webhook から同期
 *  - クレジット契約の領収書・明細は Stripe Customer Portal で確認させ、画面からは
 *    リンクを案内するに留める
 */
import { useState } from 'react'
import {
  Building2,
  CreditCard,
  Banknote,
  Mail,
  ExternalLink,
  Trash2,
  Plus,
  CheckCircle2,
  Clock,
  AlertCircle,
  Lock,
  X,
  FileText,
  Info,
} from 'lucide-react'
import type {
  BillingCycle,
  ContractType,
  Invoice,
  InvoiceStatus,
  InvoiceStore,
  Organization,
} from '../types'

type Props = {
  organization: Organization
  invoices: InvoiceStore
  onUpdateStripeCard: (
    patch: Partial<
      Pick<
        Organization,
        | 'stripeCustomerId'
        | 'stripePaymentMethodId'
        | 'cardBrand'
        | 'cardLast4'
        | 'cardExpMonth'
        | 'cardExpYear'
      >
    >,
  ) => void
}

function contractTypeLabel(c: ContractType | undefined): string {
  if (c === 'demo') return 'デモプラン'
  if (c === 'subscription') return 'サブスクプラン'
  if (c === 'purchase') return '買取プラン'
  if (c === 'typeless') return 'タイプレス'
  return '未設定'
}

function contractTypeDescription(c: ContractType | undefined): string {
  if (c === 'demo') return '検証用テナント（料金は発生しません）'
  if (c === 'subscription')
    return 'デバイス代込みの月額継続プラン'
  if (c === 'purchase')
    return 'デバイス代を初回一括 + 以降はランニング費のみ'
  if (c === 'typeless')
    return '既存「タイプレス」サービスからの移行・統合契約'
  return ''
}

function billingCycleLabel(c: BillingCycle | undefined): string {
  if (c === 'monthly') return '月契約'
  if (c === 'annual') return '年契約'
  return '—'
}

function formatDate(d: Date | string | undefined): string {
  if (!d) return '—'
  const dt = d instanceof Date ? d : new Date(d)
  if (Number.isNaN(dt.getTime())) return '—'
  return `${dt.getFullYear()}/${String(dt.getMonth() + 1).padStart(2, '0')}/${String(dt.getDate()).padStart(2, '0')}`
}

function daysUntil(d: Date | string | undefined): number | null {
  if (!d) return null
  const t = (d instanceof Date ? d : new Date(d)).getTime()
  if (Number.isNaN(t)) return null
  return Math.ceil((t - Date.now()) / (24 * 60 * 60 * 1000))
}

function brandLabel(brand: string | undefined): string {
  switch ((brand ?? '').toLowerCase()) {
    case 'visa':
      return 'Visa'
    case 'mastercard':
      return 'Mastercard'
    case 'amex':
      return 'American Express'
    case 'jcb':
      return 'JCB'
    case 'discover':
      return 'Discover'
    case 'diners':
      return 'Diners Club'
    default:
      return brand || 'カード'
  }
}

function formatYen(n: number): string {
  return `¥${n.toLocaleString('ja-JP')}`
}

export function BillingTab({
  organization,
  invoices,
  onUpdateStripeCard,
}: Props) {
  const [cardDialog, setCardDialog] = useState<'register' | 'replace' | null>(null)

  const remaining = daysUntil(organization.contractExpiresAt)
  const expiryClass =
    remaining === null
      ? ''
      : remaining < 0
        ? 'is-expired'
        : remaining <= 30
          ? 'is-soon'
          : ''

  const orgInvoices = Object.values(invoices)
    .filter((i) => i.organizationId === organization.id)
    .sort((a, b) => {
      const ta = a.issuedAt ? new Date(a.issuedAt).getTime() : 0
      const tb = b.issuedAt ? new Date(b.issuedAt).getTime() : 0
      return tb - ta
    })

  const isCredit = organization.paymentMethod === 'credit_card'
  const isBank = organization.paymentMethod === 'bank_transfer'
  const cardRegistered =
    isCredit && !!organization.stripeCustomerId && !!organization.cardLast4

  function handleRemoveCard() {
    if (
      !confirm(
        'クレジットカード情報を解除しますか？\n\nStripe 側でも該当顧客のデフォルト支払い方法が外れます。次回の請求は決済できなくなりますのでご注意ください。',
      )
    )
      return
    onUpdateStripeCard({
      stripeCustomerId: undefined,
      stripePaymentMethodId: undefined,
      cardBrand: undefined,
      cardLast4: undefined,
      cardExpMonth: undefined,
      cardExpYear: undefined,
    })
  }

  return (
    <>
      {/* ===== 1. 契約情報 ===== */}
      <section className="panel-card billing-card">
        <div className="panel-card-head">
          <h2>
            <Building2 size={16} className="head-icon" />
            契約情報
          </h2>
          <span className="panel-card-meta">
            契約条件の変更はミテルデの運営側にお問い合わせください。
          </span>
        </div>

        <dl className="billing-info-grid">
          <div className="billing-info-row">
            <dt>組織名</dt>
            <dd>{organization.name}</dd>
          </div>
          <div className="billing-info-row">
            <dt>契約ID</dt>
            <dd className="mono">
              {organization.slug}
              <div className="billing-info-uuid mono" title="システム内部の UUID">
                UUID: {organization.id}
              </div>
            </dd>
          </div>
          <div className="billing-info-row">
            <dt>プラン</dt>
            <dd className="billing-plan-dd">
              <span
                className={`contract-type-pill contract-type-${organization.contractType ?? 'subscription'}`}
              >
                {contractTypeLabel(organization.contractType)}
              </span>
              {organization.tsukurudeAiEnabled && (
                <span className="contract-pill contract-pill-ai billing-plan-badge">
                  ツクルデAI 連携
                </span>
              )}
              <span className="billing-plan-desc muted">
                {contractTypeDescription(organization.contractType)}
              </span>
            </dd>
          </div>
          <div className="billing-info-row">
            <dt>請求サイクル</dt>
            <dd>{billingCycleLabel(organization.billingCycle)}</dd>
          </div>
          <div className="billing-info-row billing-info-row-span">
            <dt>契約期間</dt>
            <dd>
              <span className="billing-period">
                <span>{formatDate(organization.contractStartedAt)}</span>
                <span className="billing-period-sep" aria-hidden="true">
                  〜
                </span>
                <span className={`billing-expiry ${expiryClass}`}>
                  {formatDate(organization.contractExpiresAt)}
                  {remaining !== null && (
                    <span className="billing-expiry-days">
                      {' '}
                      （
                      {remaining < 0
                        ? `${-remaining} 日経過`
                        : remaining === 0
                          ? '本日'
                          : `あと ${remaining} 日`}
                      ）
                    </span>
                  )}
                </span>
              </span>
            </dd>
          </div>
        </dl>
      </section>

      {/* ===== 2. 支払い方法 ===== */}
      <section className="panel-card billing-card">
        <div className="panel-card-head">
          <h2>
            <CreditCard size={16} className="head-icon" />
            支払い方法
          </h2>
          <span className="panel-card-meta">
            設定の変更はミテルデの運営側にお問い合わせください。
          </span>
        </div>

        <div className="billing-method-readonly">
          {isBank ? (
            <div className="billing-method-readonly-body">
              <span className="billing-method-readonly-icon" aria-hidden="true">
                <Banknote size={20} />
              </span>
              <div>
                <div className="billing-method-readonly-title">銀行振込</div>
                <div className="billing-method-readonly-sub muted">
                  請求書 PDF をメールでお送りします。手数料はお客様負担です。
                </div>
              </div>
            </div>
          ) : isCredit ? (
            <div className="billing-method-readonly-body">
              <span className="billing-method-readonly-icon" aria-hidden="true">
                <CreditCard size={20} />
              </span>
              <div>
                <div className="billing-method-readonly-title">
                  クレジットカード
                </div>
                <div className="billing-method-readonly-sub muted">
                  Stripe で安全に処理されます。領収書は Stripe ポータルから
                  いつでもダウンロードできます。
                </div>
              </div>
            </div>
          ) : (
            <div className="billing-method-readonly-body">
              <span className="billing-method-readonly-icon" aria-hidden="true">
                <Info size={20} />
              </span>
              <div>
                <div className="billing-method-readonly-title">未設定</div>
                <div className="billing-method-readonly-sub muted">
                  ミテルデの運営側で支払い方法をまだ設定していません。
                </div>
              </div>
            </div>
          )}
        </div>

        <p className="billing-method-notice">
          <Info size={13} className="inline-icon" />
          支払い方法（銀行振込／クレジットカード）の切り替えはミテルデ運営側で行います。
          変更をご希望の場合はサポート窓口へご連絡ください。
        </p>

        {/* --- 銀行振込 詳細 --- */}
        {isBank && (
          <div className="billing-method-detail">
            <p className="muted in-panel">
              <Mail size={13} className="inline-icon" /> 請求書送付先:{' '}
              <span className="mono">
                {organization.billingEmail || '—（運営側で未設定）'}
              </span>
            </p>
            <p className="muted in-panel small-hint">
              請求書は毎月 / 毎年の更新タイミングで自動発行されます。発行されると下の
              「請求書履歴」にも追加され、お支払い後は領収書 PDF も同欄からダウンロード
              できるようになります。
            </p>
          </div>
        )}

        {/* --- クレジット 詳細 --- */}
        {isCredit && (
          <div className="billing-method-detail">
            {cardRegistered ? (
              <div className="billing-card-display">
                <div className="billing-card-brand">
                  <CreditCard size={20} aria-hidden="true" />
                  <strong>{brandLabel(organization.cardBrand)}</strong>
                </div>
                <div className="billing-card-info">
                  <span className="billing-card-mask mono">
                    •••• •••• •••• {organization.cardLast4}
                  </span>
                  <span className="billing-card-exp muted">
                    有効期限{' '}
                    {organization.cardExpMonth
                      ? String(organization.cardExpMonth).padStart(2, '0')
                      : '--'}
                    /
                    {organization.cardExpYear
                      ? String(organization.cardExpYear).slice(-2)
                      : '--'}
                  </span>
                </div>
                <div className="billing-card-actions">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => setCardDialog('replace')}
                  >
                    カード情報を変更
                  </button>
                  <a
                    href="https://billing.stripe.com/p/login/test"
                    target="_blank"
                    rel="noreferrer"
                    className="btn btn-ghost btn-sm"
                  >
                    <ExternalLink size={13} />
                    <span>請求履歴・領収書を見る</span>
                  </a>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm billing-card-remove"
                    onClick={handleRemoveCard}
                  >
                    <Trash2 size={13} />
                    <span>解除</span>
                  </button>
                </div>
                <p className="billing-stripe-note muted">
                  <Lock size={11} className="inline-icon" />
                  カード情報は Stripe で暗号化して保管されています。ミテルデのサーバには
                  カード番号も CVC も一切保存されません。
                </p>
              </div>
            ) : (
              <div className="billing-card-empty">
                <p>
                  <strong>クレジットカードがまだ登録されていません。</strong>
                </p>
                <p className="muted in-panel">
                  「カードを登録する」を押すと Stripe Checkout のセキュアなページへ移動します。
                  カード情報は Stripe 側で直接処理され、ミテルデのサーバを通過しません。
                </p>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => setCardDialog('register')}
                >
                  <Plus size={14} />
                  <span>カードを登録する（Stripe Checkout）</span>
                </button>
              </div>
            )}
          </div>
        )}
      </section>

      {/* ===== 3. 請求書履歴（銀行振込のみ） ===== */}
      {isBank && (
        <section className="panel-card billing-card">
          <div className="panel-card-head">
            <h2>
              <FileText size={16} className="head-icon" />
              請求書・領収書
            </h2>
            <span className="panel-card-meta">
              発行された請求書と、入金確認後の領収書をダウンロードできます。
            </span>
          </div>

          {orgInvoices.length === 0 ? (
            <div className="billing-empty">
              まだ請求書はありません。次回の請求月になると自動発行され、
              ここに表示されます。発行時はメールでも通知します。
            </div>
          ) : (
            <ul className="billing-invoice-list">
              {orgInvoices.map((iv) => (
                <BillingInvoiceRow key={iv.id} invoice={iv} />
              ))}
            </ul>
          )}
        </section>
      )}

      {isCredit && (
        <section className="panel-card billing-card">
          <div className="panel-card-head">
            <h2>
              <FileText size={16} className="head-icon" />
              請求履歴・領収書
            </h2>
          </div>
          <p className="muted in-panel">
            クレジット決済の請求履歴と領収書 PDF は Stripe のお客様ポータルからいつでもダウンロードできます。
          </p>
          <a
            href="https://billing.stripe.com/p/login/test"
            target="_blank"
            rel="noreferrer"
            className="btn btn-secondary"
          >
            <ExternalLink size={13} />
            <span>Stripe ポータルで確認する</span>
          </a>
        </section>
      )}

      {cardDialog && (
        <CardRegistrationDialog
          mode={cardDialog}
          organization={organization}
          onClose={() => setCardDialog(null)}
          onComplete={(card) => {
            onUpdateStripeCard({
              stripeCustomerId:
                organization.stripeCustomerId ?? `cus_mock_${Math.random().toString(36).slice(2, 12)}`,
              stripePaymentMethodId: `pm_mock_${Math.random().toString(36).slice(2, 12)}`,
              cardBrand: card.brand,
              cardLast4: card.last4,
              cardExpMonth: card.expMonth,
              cardExpYear: card.expYear,
            })
            setCardDialog(null)
          }}
        />
      )}
    </>
  )
}

/* ===== 請求書 1 行 ===== */
function BillingInvoiceRow({ invoice }: { invoice: Invoice }) {
  const statusInfo = getInvoiceStatusInfo(invoice.status)
  return (
    <li className="billing-invoice-row">
      <div className="billing-invoice-main">
        <span className="billing-invoice-number mono">
          {invoice.invoiceNumber}
        </span>
        <span className="billing-invoice-period">{invoice.periodLabel}</span>
        <span className="billing-invoice-amount">
          {formatYen(invoice.amountJpy)}
        </span>
        <span
          className={`billing-invoice-status ${statusInfo.cls}`}
          title={statusInfo.tooltip}
        >
          <statusInfo.Icon size={11} />
          {statusInfo.label}
        </span>
      </div>
      <div className="billing-invoice-meta muted">
        {invoice.issuedAt && (
          <span>発行: {formatDate(invoice.issuedAt)}</span>
        )}
        {invoice.dueAt && <span>期日: {formatDate(invoice.dueAt)}</span>}
        {invoice.paidAt && <span>入金: {formatDate(invoice.paidAt)}</span>}
      </div>
      <div className="billing-invoice-actions">
        {invoice.invoicePdfUrl ? (
          <a
            href={invoice.invoicePdfUrl}
            target="_blank"
            rel="noreferrer"
            className="btn btn-ghost btn-sm"
          >
            <FileText size={13} />
            <span>請求書 PDF</span>
          </a>
        ) : (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled
            title="営業担当の確認後に発行されます"
          >
            <FileText size={13} />
            <span>発行待ち</span>
          </button>
        )}
        {invoice.receiptPdfUrl ? (
          <a
            href={invoice.receiptPdfUrl}
            target="_blank"
            rel="noreferrer"
            className="btn btn-ghost btn-sm"
          >
            <CheckCircle2 size={13} />
            <span>領収書 PDF</span>
          </a>
        ) : (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled
            title="入金確認後に発行されます"
          >
            <CheckCircle2 size={13} />
            <span>未発行</span>
          </button>
        )}
      </div>
    </li>
  )
}

function getInvoiceStatusInfo(s: InvoiceStatus): {
  label: string
  cls: string
  tooltip: string
  Icon: typeof CheckCircle2
} {
  switch (s) {
    case 'confirming':
      return {
        label: '発行確認中',
        cls: 'status-confirming',
        tooltip: 'ミテルデの営業担当が内容を確認中です',
        Icon: Clock,
      }
    case 'sent':
      return {
        label: '入金待ち',
        cls: 'status-sent',
        tooltip: '請求書が発行されました。期日までにお支払いください',
        Icon: FileText,
      }
    case 'paid':
      return {
        label: '入金済み',
        cls: 'status-paid',
        tooltip: '入金が確認されました。領収書をダウンロードできます',
        Icon: CheckCircle2,
      }
    case 'overdue':
      return {
        label: '期日超過',
        cls: 'status-overdue',
        tooltip: 'お支払い期日を過ぎています',
        Icon: AlertCircle,
      }
    case 'cancelled':
      return {
        label: 'キャンセル',
        cls: 'status-cancelled',
        tooltip: 'この請求はキャンセルされました',
        Icon: X,
      }
  }
}

/* ===== カード登録ダイアログ（Stripe Checkout 風モック）===== */
function CardRegistrationDialog({
  mode,
  organization,
  onClose,
  onComplete,
}: {
  mode: 'register' | 'replace'
  organization: Organization
  onClose: () => void
  onComplete: (card: {
    brand: string
    last4: string
    expMonth: number
    expYear: number
  }) => void
}) {
  const [number, setNumber] = useState('')
  const [exp, setExp] = useState('')
  const [cvc, setCvc] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // 入力からブランド推定（簡易）
  const cleaned = number.replace(/\s/g, '')
  const brand = (() => {
    if (/^4/.test(cleaned)) return 'visa'
    if (/^5[1-5]/.test(cleaned)) return 'mastercard'
    if (/^3[47]/.test(cleaned)) return 'amex'
    if (/^35/.test(cleaned)) return 'jcb'
    return ''
  })()

  function formatNumber(v: string): string {
    const digits = v.replace(/\D/g, '').slice(0, 19)
    return digits.match(/.{1,4}/g)?.join(' ') ?? digits
  }
  function formatExp(v: string): string {
    const digits = v.replace(/\D/g, '').slice(0, 4)
    if (digits.length <= 2) return digits
    return `${digits.slice(0, 2)}/${digits.slice(2)}`
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const last4 = cleaned.slice(-4)
    if (last4.length !== 4) {
      alert('カード番号を入力してください。')
      return
    }
    const m = /^(\d{2})\/(\d{2})$/.exec(exp)
    if (!m) {
      alert('有効期限を MM/YY 形式で入力してください。')
      return
    }
    const expMonth = Number(m[1])
    const expYearShort = Number(m[2])
    const expYear = 2000 + expYearShort
    if (expMonth < 1 || expMonth > 12) {
      alert('有効期限の月が不正です。')
      return
    }
    if (cvc.length < 3) {
      alert('CVC を入力してください。')
      return
    }
    setSubmitting(true)
    // 実際には Stripe Checkout に redirect → Stripe Webhook で同期。
    // モックでは 600ms 待ってから完了させる。
    window.setTimeout(() => {
      onComplete({ brand: brand || 'visa', last4, expMonth, expYear })
    }, 600)
  }

  return (
    <div
      className="stripe-mock-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="stripe-mock-title"
    >
      <div className="stripe-mock-card">
        <header className="stripe-mock-head">
          <div>
            <span className="stripe-mock-brand">stripe</span>
            <span className="stripe-mock-merchant">
              {organization.name} へのお支払い
            </span>
          </div>
          <button
            type="button"
            className="icon-btn"
            aria-label="閉じる"
            onClick={onClose}
            disabled={submitting}
          >
            <X size={18} />
          </button>
        </header>

        <h2 id="stripe-mock-title" className="stripe-mock-title">
          {mode === 'register'
            ? 'カードを登録'
            : 'カード情報を更新'}
        </h2>
        <p className="stripe-mock-sub">
          ミテルデは安全な決済のために Stripe を使用しています。本番では実際の
          Stripe Checkout が表示されます（モック画面）。
        </p>

        <form onSubmit={handleSubmit} className="stripe-mock-form">
          <label className="stripe-mock-field">
            <span className="stripe-mock-label">カード番号</span>
            <div className="stripe-mock-input-row">
              <input
                type="text"
                inputMode="numeric"
                className="form-input mono stripe-mock-input"
                value={number}
                onChange={(e) => setNumber(formatNumber(e.target.value))}
                placeholder="1234 1234 1234 1234"
                autoComplete="cc-number"
                required
              />
              {brand && (
                <span className={`stripe-mock-brand-pill brand-${brand}`}>
                  {brandLabel(brand)}
                </span>
              )}
            </div>
          </label>

          <div className="stripe-mock-field-grid">
            <label className="stripe-mock-field">
              <span className="stripe-mock-label">有効期限</span>
              <input
                type="text"
                inputMode="numeric"
                className="form-input mono stripe-mock-input"
                value={exp}
                onChange={(e) => setExp(formatExp(e.target.value))}
                placeholder="MM/YY"
                autoComplete="cc-exp"
                required
              />
            </label>
            <label className="stripe-mock-field">
              <span className="stripe-mock-label">CVC</span>
              <input
                type="text"
                inputMode="numeric"
                className="form-input mono stripe-mock-input"
                value={cvc}
                onChange={(e) =>
                  setCvc(e.target.value.replace(/\D/g, '').slice(0, 4))
                }
                placeholder="123"
                autoComplete="cc-csc"
                required
              />
            </label>
          </div>

          <p className="stripe-mock-note">
            <Lock size={11} className="inline-icon" />
            このフォームは PCI DSS 準拠の Stripe で直接処理されます。
            カード情報はミテルデのサーバを通過しません。
          </p>

          <div className="stripe-mock-actions">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={onClose}
              disabled={submitting}
            >
              キャンセル
            </button>
            <button
              type="submit"
              className="btn btn-primary stripe-mock-submit"
              disabled={submitting}
            >
              {submitting ? '処理中…' : mode === 'register' ? '登録する' : '更新する'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
