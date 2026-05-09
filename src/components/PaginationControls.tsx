/**
 * 件数表示 + ページ送りボタンの共通コンポーネント。
 *
 * センサー一覧 / アラート一覧など、テーブル形式で「N 件中 A〜B を表示」の
 * 表記とページ送りを揃えたい画面で再利用する。
 */
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react'

type Props = {
  /** 1-based の現在ページ番号 */
  page: number
  totalPages: number
  pageSize: number
  filteredCount: number
  totalCount: number
  onSetPage: (n: number | ((p: number) => number)) => void
  /** 範囲表示の単位（既定: "件"） */
  itemUnit?: string
  /** 「（全 M 単位）」の単位（既定: itemUnit と同じ）。
   *  センサー一覧では "台" を渡す。 */
  totalUnit?: string
}

export function PaginationControls({
  page,
  totalPages,
  pageSize,
  filteredCount,
  totalCount,
  onSetPage,
  itemUnit = '件',
  totalUnit,
}: Props) {
  const start = filteredCount === 0 ? 0 : (page - 1) * pageSize + 1
  const end = Math.min(page * pageSize, filteredCount)
  const isFiltered = filteredCount !== totalCount
  const tu = totalUnit ?? itemUnit
  return (
    <div className="pagination-bar">
      <span className="pagination-info">
        {isFiltered ? (
          <>
            絞り込み <strong>{filteredCount}</strong> {itemUnit}中、
            <strong>
              {start}〜{end}
            </strong>{' '}
            {itemUnit}を表示（全 {totalCount} {tu}）
          </>
        ) : (
          <>
            全 <strong>{totalCount}</strong> {itemUnit}中、
            <strong>
              {start}〜{end}
            </strong>{' '}
            {itemUnit}を表示
          </>
        )}
      </span>
      <div className="pagination-controls">
        <button
          type="button"
          className="icon-btn"
          disabled={page === 1}
          onClick={() => onSetPage(1)}
          aria-label="最初のページ"
        >
          <ChevronsLeft size={16} />
        </button>
        <button
          type="button"
          className="icon-btn"
          disabled={page === 1}
          onClick={() => onSetPage((p) => Math.max(1, p - 1))}
          aria-label="前のページ"
        >
          <ChevronLeft size={16} />
        </button>
        <span className="pagination-current">
          {page} / {totalPages}
        </span>
        <button
          type="button"
          className="icon-btn"
          disabled={page === totalPages}
          onClick={() => onSetPage((p) => Math.min(totalPages, p + 1))}
          aria-label="次のページ"
        >
          <ChevronRight size={16} />
        </button>
        <button
          type="button"
          className="icon-btn"
          disabled={page === totalPages}
          onClick={() => onSetPage(totalPages)}
          aria-label="最後のページ"
        >
          <ChevronsRight size={16} />
        </button>
      </div>
    </div>
  )
}
