/**
 * β-5: β 利用規約画面（/terms-beta）。
 *
 * 認証不要。BetaBadge / BetaBanner / LoginView からリンクされる。
 * 正式 GA 時にこのファイルを通常の利用規約に差し替える想定。
 */
import { ArrowLeft, ShieldAlert } from 'lucide-react'

export function BetaTermsView() {
  return (
    <div className="beta-terms-page">
      <div className="beta-terms-card">
        <header className="beta-terms-head">
          <div className="beta-terms-eyebrow">
            <ShieldAlert size={16} />
            <span>β 利用規約（先行公開版）</span>
          </div>
          <h1>ミテルデ β 利用規約</h1>
          <p className="muted">
            本ページは β 期間中の暫定的なお知らせを兼ねた利用規約です。
            正式版の利用規約は GA リリース時に改めて提示します。
          </p>
        </header>

        <section className="beta-terms-section">
          <h2>1. 提供形態</h2>
          <p>
            ミテルデ β は限定公開のテスト提供です。
            予告なく機能の追加・変更・停止を行うことがあります。
          </p>
        </section>

        <section className="beta-terms-section">
          <h2>2. SLA / サポート</h2>
          <ul>
            <li>稼働率保証（SLA）は提供しません。</li>
            <li>24 時間サポートは対象外です。営業時間内のメール対応に限ります。</li>
            <li>計画停止・緊急停止が発生する場合があります。</li>
          </ul>
        </section>

        <section className="beta-terms-section">
          <h2>3. データの取り扱い</h2>
          <ul>
            <li>
              β 期間中はステージング扱いです。重要な業務記録の長期保存目的での
              利用はお控えください。
            </li>
            <li>
              提供環境はバックアップが取得されていますが、データ消失のリスクは
              ゼロではありません。
            </li>
            <li>
              送受信される計測値・通知設定等は当社が機能改善のために
              閲覧することがあります（個別の同意取得対象は別途明示します）。
            </li>
          </ul>
        </section>

        <section className="beta-terms-section">
          <h2>4. 課金</h2>
          <p>
            β 期間中の利用料金は <strong>無償</strong> です。
            GA 移行時に料金プランを別途ご案内します。
          </p>
        </section>

        <section className="beta-terms-section">
          <h2>5. 免責</h2>
          <p>
            β 提供物の利用により生じた損害について、当社は故意・重過失の場合を
            除き責任を負いません。
          </p>
        </section>

        <section className="beta-terms-section">
          <h2>6. 問い合わせ</h2>
          <p>
            <a href="mailto:support@miterude.cloud">support@miterude.cloud</a>{' '}
            までご連絡ください。
          </p>
        </section>

        <footer className="beta-terms-foot">
          <a href="/" className="btn btn-secondary">
            <ArrowLeft size={14} />
            <span>戻る</span>
          </a>
          <p className="muted small">最終更新: 2026-05-19</p>
        </footer>
      </div>
    </div>
  )
}
