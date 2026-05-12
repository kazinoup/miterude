/**
 * テナント側マニュアル閲覧ビュー（/<slug>/manual）。
 *
 * - 左: 2 階層メニュー（読み取り専用）
 * - 右: 選択中ページを BlockNote で閲覧表示
 *
 * 編集は Admin Console 側でのみ可能。テナント側は閲覧専用。
 */
import { useEffect, useMemo, useState } from 'react'
import { BookOpen, ChevronDown, ChevronRight } from 'lucide-react'
import {
  loadManualCategories,
  loadManualPages,
  pagesInCategory,
  sortedCategories,
} from '../../admin/lib/adminStorage'
import { ManualEditor } from '../ManualEditor'
import { useResizableSplitter } from '../../lib/useResizableSplitter'

type Props = {
  activeCategoryId: string | null
  activePageId: string | null
  onSelectionChange: (categoryId: string | null, pageId: string | null) => void
}

export function ManualView({
  activeCategoryId,
  activePageId,
  onSelectionChange,
}: Props) {
  const [categories, setCategories] = useState(() => loadManualCategories())
  const [pages, setPages] = useState(() => loadManualPages())

  // ハイドレーション完了などの外部更新を受けて再読み込み
  useEffect(() => {
    function reload() {
      setCategories(loadManualCategories())
      setPages(loadManualPages())
    }
    window.addEventListener('miterude:manual-changed', reload)
    return () => window.removeEventListener('miterude:manual-changed', reload)
  }, [])

  const catList = useMemo(() => sortedCategories(categories), [categories])

  const [expandedCats, setExpandedCats] = useState<Set<string>>(() => {
    const init = new Set<string>()
    if (activeCategoryId) init.add(activeCategoryId)
    return init
  })

  const { leftWidth, startDrag, dragging } = useResizableSplitter({
    storageKey: 'miterude:ui:manual-tenant-left-width',
    defaultWidth: 260,
    minWidth: 180,
    maxWidth: 480,
  })

  // URL に何も指定がないとき、一番上のカテゴリの最初のページを自動選択
  useEffect(() => {
    if (activePageId) return
    if (catList.length === 0) return
    const firstCat = catList[0]
    const firstPages = pagesInCategory(pages, firstCat.id)
    if (firstPages.length === 0) return
    onSelectionChange(firstCat.id, firstPages[0].id)
    setExpandedCats((prev) => new Set([...prev, firstCat.id]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const activePage =
    activePageId && pages[activePageId] ? pages[activePageId] : null

  return (
    <div className="manual-view">
      <header className="manual-view-head">
        <h1>
          <BookOpen size={20} className="head-icon" />
          マニュアル
        </h1>
        <p className="manual-view-sub muted">
          ミテルデの使い方ガイド。動画と手順を見ながら設定を進めてください。
        </p>
      </header>

      <div
        className={`manual-view-body ${dragging ? 'is-dragging' : ''}`}
        style={{
          gridTemplateColumns: `${leftWidth}px 6px minmax(0, 1fr)`,
        }}
      >
        <aside className="manual-tree manual-tree-readonly">
          {catList.length === 0 ? (
            <div className="manual-tree-empty muted">
              まだマニュアルがありません。運営側で準備中です。
            </div>
          ) : (
            <ul className="manual-tree-list">
              {catList.map((c) => {
                const open = expandedCats.has(c.id)
                const pagesUnder = pagesInCategory(pages, c.id)
                return (
                  <li key={c.id} className="manual-tree-cat">
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
                    {open && (
                      <ul className="manual-tree-page-list">
                        {pagesUnder.map((p) => (
                          <li key={p.id} className="manual-tree-page">
                            <button
                              type="button"
                              className={`manual-tree-page-btn ${activePageId === p.id ? 'is-active' : ''}`}
                              onClick={() => onSelectionChange(c.id, p.id)}
                            >
                              {p.title}
                            </button>
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

        <section className="manual-content manual-content-readonly">
          {activePage ? (
            <>
              <h2 className="manual-content-title">{activePage.title}</h2>
              <ManualEditor
                key={activePage.id}
                initialContent={activePage.content}
                mode="view"
              />
            </>
          ) : (
            <div className="manual-content-empty muted">
              左のメニューからページを選択してください。
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
