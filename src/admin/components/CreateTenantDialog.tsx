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
import type { Organization } from '../../types'

type Props = {
  onClose: () => void
  onCreated: (orgId: string) => void
}

/** 入力された name から slug を粗く生成（半角英数とハイフンのみ） */
function suggestSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\s-]+/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
}

export function CreateTenantDialog({ onClose, onCreated }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [plan, setPlan] = useState<Organization['plan']>('demo')

  useEffect(() => {
    const dlg = ref.current
    if (!dlg) return
    if (!dlg.open) dlg.showModal()
    return () => {
      if (dlg.open) dlg.close()
    }
  }, [])

  // name を変えたとき、ユーザーが slug を手動編集していなければ自動追従
  useEffect(() => {
    if (!slugTouched) setSlug(suggestSlug(name))
  }, [name, slugTouched])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmedName = name.trim()
    const trimmedSlug = slug.trim()
    if (!trimmedName) {
      alert('テナント名を入力してください。')
      return
    }
    if (!trimmedSlug) {
      alert('スラグを入力してください。')
      return
    }

    const orgs = loadOrganizations()
    // slug の重複チェック（業務的に slug が衝突するとあとで困る）
    const dup = Object.values(orgs).find((o) => o.slug === trimmedSlug)
    if (dup) {
      alert(
        `スラグ「${trimmedSlug}」は既に「${dup.name}」で使われています。別のスラグを指定してください。`,
      )
      return
    }

    const id = newId('org')
    const org: Organization = {
      id,
      name: trimmedName,
      slug: trimmedSlug,
      plan,
      createdAt: new Date(),
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
              スラグ
            </label>
            <input
              id="tenant-slug"
              className="form-input mono"
              type="text"
              value={slug}
              onChange={(e) => {
                setSlug(e.target.value)
                setSlugTouched(true)
              }}
              placeholder="abc-foods"
            />
            <p className="form-help">
              URL や識別子に使う。半角英数とハイフン推奨。名前から自動生成されますが編集可能です。
            </p>
          </div>

          <div className="form-row">
            <label className="form-label" htmlFor="tenant-plan">
              プラン
            </label>
            <select
              id="tenant-plan"
              className="select"
              value={plan}
              onChange={(e) => setPlan(e.target.value as Organization['plan'])}
            >
              <option value="demo">デモ</option>
              <option value="standard">スタンダード</option>
              <option value="enterprise">エンタープライズ</option>
            </select>
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
