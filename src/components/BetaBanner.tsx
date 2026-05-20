/**
 * β-5: β 利用注意 banner。テナント UI の最上部に常設で表示。
 * VITE_BETA_MODE=true のときだけ描画。dismiss は意図的に提供しない
 * （β 期間中は常に意識付けする方針）。
 */
import { AlertTriangle } from 'lucide-react'
import { BETA_MODE, BETA_TERMS_PATH } from '../lib/betaMode'

export function BetaBanner() {
  if (!BETA_MODE) return null
  return (
    <div className="beta-banner" role="status" aria-label="ベータ版のお知らせ">
      <AlertTriangle size={14} aria-hidden="true" />
      <span>
        ミテルデは <strong>β 版</strong>です。
        機能・仕様が予告なく変更される場合があります（SLA / 24h
        サポートは β 期間中対象外）。
        <a href={BETA_TERMS_PATH} className="beta-banner-link">
          β 利用規約
        </a>
      </span>
    </div>
  )
}
