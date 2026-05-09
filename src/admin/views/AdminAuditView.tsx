/**
 * Phase A-7: 監査ログ閲覧画面（/admin/audit 相当）。
 *
 * - StaffAuditLog の全エントリを「発生日時の新しい順」でテーブル表示
 * - フィルタ: アクション種別 / ユーザー検索 / テナント絞り込み
 * - 各行に metadata（理由・期限・継続時間）を整形して表示
 *
 * Phase F 以降で Webhook 受信や設定変更も監査対象にする想定なので、
 * action ラベルの辞書は拡張しやすいよう Map で持つ。
 */
import { useMemo, useState } from 'react'
import { History, Search, Filter as FilterIcon } from 'lucide-react'
import {
  loadAuditLogs,
  loadOrganizations,
  loadUsers,
} from '../lib/adminStorage'

type Props = {
  /** 指定があれば、その組織に対する操作だけに固定で絞り込む（テナント詳細タブから再利用） */
  fixedOrganizationId?: string
  /** 余白などをコンパクトにしたい場合（タブ内描画用） */
  compact?: boolean
}

/** action 種別 → 日本語ラベル + 色クラス。未知のものはそのまま表示。 */
const ACTION_META: Record<
  string,
  { label: string; tone: 'info' | 'success' | 'warn' | 'danger' }
> = {
  assignment_granted: { label: '割り当て付与', tone: 'success' },
  assignment_revoked: { label: '割り当て取消', tone: 'warn' },
  impersonation_started: { label: '閲覧開始', tone: 'warn' },
  impersonation_ended: { label: '閲覧終了', tone: 'info' },
}

const ACTION_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'すべてのアクション' },
  { value: 'assignment_granted', label: '割り当て付与' },
  { value: 'assignment_revoked', label: '割り当て取消' },
  { value: 'impersonation_started', label: '閲覧開始' },
  { value: 'impersonation_ended', label: '閲覧終了' },
]

function formatDateTime(d: Date | string | number | undefined): string {
  if (!d) return '—'
  const dt = new Date(d as string | number | Date)
  if (Number.isNaN(dt.getTime())) return '—'
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${dt.getFullYear()}/${pad(dt.getMonth() + 1)}/${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`
}

function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)} 秒`
  const totalMin = Math.floor(ms / 60_000)
  const hours = Math.floor(totalMin / 60)
  const minutes = totalMin % 60
  if (hours > 0) return `${hours} 時間 ${minutes} 分`
  return `${minutes} 分`
}

function summarizeMetadata(
  action: string,
  metadata: Record<string, unknown> | undefined,
): string {
  if (!metadata) return '—'
  const parts: string[] = []
  if (typeof metadata.reason === 'string' && metadata.reason) {
    parts.push(`理由: ${metadata.reason}`)
  }
  if (typeof metadata.expiresAt === 'string') {
    parts.push(`期限: ${formatDateTime(metadata.expiresAt)}`)
  }
  if (typeof metadata.durationMs === 'number') {
    parts.push(`継続: ${formatDuration(metadata.durationMs)}`)
  }
  if (typeof metadata.toStaffUserId === 'string') {
    // assignment_granted 系: 付与先スタッフ ID（後段で名前に変換）
    parts.push(`対象スタッフ ID: ${metadata.toStaffUserId.slice(0, 18)}…`)
  }
  if (
    action === 'assignment_revoked' &&
    typeof metadata.revokedFromStaffUserId === 'string'
  ) {
    parts.push(`対象スタッフ ID: ${metadata.revokedFromStaffUserId.slice(0, 18)}…`)
  }
  return parts.length > 0 ? parts.join(' ・ ') : '—'
}

export function AdminAuditView({
  fixedOrganizationId,
  compact = false,
}: Props) {
  const [actionFilter, setActionFilter] = useState('')
  const [search, setSearch] = useState('')
  const [orgFilter, setOrgFilter] = useState('')

  const { rows, totalCount } = useMemo(() => {
    const logs = loadAuditLogs()
    const users = loadUsers()
    const orgs = loadOrganizations()
    const all = Object.values(logs)
      .filter((l) =>
        fixedOrganizationId ? l.organizationId === fixedOrganizationId : true,
      )
      .map((l) => {
        const actor = users[l.staffUserId]
        const org = l.organizationId ? orgs[l.organizationId] : null
        return {
          ...l,
          actorName: actor?.displayName ?? '(削除済ユーザー)',
          actorEmail: actor?.email ?? '',
          orgName: org?.name ?? (l.organizationId ? '(削除済テナント)' : '—'),
          summary: summarizeMetadata(l.action, l.metadata),
        }
      })
      .sort((a, b) => {
        const at = new Date(a.occurredAt).getTime()
        const bt = new Date(b.occurredAt).getTime()
        return bt - at
      })
    return { rows: all, totalCount: all.length }
  }, [fixedOrganizationId])

  const orgOptions = useMemo(() => {
    const set = new Set<string>()
    rows.forEach((r) => {
      if (r.organizationId) set.add(r.organizationId)
    })
    const orgs = loadOrganizations()
    return Array.from(set)
      .map((id) => ({ id, name: orgs[id]?.name ?? id }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ja'))
  }, [rows])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((r) => {
      if (actionFilter && r.action !== actionFilter) return false
      if (orgFilter && r.organizationId !== orgFilter) return false
      if (q) {
        const blob =
          `${r.actorName} ${r.actorEmail} ${r.orgName} ${r.summary}`.toLowerCase()
        if (!blob.includes(q)) return false
      }
      return true
    })
  }, [rows, actionFilter, orgFilter, search])

  return (
    <div className={`admin-view ${compact ? 'admin-view-compact' : ''}`}>
      {!compact && (
        <header className="admin-view-header">
          <div className="admin-view-header-text">
            <h1 className="admin-view-title">
              <History size={20} />
              <span>監査ログ</span>
            </h1>
            <p className="admin-view-sub">
              スタッフによる割り当て付与・取消、テナント閲覧（impersonation）の操作履歴です。
              Phase F 以降は Webhook 受信や設定変更もここに記録します。
            </p>
          </div>
        </header>
      )}

      <div className="admin-toolbar audit-toolbar">
        <div className="admin-search">
          <Search size={14} />
          <input
            type="search"
            className="form-input"
            placeholder="名前・メール・テナント・理由で検索"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="audit-filter">
          <FilterIcon size={14} />
          <select
            className="select"
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
          >
            {ACTION_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {!fixedOrganizationId && (
            <select
              className="select"
              value={orgFilter}
              onChange={(e) => setOrgFilter(e.target.value)}
            >
              <option value="">すべてのテナント</option>
              {orgOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="admin-count">
          全 <strong>{totalCount}</strong> 件
          {filtered.length !== totalCount && (
            <>
              {' '}・ 一致 <strong>{filtered.length}</strong>
            </>
          )}
        </div>
      </div>

      <div className="admin-table-wrap">
        <table className="admin-table audit-table">
          <thead>
            <tr>
              <th>発生日時</th>
              <th>アクション</th>
              <th>実行者</th>
              {!fixedOrganizationId && <th>テナント</th>}
              <th>詳細</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const meta = ACTION_META[r.action] ?? {
                label: r.action,
                tone: 'info' as const,
              }
              return (
                <tr key={r.id}>
                  <td className="mono">{formatDateTime(r.occurredAt)}</td>
                  <td>
                    <span className={`audit-pill audit-pill-${meta.tone}`}>
                      {meta.label}
                    </span>
                  </td>
                  <td>
                    <div className="audit-actor">
                      <span className="audit-actor-name">{r.actorName}</span>
                      {r.actorEmail && (
                        <span className="audit-actor-email mono">
                          {r.actorEmail}
                        </span>
                      )}
                    </div>
                  </td>
                  {!fixedOrganizationId && <td>{r.orgName}</td>}
                  <td className="audit-summary">{r.summary}</td>
                </tr>
              )
            })}
            {filtered.length === 0 && (
              <tr>
                <td
                  colSpan={fixedOrganizationId ? 4 : 5}
                  className="admin-table-empty"
                >
                  {totalCount === 0
                    ? 'まだ監査ログがありません。'
                    : '一致する監査ログがありません。フィルタを見直してください。'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
