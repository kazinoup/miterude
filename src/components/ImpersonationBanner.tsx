/**
 * Phase A-6: テナント UI 上部に固定表示する「サポート閲覧中」警告バー。
 *
 * impersonation セッション中だけ描画される。バナーには:
 *   - 閲覧中スタッフの名前 / メール
 *   - 対象テナント名（actingAsOrganizationId から解決）
 *   - 開始時の理由
 *   - 残り時間（expiresAt まで、毎分更新）
 *   - 「閲覧を終了する」ボタン → endImpersonation() で起動前セッションへ復帰
 *
 * 顧客の通常ログインと混同しないよう、ナビ上部に固定して常時視認させる。
 */
import { useEffect, useMemo, useState } from 'react'
import { ShieldAlert, X } from 'lucide-react'
import {
  loadOrganizations,
  loadUsers,
} from '../admin/lib/adminStorage'
import { endImpersonation } from '../admin/lib/impersonation'

type Props = {
  /** 現在の impersonation セッション（呼び出し側で kind を絞ってから渡す） */
  session: {
    userId: string
    actingAsOrganizationId: string
    reason: string
    startedAt: Date | string
    expiresAt: Date | string
  }
  /** 退避先が無いときのフォールバック用 admin userId（モック既定: super_admin） */
  fallbackAdminUserId: string
}

function formatRemaining(expiresAtMs: number, now: number): string {
  const diff = expiresAtMs - now
  if (diff <= 0) return '期限切れ（即解除推奨）'
  const totalMin = Math.floor(diff / 60000)
  const hours = Math.floor(totalMin / 60)
  const minutes = totalMin % 60
  if (hours > 0) return `あと ${hours} 時間 ${minutes} 分`
  if (minutes > 0) return `あと ${minutes} 分`
  return '残り 1 分未満'
}

export function ImpersonationBanner({ session, fallbackAdminUserId }: Props) {
  const [now, setNow] = useState(() => Date.now())

  // 1 分ごとに残り時間を更新
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60000)
    return () => clearInterval(id)
  }, [])

  const { staffName, staffEmail, orgName } = useMemo(() => {
    const users = loadUsers()
    const orgs = loadOrganizations()
    const u = users[session.userId]
    const o = orgs[session.actingAsOrganizationId]
    return {
      staffName: u?.displayName ?? '(不明)',
      staffEmail: u?.email ?? '',
      orgName: o?.name ?? session.actingAsOrganizationId,
    }
  }, [session.userId, session.actingAsOrganizationId])

  const expiresAtMs = useMemo(
    () => new Date(session.expiresAt).getTime(),
    [session.expiresAt],
  )
  const remaining = formatRemaining(expiresAtMs, now)
  const isExpired = expiresAtMs <= now

  function handleEnd() {
    if (!confirm('サポート閲覧を終了して元の管理画面に戻りますか？')) return
    endImpersonation(fallbackAdminUserId)
  }

  return (
    <div
      className={`impersonation-banner ${isExpired ? 'is-expired' : ''}`}
      role="alert"
    >
      <div className="impersonation-banner-icon" aria-hidden="true">
        <ShieldAlert size={18} />
      </div>
      <div className="impersonation-banner-text">
        <div className="impersonation-banner-title">
          サポートで閲覧中
          <span className="impersonation-banner-meta">
            {staffName}（{staffEmail}）→ {orgName}
          </span>
        </div>
        <div className="impersonation-banner-detail">
          <span className="impersonation-banner-reason" title={session.reason}>
            理由: {session.reason}
          </span>
          <span className="impersonation-banner-remaining">{remaining}</span>
        </div>
      </div>
      <button
        type="button"
        className="impersonation-banner-end"
        onClick={handleEnd}
      >
        <X size={14} />
        <span>閲覧を終了</span>
      </button>
    </div>
  )
}
