import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ClipboardCheck,
  Pencil,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  Trash2,
  LayoutDashboard,
  Cpu,
  X,
} from 'lucide-react'
import type {
  DashboardCheckin,
  DashboardCheckinStore,
  DashboardStore,
  SensorNoteStore,
  SensorStore,
  UserSession,
} from '../../types'
import { SENSOR_NOTE_CATEGORY_LABELS } from '../../types'
import { PaginationControls } from '../PaginationControls'

type Props = {
  checkins: DashboardCheckinStore
  sensorNotes: SensorNoteStore
  dashboards: DashboardStore
  sensors: SensorStore
  session: UserSession
  onApproveCheckin: (id: string) => void
  onApproveNote: (id: string) => void
  onDeleteCheckin: (id: string) => void
  onDeleteNote: (id: string) => void
  onOpenSensor: (sensorId: string) => void
}

type Tab = 'checkins' | 'notes'

const TABS: { key: Tab; label: string; icon: React.ComponentType<{ size?: number }> }[] = [
  { key: 'checkins', label: 'ダッシュボード確認', icon: LayoutDashboard },
  { key: 'notes', label: 'センサー運用メモ', icon: Cpu },
]

function fmtDateTime(d: Date): string {
  return d.toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** YYYY/MM/DD 形式（日付のみ） */
function fmtDateOnly(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}/${m}/${day}`
}

/** 確認チェックインの「期間」セル表示。
 *  開始日と終了日が同じ日なら 1 日だけ、違えば「開始〜終了」を返す。
 *  snapshot に範囲が無ければ periodLabel を fallback。
 *  rangeStart/End は永続化経路によっては string で渡されるため Date 化を試みる。 */
function fmtCheckinPeriod(c: DashboardCheckin): string {
  const start = toDate(c.snapshot.rangeStart)
  const end = toDate(c.snapshot.rangeEnd)
  if (start && end) {
    const sd = fmtDateOnly(start)
    const ed = fmtDateOnly(end)
    return sd === ed ? sd : `${sd} 〜 ${ed}`
  }
  return c.snapshot.periodLabel ?? `直近 ${c.snapshot.lookbackHours} 時間`
}

/** Date | string | undefined を Date | null に正規化 */
function toDate(v: unknown): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v
  if (typeof v === 'string' || typeof v === 'number') {
    const d = new Date(v)
    return Number.isNaN(d.getTime()) ? null : d
  }
  return null
}

/** メモ詳細モーダル用に、1 チェックインに紐づくメモを全部集める。
 *  全体メモ・各センサーコメント・逸脱期間メモ・承認コメントの順。 */
type CollectedMemo = { label: string; text: string }

function collectMemos(c: DashboardCheckin): CollectedMemo[] {
  const out: CollectedMemo[] = []
  if (c.comment && c.comment.trim()) {
    out.push({ label: '全体メモ', text: c.comment.trim() })
  }
  for (const sc of c.sensorComments ?? []) {
    if (sc.comment && sc.comment.trim()) {
      out.push({ label: `${sc.sensorName}（センサー）`, text: sc.comment.trim() })
    }
    for (const seg of sc.segmentComments ?? []) {
      if (seg.memo && seg.memo.trim()) {
        const metric = seg.metric === 'temperature' ? '温度' : '湿度'
        const dir =
          seg.direction === 'above'
            ? '上限超え'
            : seg.direction === 'below'
              ? '下限割れ'
              : '上下動'
        out.push({
          label: `${sc.sensorName} / ${metric}${dir}`,
          text: seg.memo.trim(),
        })
      }
    }
  }
  if (c.approval?.comment && c.approval.comment.trim()) {
    out.push({ label: '承認コメント', text: c.approval.comment.trim() })
  }
  return out
}

export function RecordsView({
  checkins,
  sensorNotes,
  dashboards,
  sensors,
  session: _session,
  onApproveCheckin,
  onApproveNote,
  onDeleteCheckin,
  onDeleteNote,
  onOpenSensor,
}: Props) {
  const [tab, setTab] = useState<Tab>('checkins')
  const [filterStatus, setFilterStatus] = useState<'all' | 'pending' | 'approved'>('all')

  /** 確認履歴 Grid のページネーション（1 ページ 50 件） */
  const CHECKIN_PAGE_SIZE = 50
  const [checkinPage, setCheckinPage] = useState(1)

  /** メモ詳細モーダル（複数メモのとき「+N」クリックで開く） */
  const [memoModalCheckin, setMemoModalCheckin] = useState<DashboardCheckin | null>(null)

  // ワイド表示固定（センサー一覧と同じ扱い）
  useEffect(() => {
    const el = document.querySelector('.app-content-inner')
    if (!el) return
    el.classList.add('is-wide')
    return () => {
      el.classList.remove('is-wide')
    }
  }, [])

  // フィルタ / タブ切替で 1 ページ目に戻す
  useEffect(() => {
    setCheckinPage(1)
  }, [tab, filterStatus])

  const checkinList = useMemo(
    () =>
      Object.values(checkins).sort(
        (a, b) => b.timestamp.getTime() - a.timestamp.getTime(),
      ),
    [checkins],
  )

  const noteList = useMemo(
    () =>
      Object.values(sensorNotes).sort(
        (a, b) => b.timestamp.getTime() - a.timestamp.getTime(),
      ),
    [sensorNotes],
  )

  const filteredCheckins = useMemo(() => {
    if (filterStatus === 'all') return checkinList
    if (filterStatus === 'pending') return checkinList.filter((c) => !c.approval)
    return checkinList.filter((c) => !!c.approval)
  }, [checkinList, filterStatus])

  const filteredNotes = useMemo(() => {
    if (filterStatus === 'all') return noteList
    if (filterStatus === 'pending') return noteList.filter((n) => !n.approval)
    return noteList.filter((n) => !!n.approval)
  }, [noteList, filterStatus])

  const totalPending = useMemo(() => {
    return (
      checkinList.filter((c) => !c.approval).length +
      noteList.filter((n) => !n.approval).length
    )
  }, [checkinList, noteList])

  // 確認履歴 Grid のページ管理
  const checkinTotalPages = Math.max(1, Math.ceil(filteredCheckins.length / CHECKIN_PAGE_SIZE))
  const checkinCurrentPage = Math.min(Math.max(1, checkinPage), checkinTotalPages)
  const pagedCheckins = filteredCheckins.slice(
    (checkinCurrentPage - 1) * CHECKIN_PAGE_SIZE,
    checkinCurrentPage * CHECKIN_PAGE_SIZE,
  )

  return (
    <div className="records-view">
      <header className="view-header">
        <div className="view-header-text">
          <h1>
            <ClipboardCheck size={20} className="head-icon" />
            記録履歴
          </h1>
          <p>
            ダッシュボードの確認チェックインと、センサーごとの運用メモを時系列で残します。
            元のダッシュボードやセンサーが削除されても履歴は保持されます。
          </p>
        </div>
        <div className="view-header-actions">
          <span className="badge badge-outline">
            未承認: <strong>{totalPending}</strong> 件
          </span>
        </div>
      </header>

      <div className="records-tabs-row">
        <nav className="settings-tabs" role="tablist">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              className={`settings-tab ${tab === key ? 'is-active' : ''}`}
              onClick={() => setTab(key)}
            >
              <Icon size={15} />
              <span>{label}</span>
            </button>
          ))}
        </nav>

        <div className="records-toolbar">
          <span className="muted">承認状態:</span>
          <div className="seg-toggle">
            {(
              [
                { key: 'all', label: 'すべて' },
                { key: 'pending', label: '未承認' },
                { key: 'approved', label: '承認済' },
              ] as const
            ).map((o) => (
              <button
                key={o.key}
                type="button"
                className={`seg-toggle-btn ${filterStatus === o.key ? 'is-active' : ''}`}
                onClick={() => setFilterStatus(o.key)}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {tab === 'checkins' && (
        <section className="panel-card">
          <div className="panel-card-head">
            <h2>ダッシュボード確認の履歴</h2>
            <span className="panel-card-meta">{filteredCheckins.length} 件</span>
          </div>

          {filteredCheckins.length === 0 ? (
            <p className="muted in-panel">該当する確認記録はありません。</p>
          ) : (
            <div className="records-grid-wrap">
              <table className="records-grid">
                <thead>
                  <tr>
                    <th className="col-date">日時</th>
                    <th className="col-dashboard">ダッシュボード名</th>
                    <th className="col-period">期間</th>
                    <th className="col-result">結果</th>
                    <th className="col-sensors">対象センサー</th>
                    <th className="col-memo">メモ</th>
                    <th className="col-author">確認者</th>
                    <th className="col-approve-at">承認日時</th>
                    <th className="col-approver">承認者</th>
                    <th className="col-action" aria-label="操作"></th>
                  </tr>
                </thead>
                <tbody>
                  {pagedCheckins.map((c) => {
                    const memos = collectMemos(c)
                    return (
                      <tr key={c.id}>
                        <td className="col-date">{fmtDateTime(c.timestamp)}</td>
                        <td className="col-dashboard" title={c.dashboardName}>
                          {c.dashboardName}
                          {!dashboards[c.dashboardId] && (
                            <span className="muted small"> (削除済)</span>
                          )}
                        </td>
                        <td className="col-period">{fmtCheckinPeriod(c)}</td>
                        <td className="col-result">
                          {c.status === 'has-issue' ? (
                            <span className="badge badge-offline">
                              <AlertTriangle size={11} strokeWidth={2.4} />
                              異常あり
                            </span>
                          ) : c.status === 'no-issue' ? (
                            <span className="badge badge-online">
                              <CheckCircle2 size={11} strokeWidth={2.4} />
                              異常なし
                            </span>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                        <td className="col-sensors num">
                          {c.snapshot.sensorCount}
                          {c.snapshot.deviationSensorCount > 0 && (
                            <span className="cell-deviation">
                              （逸脱 {c.snapshot.deviationSensorCount}）
                            </span>
                          )}
                        </td>
                        <td className="col-memo">
                          {memos.length === 0 ? (
                            <span className="muted">—</span>
                          ) : memos.length === 1 ? (
                            <span title={memos[0].text} className="records-memo-text">
                              {memos[0].text}
                            </span>
                          ) : (
                            <>
                              <span
                                title={memos[0].text}
                                className="records-memo-text"
                              >
                                {memos[0].text}
                              </span>{' '}
                              <button
                                type="button"
                                className="records-memo-more"
                                onClick={() => setMemoModalCheckin(c)}
                                title="すべてのメモを見る"
                              >
                                +{memos.length - 1}
                              </button>
                            </>
                          )}
                        </td>
                        <td className="col-author">{c.userName}</td>
                        <td className="col-approve-at">
                          {c.approval ? (
                            fmtDateTime(c.approval.approvedAt)
                          ) : (
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              onClick={() => onApproveCheckin(c.id)}
                            >
                              <ShieldCheck size={12} />
                              <span>承認する</span>
                            </button>
                          )}
                        </td>
                        <td className="col-approver">
                          {c.approval ? (
                            c.approval.approvedByName
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                        <td className="col-action">
                          <button
                            type="button"
                            className="icon-btn icon-btn-danger"
                            aria-label="削除"
                            onClick={() => {
                              if (confirm('この確認記録を削除しますか？')) {
                                onDeleteCheckin(c.id)
                              }
                            }}
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>

              <div className="records-pagination">
                <PaginationControls
                  page={checkinCurrentPage}
                  totalPages={checkinTotalPages}
                  pageSize={CHECKIN_PAGE_SIZE}
                  filteredCount={filteredCheckins.length}
                  totalCount={checkinList.length}
                  onSetPage={setCheckinPage}
                />
              </div>
            </div>
          )}
        </section>
      )}

      {tab === 'notes' && (
        <section className="panel-card">
          <div className="panel-card-head">
            <h2>センサー運用メモの履歴</h2>
            <span className="panel-card-meta">{filteredNotes.length} 件</span>
          </div>

          {filteredNotes.length === 0 ? (
            <p className="muted in-panel">該当する運用メモはありません。</p>
          ) : (
            <ul className="record-list">
              {filteredNotes.map((n) => {
                const stillExists = !!sensors[n.sensorId]
                return (
                  <li key={n.id} className="record-item">
                    <header className="record-head">
                      <div className="record-head-main">
                        <span className="record-timestamp">{fmtDateTime(n.timestamp)}</span>
                        <span className="record-author">by {n.authorName}</span>
                      </div>
                      <div className="record-head-actions">
                        {n.approval ? (
                          <span className="badge badge-online">
                            <ShieldCheck size={11} strokeWidth={2.2} />
                            承認済（{n.approval.approvedByName}）
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => onApproveNote(n.id)}
                          >
                            <ShieldCheck size={13} />
                            <span>承認する</span>
                          </button>
                        )}
                        <button
                          type="button"
                          className="icon-btn icon-btn-danger"
                          aria-label="削除"
                          onClick={() => {
                            if (confirm('この運用メモを削除しますか？')) {
                              onDeleteNote(n.id)
                            }
                          }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </header>

                    <div className="record-target">
                      <Pencil size={14} />
                      <button
                        type="button"
                        className="link-btn"
                        onClick={() => onOpenSensor(n.sensorId)}
                        disabled={!stillExists}
                      >
                        <strong>{n.sensorName}</strong>
                      </button>
                      <span className="kind-chip">
                        {SENSOR_NOTE_CATEGORY_LABELS[n.category]}
                      </span>
                      {!stillExists && (
                        <span className="badge badge-offline">削除済み</span>
                      )}
                    </div>

                    <p className="record-comment">{n.body}</p>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      )}

      {/* メモ詳細モーダル（複数件あるとき「+N」クリックで開く） */}
      {memoModalCheckin && (
        <MemoDetailModal
          checkin={memoModalCheckin}
          onClose={() => setMemoModalCheckin(null)}
        />
      )}
    </div>
  )
}

/** 1 つの確認記録に紐づくメモ群を一覧表示するモーダル */
function MemoDetailModal({
  checkin,
  onClose,
}: {
  checkin: DashboardCheckin
  onClose: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const memos = collectMemos(checkin)

  useEffect(() => {
    const dlg = ref.current
    if (!dlg) return
    if (!dlg.open) dlg.showModal()
  }, [])

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
      <div className="app-dialog-form">
        <header className="app-dialog-head">
          <h2>メモ詳細 — {checkin.dashboardName}</h2>
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
          <p className="muted small">
            {fmtDateTime(checkin.timestamp)} ・ {checkin.userName} ・ 全 {memos.length} 件
          </p>
          {memos.length === 0 ? (
            <p className="muted in-panel">メモはありません。</p>
          ) : (
            <ul className="memo-detail-list">
              {memos.map((m, i) => (
                <li key={i} className="memo-detail-item">
                  <div className="memo-detail-label">{m.label}</div>
                  <p className="memo-detail-body">{m.text}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
        <footer className="app-dialog-foot">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            閉じる
          </button>
        </footer>
      </div>
    </dialog>
  )
}
