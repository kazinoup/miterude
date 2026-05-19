/**
 * コンテキスト選択画面（β-2d-3: Supabase Auth + RPC ベース）。
 *
 * ログイン中ユーザーが入る権限を選ぶ:
 *  - super_admin: 「スーパーアドミン（/admin）」カード → /admin/dashboard
 *  - 所属テナント: organization_members を Supabase から取得し、選択で
 *    RPC set_active_organization → refreshClaims → そのテナントへ遷移
 *
 * 旧 localStorage（loadAuthSession/saveAuthSession 等）依存は全廃。
 * 6 社以上の所属は検索付き combobox に自動切替（従来仕様踏襲）。
 */
import { useEffect, useMemo, useState } from 'react'
import { ShieldCheck, Building2, X, ChevronRight, Search } from 'lucide-react'
import type { TenantRole } from '../types'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthProvider'
import { refreshClaims } from '../lib/authSession'

const TENANT_COMBOBOX_THRESHOLD = 6

type Props = {
  /** 既存セッションがある場合の「キャンセル」ボタン用。null なら閉じない */
  onCancel: (() => void) | null
}

type Membership = {
  orgId: string
  orgName: string
  orgSlug: string
  role: TenantRole
}

type MemberRow = {
  organization_id: string
  role: TenantRole
  organizations: { name: string; slug: string } | null
}

function tenantRoleLabel(role: TenantRole): string {
  if (role === 'editor') return '編集メンバー'
  return '確認者（dashboard_confirmer）'
}

export function ContextSelectView({ onCancel }: Props) {
  const auth = useAuth()
  const [memberships, setMemberships] = useState<Membership[] | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let mounted = true
    if (!auth.appUserId) {
      setMemberships([])
      return
    }
    supabase
      .from('organization_members')
      .select('organization_id, role, organizations(name, slug)')
      .eq('user_id', auth.appUserId)
      .then(({ data, error }) => {
        if (!mounted) return
        if (error || !data) {
          setMemberships([])
          return
        }
        const rows = data as unknown as MemberRow[]
        setMemberships(
          rows.map((r) => ({
            orgId: r.organization_id,
            orgName: r.organizations?.name ?? r.organization_id,
            orgSlug: r.organizations?.slug ?? '',
            role: r.role,
          })),
        )
      })
    return () => {
      mounted = false
    }
  }, [auth.appUserId])

  const isSuperAdmin = auth.appRole === 'super_admin'

  async function selectTenant(m: Membership) {
    if (busy) return
    setBusy(true)
    const { error } = await supabase.rpc('set_active_organization', {
      p_org: m.orgId,
    })
    if (error) {
      setBusy(false)
      alert(error.message)
      return
    }
    await refreshClaims()
    window.location.assign(m.orgSlug ? `/${m.orgSlug}/dashboard` : '/')
  }

  function goAdmin() {
    window.location.assign('/admin/dashboard')
  }

  const tenantChoices = memberships ?? []
  const useCombobox = tenantChoices.length >= TENANT_COMBOBOX_THRESHOLD
  const activeOrgId = auth.activeOrgId

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
        <p className="ctx-select-sub">どの権限で入りますか？</p>

        <div className="ctx-select-list">
          {isSuperAdmin && (
            <button
              type="button"
              className="ctx-select-item"
              onClick={goAdmin}
            >
              <span className="ctx-select-item-icon" aria-hidden="true">
                <ShieldCheck size={20} />
              </span>
              <span className="ctx-select-item-text">
                <span className="ctx-select-item-title">
                  スーパーアドミン（/admin）
                </span>
                <span className="ctx-select-item-sub">
                  全テナントの管理画面に入る
                </span>
              </span>
              <ChevronRight size={16} className="ctx-select-item-chev" />
            </button>
          )}

          {memberships === null && (
            <div className="ctx-select-empty">読み込み中…</div>
          )}

          {memberships !== null &&
            !isSuperAdmin &&
            tenantChoices.length === 0 && (
              <div className="ctx-select-empty">
                入れるコンテキストがありません。組織への招待を待つか、管理者にお問い合わせください。
              </div>
            )}

          {!useCombobox &&
            tenantChoices.map((m) => {
              const isActive = activeOrgId === m.orgId
              return (
                <button
                  key={m.orgId}
                  type="button"
                  className={`ctx-select-item ${isActive ? 'is-active' : ''}`}
                  onClick={() => selectTenant(m)}
                  disabled={isActive || busy}
                >
                  <span className="ctx-select-item-icon" aria-hidden="true">
                    <Building2 size={20} />
                  </span>
                  <span className="ctx-select-item-text">
                    <span className="ctx-select-item-title">{m.orgName}</span>
                    <span className="ctx-select-item-sub">
                      {tenantRoleLabel(m.role)}
                    </span>
                  </span>
                  {isActive ? (
                    <span className="ctx-select-item-badge">
                      現在ログイン中
                    </span>
                  ) : (
                    <ChevronRight
                      size={16}
                      className="ctx-select-item-chev"
                    />
                  )}
                </button>
              )
            })}

          {useCombobox && (
            <TenantCombobox
              choices={tenantChoices}
              activeOrgId={activeOrgId}
              busy={busy}
              onSelect={selectTenant}
            />
          )}
        </div>
      </div>
    </div>
  )
}

/* ===== 大量テナント向け combobox（6 社以上） ===== */
function TenantCombobox({
  choices,
  activeOrgId,
  busy,
  onSelect,
}: {
  choices: Membership[]
  activeOrgId: string | null
  busy: boolean
  onSelect: (m: Membership) => void
}) {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return choices
    return choices.filter(
      (c) =>
        c.orgName.toLowerCase().includes(q) ||
        c.orgSlug.toLowerCase().includes(q) ||
        c.orgId.toLowerCase().includes(q),
    )
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
            const isActive = activeOrgId === c.orgId
            return (
              <button
                key={c.orgId}
                type="button"
                role="option"
                aria-selected={isActive}
                className={`ctx-tenant-combo-item ${isActive ? 'is-active' : ''}`}
                onClick={() => onSelect(c)}
                disabled={isActive || busy}
              >
                <Building2 size={14} className="ctx-tenant-combo-icon" />
                <span className="ctx-tenant-combo-name">{c.orgName}</span>
                <span className="ctx-tenant-combo-meta mono">
                  {c.orgSlug}
                </span>
                <span className="ctx-tenant-combo-role">
                  {tenantRoleLabel(c.role)}
                </span>
                {isActive && (
                  <span className="ctx-select-item-badge">
                    現在ログイン中
                  </span>
                )}
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}
