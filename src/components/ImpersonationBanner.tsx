/**
 * テナント UI 上部に固定表示する「サポート閲覧中」警告バー。
 *
 * β-2d-3: impersonation_sessions は RLS ポリシー無し（service_role/Hook
 * のみ）でフロントから読めないため、理由/残り時間/スタッフ名の詳細表示は
 * 廃し、「サポート閲覧中 + 対象テナント名 + 終了ボタン」に集約。
 * 終了は RPC end_impersonation（引数不要、auth.uid() で本人判定）。
 */
import { useState } from 'react'
import { ShieldAlert, X } from 'lucide-react'
import { endImpersonation } from '../admin/lib/impersonation'

type Props = {
  /** 閲覧中の対象テナント名（App 側で activeOrg から解決して渡す） */
  orgName: string
}

export function ImpersonationBanner({ orgName }: Props) {
  const [ending, setEnding] = useState(false)

  async function handleEnd() {
    if (!confirm('サポート閲覧を終了して元の管理画面に戻りますか？')) return
    setEnding(true)
    try {
      await endImpersonation()
    } catch (e) {
      setEnding(false)
      alert(e instanceof Error ? e.message : '終了に失敗しました')
    }
  }

  return (
    <div className="impersonation-banner" role="alert">
      <div className="impersonation-banner-icon" aria-hidden="true">
        <ShieldAlert size={18} />
      </div>
      <div className="impersonation-banner-text">
        <div className="impersonation-banner-title">
          サポートで閲覧中
          <span className="impersonation-banner-meta">→ {orgName}</span>
        </div>
      </div>
      <button
        type="button"
        className="impersonation-banner-end"
        onClick={handleEnd}
        disabled={ending}
      >
        <X size={14} />
        <span>{ending ? '終了中…' : '閲覧を終了'}</span>
      </button>
    </div>
  )
}
