/**
 * Phase: マニュアル管理ビュー（/admin/manual）。
 *
 * 左カラム = 2 階層メニュー（カテゴリ → ページ）
 * 右カラム = 選択中ページの BlockNote 編集領域
 *
 * 編集権限は super_admin のみ。AdminApp 側で session.kind === 'admin' の
 * チェックを通過したユーザーだけがこの画面に到達する。
 */
import { useEffect, useMemo, useState } from 'react'
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  FolderPlus,
  FilePlus,
  Trash2,
  Save,
  ArrowUp,
  ArrowDown,
} from 'lucide-react'
import type { Block } from '@blocknote/core'
import {
  deleteManualCategory,
  deleteManualPage,
  loadManualCategories,
  loadManualPages,
  newId,
  pagesInCategory,
  saveManualCategories,
  saveManualPages,
  sortedCategories,
  upsertManualCategory,
  upsertManualPage,
} from '../lib/adminStorage'
import {
  deleteManualCategoryFromSupabase,
  deleteManualPageFromSupabase,
  upsertManualCategoryInSupabase,
  upsertManualPageInSupabase,
} from '../../lib/supabaseQueries'
import { isSupabaseConfigured } from '../../lib/supabase'
import { ManualEditor } from '../../components/ManualEditor'
import { toast } from '../../lib/toast'
import { useResizableSplitter } from '../../lib/useResizableSplitter'
import type {
  ManualCategory,
  ManualCategoryStore,
  ManualPage,
  ManualPageStore,
} from '../../types'

type Props = {
  adminUserId: string
  /** Phase 1.5a: super_admin なら編集可、support/sales は読み取り専用 */
  isSuperAdmin: boolean
  activeCategoryId: string | null
  activePageId: string | null
  onSelectionChange: (categoryId: string | null, pageId: string | null) => void
}

export function AdminManualView({
  adminUserId,
  isSuperAdmin,
  activeCategoryId,
  activePageId,
  onSelectionChange,
}: Props) {
  const [categories, setCategories] = useState<ManualCategoryStore>(() =>
    loadManualCategories(),
  )
  const [pages, setPages] = useState<ManualPageStore>(() => loadManualPages())
  const [expandedCats, setExpandedCats] = useState<Set<string>>(() => {
    const init = new Set<string>()
    if (activeCategoryId) init.add(activeCategoryId)
    return init
  })
  const [dirty, setDirty] = useState(false)
  const [draftContent, setDraftContent] = useState<Block[] | null>(null)
  const [editingTitle, setEditingTitle] = useState('')

  const { leftWidth, startDrag, dragging } = useResizableSplitter({
    storageKey: 'miterude:ui:manual-admin-left-width',
    defaultWidth: 280,
    minWidth: 180,
    maxWidth: 560,
  })

  const catList = useMemo(() => sortedCategories(categories), [categories])

  const activePage =
    activePageId && pages[activePageId] ? pages[activePageId] : null

  // ページ切替時にドラフトをリセット
  useEffect(() => {
    setDirty(false)
    setDraftContent(null)
    setEditingTitle(activePage?.title ?? '')
  }, [activePageId, activePage?.title])

  // ハイドレーション完了など、外部から localStorage が更新されたら再読み込み
  useEffect(() => {
    function reload() {
      setCategories(loadManualCategories())
      setPages(loadManualPages())
    }
    window.addEventListener('miterude:manual-changed', reload)
    return () => window.removeEventListener('miterude:manual-changed', reload)
  }, [])

  /* ---------- カテゴリ操作 ---------- */

  /**
   * Supabase 設定時は upsert を直列で打つ（後勝ち）。
   * マイグレーション未適用（テーブル未作成）等で失敗した場合は、
   * 警告だけ出して localStorage 側の更新は続行（pre-migration の救済）。
   */
  function isMissingTableError(err: unknown): boolean {
    if (!err) return false
    const msg = err instanceof Error ? err.message : String(err)
    // PostgREST が返す代表的な「テーブル未作成」エラーメッセージ:
    //  - "Could not find the table 'public.manual_categories' in the schema cache"
    //  - "relation \"manual_pages\" does not exist"
    //  - PGRST106
    return /could not find the table|does not exist|PGRST106/i.test(msg)
  }

  async function pushCategory(c: ManualCategory): Promise<boolean> {
    if (!isSupabaseConfigured()) return true
    try {
      await upsertManualCategoryInSupabase(c)
      return true
    } catch (err) {
      if (isMissingTableError(err)) {
        console.warn(
          '[manual] Supabase manual_categories テーブル未作成。localStorage のみで保存します。',
        )
        return true
      }
      const msg = err instanceof Error ? err.message : String(err)
      toast(`カテゴリの保存に失敗: ${msg.slice(0, 100)}`, 'error')
      return false
    }
  }

  async function pushPage(p: ManualPage): Promise<boolean> {
    if (!isSupabaseConfigured()) return true
    try {
      await upsertManualPageInSupabase(p)
      return true
    } catch (err) {
      if (isMissingTableError(err)) {
        console.warn(
          '[manual] Supabase manual_pages テーブル未作成。localStorage のみで保存します。',
        )
        return true
      }
      const msg = err instanceof Error ? err.message : String(err)
      toast(`ページの保存に失敗: ${msg.slice(0, 100)}`, 'error')
      return false
    }
  }

  async function deleteCategoryRemote(id: string): Promise<boolean> {
    if (!isSupabaseConfigured()) return true
    try {
      await deleteManualCategoryFromSupabase(id)
      return true
    } catch (err) {
      if (isMissingTableError(err)) return true
      const msg = err instanceof Error ? err.message : String(err)
      toast(`カテゴリの削除に失敗: ${msg.slice(0, 100)}`, 'error')
      return false
    }
  }

  async function deletePageRemote(id: string): Promise<boolean> {
    if (!isSupabaseConfigured()) return true
    try {
      await deleteManualPageFromSupabase(id)
      return true
    } catch (err) {
      if (isMissingTableError(err)) return true
      const msg = err instanceof Error ? err.message : String(err)
      toast(`ページの削除に失敗: ${msg.slice(0, 100)}`, 'error')
      return false
    }
  }

  async function addCategory() {
    const name = window.prompt('カテゴリ名（例: 初期設定 / レポート）')
    if (!name || !name.trim()) return
    const maxOrder = catList.reduce((m, c) => Math.max(m, c.sortOrder), -1)
    const c: ManualCategory = {
      id: newId('cat'),
      name: name.trim(),
      sortOrder: maxOrder + 1,
      updatedAt: new Date(),
    }
    if (!(await pushCategory(c))) return
    const next = upsertManualCategory(categories, c)
    setCategories(next)
    saveManualCategories(next)
    setExpandedCats((prev) => new Set([...prev, c.id]))
    toast(`カテゴリ「${c.name}」を作成しました`, 'success')
  }

  async function renameCategory(c: ManualCategory) {
    const name = window.prompt('カテゴリ名', c.name)
    if (name == null) return
    const trimmed = name.trim()
    if (!trimmed) return
    const updated: ManualCategory = { ...c, name: trimmed, updatedAt: new Date() }
    if (!(await pushCategory(updated))) return
    const next = upsertManualCategory(categories, updated)
    setCategories(next)
    saveManualCategories(next)
  }

  async function deleteCategory(c: ManualCategory) {
    const pageCount = pagesInCategory(pages, c.id).length
    const ok = window.confirm(
      `カテゴリ「${c.name}」を削除します。配下の ${pageCount} ページも削除されます。よろしいですか？`,
    )
    if (!ok) return
    // Supabase は FK on delete cascade なので、カテゴリ削除でページも消える
    if (!(await deleteCategoryRemote(c.id))) return
    let nextPages = pages
    for (const p of pagesInCategory(pages, c.id)) {
      nextPages = deleteManualPage(nextPages, p.id)
    }
    const nextCats = deleteManualCategory(categories, c.id)
    setPages(nextPages)
    setCategories(nextCats)
    saveManualPages(nextPages)
    saveManualCategories(nextCats)
    if (activeCategoryId === c.id) onSelectionChange(null, null)
    toast(`カテゴリ「${c.name}」を削除しました`, 'success')
  }

  async function moveCategory(c: ManualCategory, dir: -1 | 1) {
    const idx = catList.findIndex((x) => x.id === c.id)
    const swap = catList[idx + dir]
    if (!swap) return
    const newA: ManualCategory = {
      ...c,
      sortOrder: swap.sortOrder,
      updatedAt: new Date(),
    }
    const newB: ManualCategory = {
      ...swap,
      sortOrder: c.sortOrder,
      updatedAt: new Date(),
    }
    if (!(await pushCategory(newA))) return
    if (!(await pushCategory(newB))) return
    let next = upsertManualCategory(categories, newA)
    next = upsertManualCategory(next, newB)
    setCategories(next)
    saveManualCategories(next)
  }

  /* ---------- ページ操作 ---------- */

  async function addPage(c: ManualCategory) {
    const title = window.prompt(`「${c.name}」配下に新規ページ。タイトル？`)
    if (!title || !title.trim()) return
    const inCat = pagesInCategory(pages, c.id)
    const maxOrder = inCat.reduce((m, p) => Math.max(m, p.sortOrder), -1)
    const p: ManualPage = {
      id: newId('page'),
      categoryId: c.id,
      title: title.trim(),
      sortOrder: maxOrder + 1,
      content: null,
      updatedAt: new Date(),
      updatedByUserId: adminUserId,
    }
    if (!(await pushPage(p))) return
    const next = upsertManualPage(pages, p)
    setPages(next)
    saveManualPages(next)
    setExpandedCats((prev) => new Set([...prev, c.id]))
    onSelectionChange(c.id, p.id)
  }

  async function deletePage(p: ManualPage) {
    const ok = window.confirm(`ページ「${p.title}」を削除します。よろしいですか？`)
    if (!ok) return
    if (!(await deletePageRemote(p.id))) return
    const next = deleteManualPage(pages, p.id)
    setPages(next)
    saveManualPages(next)
    if (activePageId === p.id) onSelectionChange(p.categoryId, null)
    toast('ページを削除しました', 'success')
  }

  async function movePage(p: ManualPage, dir: -1 | 1) {
    const sib = pagesInCategory(pages, p.categoryId)
    const idx = sib.findIndex((x) => x.id === p.id)
    const swap = sib[idx + dir]
    if (!swap) return
    const newA: ManualPage = { ...p, sortOrder: swap.sortOrder, updatedAt: new Date() }
    const newB: ManualPage = { ...swap, sortOrder: p.sortOrder, updatedAt: new Date() }
    if (!(await pushPage(newA))) return
    if (!(await pushPage(newB))) return
    let next = upsertManualPage(pages, newA)
    next = upsertManualPage(next, newB)
    setPages(next)
    saveManualPages(next)
  }

  /* ---------- 編集保存 ---------- */

  function handleEditorChange(blocks: Block[]) {
    setDraftContent(blocks)
    setDirty(true)
  }

  function handleTitleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setEditingTitle(e.target.value)
    setDirty(true)
  }

  async function handleSave() {
    if (!activePage) return
    const updated: ManualPage = {
      ...activePage,
      title: editingTitle.trim() || activePage.title,
      content: draftContent ?? activePage.content ?? null,
      updatedAt: new Date(),
      updatedByUserId: adminUserId,
    }
    if (!(await pushPage(updated))) return
    const next = upsertManualPage(pages, updated)
    setPages(next)
    saveManualPages(next)
    setDirty(false)
    toast('ページを保存しました', 'success')
  }

  return (
    <div className={`admin-view manual-admin-view ${!isSuperAdmin ? 'manual-admin-readonly' : ''}`}>
      <header className="manual-admin-head">
        <h1 className="manual-admin-title">
          <BookOpen size={20} />
          <span>マニュアル</span>
        </h1>
        <p className="manual-admin-sub muted">
          全テナント共通のマニュアル。
          {isSuperAdmin
            ? 'super_admin が編集でき、support/sales および テナントは閲覧のみ可能です。'
            : 'システム管理者のみが編集可。あなたは閲覧のみできます。'}
        </p>
      </header>

      <div
        className={`manual-admin-body ${dragging ? 'is-dragging' : ''}`}
        style={{
          gridTemplateColumns: `${leftWidth}px 6px minmax(0, 1fr)`,
        }}
      >
        <aside className="manual-tree">
          <div className="manual-tree-head">
            <span className="manual-tree-title">カテゴリ / ページ</span>
            {isSuperAdmin && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={addCategory}
                title="新規カテゴリ"
              >
                <FolderPlus size={14} />
                <span>カテゴリ</span>
              </button>
            )}
          </div>
          {catList.length === 0 ? (
            <div className="manual-tree-empty muted">
              まだカテゴリがありません。「カテゴリ」ボタンから最初のカテゴリを作成してください。
            </div>
          ) : (
            <ul className="manual-tree-list">
              {catList.map((c, ci) => {
                const open = expandedCats.has(c.id)
                const pagesUnder = pagesInCategory(pages, c.id)
                return (
                  <li key={c.id} className="manual-tree-cat">
                    <div className="manual-tree-cat-row">
                      <button
                        type="button"
                        className="manual-tree-toggle"
                        onClick={() => {
                          setExpandedCats((prev) => {
                            const next = new Set(prev)
                            if (next.has(c.id)) next.delete(c.id)
                            else next.add(c.id)
                            return next
                          })
                        }}
                      >
                        {open ? (
                          <ChevronDown size={14} />
                        ) : (
                          <ChevronRight size={14} />
                        )}
                        <span className="manual-tree-cat-name">{c.name}</span>
                      </button>
                      <span className="manual-tree-cat-actions">
                        <button
                          type="button"
                          className="icon-btn"
                          title="上へ"
                          onClick={() => moveCategory(c, -1)}
                          disabled={ci === 0}
                        >
                          <ArrowUp size={12} />
                        </button>
                        <button
                          type="button"
                          className="icon-btn"
                          title="下へ"
                          onClick={() => moveCategory(c, 1)}
                          disabled={ci === catList.length - 1}
                        >
                          <ArrowDown size={12} />
                        </button>
                        <button
                          type="button"
                          className="icon-btn"
                          title="名前変更"
                          onClick={() => renameCategory(c)}
                        >
                          ✎
                        </button>
                        <button
                          type="button"
                          className="icon-btn"
                          title="ページ追加"
                          onClick={() => addPage(c)}
                        >
                          <FilePlus size={12} />
                        </button>
                        <button
                          type="button"
                          className="icon-btn danger"
                          title="カテゴリ削除"
                          onClick={() => deleteCategory(c)}
                        >
                          <Trash2 size={12} />
                        </button>
                      </span>
                    </div>
                    {open && pagesUnder.length === 0 && (
                      <div className="manual-tree-empty-sub muted">
                        ページなし
                      </div>
                    )}
                    {open && (
                      <ul className="manual-tree-page-list">
                        {pagesUnder.map((p, pi) => (
                          <li key={p.id} className="manual-tree-page">
                            <button
                              type="button"
                              className={`manual-tree-page-btn ${activePageId === p.id ? 'is-active' : ''}`}
                              onClick={() => onSelectionChange(c.id, p.id)}
                            >
                              {p.title}
                            </button>
                            <span className="manual-tree-page-actions">
                              <button
                                type="button"
                                className="icon-btn"
                                title="上へ"
                                onClick={() => movePage(p, -1)}
                                disabled={pi === 0}
                              >
                                <ArrowUp size={11} />
                              </button>
                              <button
                                type="button"
                                className="icon-btn"
                                title="下へ"
                                onClick={() => movePage(p, 1)}
                                disabled={pi === pagesUnder.length - 1}
                              >
                                <ArrowDown size={11} />
                              </button>
                              <button
                                type="button"
                                className="icon-btn danger"
                                title="ページ削除"
                                onClick={() => deletePage(p)}
                              >
                                <Trash2 size={11} />
                              </button>
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </aside>

        <div
          className="manual-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="左カラムの幅をリサイズ"
          onMouseDown={startDrag}
        />

        <section className="manual-content">
          {activePage ? (
            <>
              <div className="manual-content-head">
                {isSuperAdmin ? (
                  <input
                    className="manual-content-title-input"
                    type="text"
                    value={editingTitle}
                    onChange={handleTitleChange}
                    placeholder="ページタイトル"
                  />
                ) : (
                  <h2 className="manual-content-title">{activePage.title}</h2>
                )}
                {isSuperAdmin && (
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={handleSave}
                    disabled={!dirty}
                  >
                    <Save size={14} />
                    <span>保存</span>
                  </button>
                )}
              </div>
              <ManualEditor
                key={activePage.id}
                initialContent={activePage.content}
                mode={isSuperAdmin ? 'edit' : 'view'}
                onChange={handleEditorChange}
              />
            </>
          ) : (
            <div className="manual-content-empty muted">
              {isSuperAdmin
                ? '左の一覧からページを選ぶか、「ページ追加」で作成してください。'
                : '左の一覧からページを選択してください。'}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
