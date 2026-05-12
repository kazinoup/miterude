/**
 * Phase A-2: コンテキスト選択画面
 *
 * ログイン中のユーザーが、自分が入る「コンテキスト」（スーパーアドミン or 各組織の
 * メンバーシップ）を選ぶ画面。ユーザーメニューの「コンテキストを切り替え」から起動。
 *
 * 将来 Phase D で Clerk 認証完了直後の遷移先としても再利用する想定。
 *
 * テナントが多いケース（10〜30 社以上）への配慮:
 *  - 6 社以上の所属がある場合は **検索付き combobox** モードに自動切替し、
 *    縦に伸び続けるリストを抑制する。スーパーアドミンのカードは常に上部に固定。
 */
import { useMemo, useState } from 'react'
import { ShieldCheck, Building2, X, ChevronRight, Search } from 'lucide-react'
import type { AuthSession, AppUser, Organization, TenantRole } from '../types'
import {
  loadAuthSession,
  loadOrganizationMembers,
  loadOrganizations,
  loadUsers,
  saveAuthSession,
} from '../admin/lib/adminStorage'

/** 何社以上の所属でリスト表示 → combobox に切り替えるか。 */
const TENANT_COMBOBOX_THRESHOLD = 6

type Props = {
  /** 既存セッションがある場合の「キャンセル」ボタン用。null の場合は閉じるボタンを出さない */
  onCancel: (() => void) | null
}

type ContextChoice = {
  key: string
  kind: 'admin' | 'tenant'
  /** 組織カード時の Organization。admin カード時は null */
  organization: Organization | null
  /** 組織カード時のロール（編集メンバー / 確認者）。admin カード時は null */
  tenantRole: TenantRole | null
  session: AuthSession
}

function tenantRoleLabel(role: TenantRole): string {
  if (role === 'editor') return '編集メンバー'
  return '確認者（dashboard_confirmer）'
}

/** ログイン中ユーザーが入れる全コンテキストを組み立てる */
function buildChoicesForUser(user: AppUser): ContextChoice[] {
  const orgs = loadOrganizations()
  const members = loadOrganizationMembers()
  const choices: ContextChoice[] = []

  if (user.systemRole === 'super_admin') {
    choices.push({
      key: 'admin',
      kind: 'admin',
      organization: null,
      tenantRole: null,
      session: { kind: 'admin', userId: user.id },
    })
  }

  const memberships = Object.values(members).filter((m) => m.userId === user.id)
  for (const m of memberships) {
    const org = orgs[m.organizationId]
    if (!org) continue
    choices.push({
      key: `tenant-${org.id}`,
      kind: 'tenant',
      organization: org,
      tenantRole: m.role,
      session: { kind: 'tenant', userId: user.id, organizationId: org.id },
    })
  }
  return choices
}

export function ContextSelectView({ onCancel }: Props) {
  const session = loadAuthSession()
  const users = loadUsers()
  const currentUser = session ? users[session.userId] : null

  if (!currentUser) {
    // モック期は seed で必ずユーザーが入っているはずだが、念のためのフォールバック
    return (
      <div className="ctx-select-shell">
        <div className="ctx-select-card">
          <p>ログインユーザーが特定できませんでした。</p>
        </div>
      </div>
    )
  }

  const choices = buildChoicesForUser(currentUser)
  const adminChoice = choices.find((c) => c.kind === 'admin')
  const tenantChoices = choices.filter((c) => c.kind === 'tenant')
  const useCombobox = tenantChoices.length >= TENANT_COMBOBOX_THRESHOLD

  function handleSelect(s: AuthSession) {
    saveAuthSession(s)
    // セッション切替は影響範囲が広いのでリロードで反映（モックの簡略化、A-1 と同じ）
    window.location.reload()
  }

  // 現在アクティブなコンテキストを判別してカードに「現在ログイン中」マークを付ける
  const activeKey =
    session?.kind === 'admin'
      ? 'admin'
      : session?.kind === 'tenant'
        ? `tenant-${session.organizationId}`
        : null

  return (
    <div className="ctx-select-shell">
      <div className="ctx-select-card">
        {onCancel && (
          <button
            type="button"
            className="ctx-select-close"
            onClick={onCancel}
            aria-label="閉じる"
          >
            <X size={18} />
          </button>
        )}
        <div className="ctx-select-brand">ミテルデ</div>
        <h1 className="ctx-select-heading">アカウントを選んでください</h1>
        <p className="ctx-select-sub">
          {currentUser.displayName}（{currentUser.email}）として、どの権限で入りますか？
        </p>

        <div className="ctx-select-list">
          {/* スーパーアドミンは常に最上部のカード（最大 1 件、伸びない） */}
          {adminChoice && (
            <ContextChoiceButton
              choice={adminChoice}
              isActive={activeKey === adminChoice.key}
              onSelect={handleSelect}
            />
          )}

          {choices.length === 0 && (
            <div className="ctx-select-empty">
              入れるコンテキストがありません。組織への招待を待つか、管理者にお問い合わせください。
            </div>
          )}

          {/* テナント所属が少なければカード、多ければ検索付き combobox に切替 */}
          {tenantChoices.length > 0 && !useCombobox &&
            tenantChoices.map((c) => (
              <ContextChoiceButton
                key={c.key}
                choice={c}
                isActive={activeKey === c.key}
                onSelect={handleSelect}
              />
            ))}

          {useCombobox && (
            <TenantCombobox
              choices={tenantChoices}
              activeKey={activeKey}
              onSelect={handleSelect}
            />
          )}
        </div>

        <div className="ctx-select-foot">
          Supabase 統合後は Clerk 認証直後にこの画面が表示されます
        </div>
      </div>
    </div>
  )
}

/* ===== 単票カード（admin / 少数テナント用） ===== */
function ContextChoiceButton({
  choice,
  isActive,
  onSelect,
}: {
  choice: ContextChoice
  isActive: boolean
  onSelect: (s: AuthSession) => void
}) {
  return (
    <button
      type="button"
      className={`ctx-select-item ${isActive ? 'is-active' : ''}`}
      onClick={() => onSelect(choice.session)}
      disabled={isActive}
    >
      <span className="ctx-select-item-icon" aria-hidden="true">
        {choice.kind === 'admin' ? (
          <ShieldCheck size={20} />
        ) : (
          <Building2 size={20} />
        )}
      </span>
      <span className="ctx-select-item-text">
        <span className="ctx-select-item-title">
          {choice.kind === 'admin'
            ? 'スーパーアドミン（/admin）'
            : choice.organization!.name}
        </span>
        <span className="ctx-select-item-sub">
          {choice.kind === 'admin'
            ? '全テナントの管理画面に入る'
            : tenantRoleLabel(choice.tenantRole!)}
        </span>
      </span>
      {isActive ? (
        <span className="ctx-select-item-badge">現在ログイン中</span>
      ) : (
        <ChevronRight size={16} className="ctx-select-item-chev" />
      )}
    </button>
  )
}

/* ===== 大量テナント向け combobox =====
 *
 * 6 社以上の所属がある場合に表示。検索ボックスでテナント名 / 契約ID /
 * UUID で部分一致絞り込み、スクロール領域内に収める。
 */
function TenantCombobox({
  choices,
  activeKey,
  onSelect,
}: {
  choices: ContextChoice[]
  activeKey: string | null
  onSelect: (s: AuthSession) => void
}) {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return choices
    return choices.filter((c) => {
      const o = c.organization
      if (!o) return false
      return (
        o.name.toLowerCase().includes(q) ||
        o.slug.toLowerCase().includes(q) ||
        o.id.toLowerCase().includes(q)
      )
    })
  }, [choices, query])

  return (
    <div className="ctx-tenant-combo">
      <div className="ctx-tenant-combo-head">
        <span className="ctx-tenant-combo-label">
          所属テナント（{choices.length} 社）
        </span>
        <div className="ctx-tenant-combo-search">
          <Search size={14} aria-hidden="true" />
          <input
            type="search"
            className="form-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="テナント名・契約IDで検索"
            autoFocus
          />
        </div>
      </div>
      <div
        className="ctx-tenant-combo-list"
        role="listbox"
        aria-label="所属テナント"
      >
        {filtered.length === 0 ? (
          <div className="ctx-tenant-combo-empty">
            該当するテナントが見つかりませんでした。
          </div>
        ) : (
          filtered.map((c) => {
            const isActive = activeKey === c.key
            return (
              <button
                key={c.key}
                type="button"
                role="option"
                aria-selected={isActive}
                className={`ctx-tenant-combo-item ${isActive ? 'is-active' : ''}`}
                onClick={() => onSelect(c.session)}
                disabled={isActive}
              >
                <Building2 size={14} className="ctx-tenant-combo-icon" />
                <span className="ctx-tenant-combo-name">
                  {c.organization!.name}
                </span>
                <span className="ctx-tenant-combo-meta mono">
                  {c.organization!.slug}
                </span>
                <span className="ctx-tenant-combo-role">
                  {tenantRoleLabel(c.tenantRole!)}
                </span>
                {isActive && (
                  <span className="ctx-select-item-badge">現在ログイン中</span>
                )}
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}
