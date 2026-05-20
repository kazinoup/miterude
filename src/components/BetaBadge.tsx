/**
 * β-5: 「β」バッジ。VITE_BETA_MODE=true のときだけ表示。
 * サイドバーのブランド横、ログイン画面などで使う想定。
 */
import { BETA_MODE, BETA_TERMS_PATH } from '../lib/betaMode'

type Props = {
  /** クリックで /terms-beta へ遷移するか（既定 true）。link 化したくない場合 false。 */
  asLink?: boolean
  /** 大きさ（既定 'sm'）。 */
  size?: 'sm' | 'md'
}

export function BetaBadge({ asLink = true, size = 'sm' }: Props) {
  if (!BETA_MODE) return null
  const className = `beta-badge beta-badge-${size}`
  if (asLink) {
    return (
      <a
        href={BETA_TERMS_PATH}
        className={className}
        title="β 期間中。クリックで利用規約を表示"
      >
        β
      </a>
    )
  }
  return (
    <span className={className} aria-label="ベータ版">
      β
    </span>
  )
}
