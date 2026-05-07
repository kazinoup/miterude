import { useEffect, useMemo, useState } from 'react'
import {
  ClipboardCheck,
  Pencil,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  Trash2,
  LayoutDashboard,
  Cpu,
} from 'lucide-react'
import type {
  DashboardCheckinStore,
  DashboardStore,
  SensorNoteStore,
  SensorStore,
  UserSession,
} from '../../types'
import { SENSOR_NOTE_CATEGORY_LABELS } from '../../types'

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

  // ワイド表示固定（センサー一覧と同じ扱い）
  useEffect(() => {
    const el = document.querySelector('.app-content-inner')
    if (!el) return
    el.classList.add('is-wide')
    return () => {
      el.classList.remove('is-wide')
    }
  }, [])

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

      {tab === 'checkins' && (
        <section className="panel-card">
          <div className="panel-card-head">
            <h2>ダッシュボード確認の履歴</h2>
            <span className="panel-card-meta">{filteredCheckins.length} 件</span>
          </div>

          {filteredCheckins.length === 0 ? (
            <p className="muted in-panel">該当する確認記録はありません。</p>
          ) : (
            <ul className="record-list">
              {filteredCheckins.map((c) => {
                const stillExists = !!dashboards[c.dashboardId]
                return (
                  <li key={c.id} className="record-item">
                    <header className="record-head">
                      <div className="record-head-main">
                        <span className="record-timestamp">{fmtDateTime(c.timestamp)}</span>
                        <span className="record-author">by {c.userName}</span>
                      </div>
                      <div className="record-head-actions">
                        {c.approval ? (
                          <span className="badge badge-online">
                            <ShieldCheck size={11} strokeWidth={2.2} />
                            承認済（{c.approval.approvedByName} ・{' '}
                            {fmtDateTime(c.approval.approvedAt)}）
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => onApproveCheckin(c.id)}
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
                            if (confirm('この確認記録を削除しますか？')) {
                              onDeleteCheckin(c.id)
                            }
                          }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </header>

                    <div className="record-target">
                      <LayoutDashboard size={14} />
                      <strong>{c.dashboardName}</strong>
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
                      ) : null}
                      {!stillExists && (
                        <span className="badge badge-offline">削除済み</span>
                      )}
                    </div>

                    <div className="record-snapshot">
                      <span>
                        期間:{' '}
                        <strong>
                          {c.snapshot.periodLabel ?? `直近 ${c.snapshot.lookbackHours} 時間`}
                        </strong>
                      </span>
                      <span>
                        対象センサー <strong>{c.snapshot.sensorCount}</strong> 台
                      </span>
                      <span>
                        オンライン <strong>{c.snapshot.onlineCount}</strong>
                      </span>
                      <span
                        className={
                          c.snapshot.deviationSensorCount > 0 ? 'cell-deviation' : ''
                        }
                      >
                        逸脱 <strong>{c.snapshot.deviationSensorCount}</strong> 台
                      </span>
                    </div>

                    {c.comment && (
                      <p className="record-comment">
                        <span className="record-comment-label">全体メモ:</span> {c.comment}
                      </p>
                    )}

                    {c.sensorComments.length > 0 && (
                      <div className="record-sensor-comments">
                        <h4>逸脱センサーへの個別記録</h4>
                        <ul>
                          {c.sensorComments.map((sc) => {
                            const segs = sc.segmentComments ?? []
                            const hasSegMemos = segs.some((s) => s.memo.trim().length > 0)
                            return (
                              <li key={sc.sensorId}>
                                <div className="rsc-head">
                                  <button
                                    type="button"
                                    className="link-btn"
                                    onClick={() => onOpenSensor(sc.sensorId)}
                                    disabled={!sensors[sc.sensorId]}
                                  >
                                    <AlertTriangle size={12} className="cell-deviation" />
                                    <span>{sc.sensorName}</span>
                                  </button>
                                  {segs.length > 0 && (
                                    <span className="muted">
                                      逸脱 {segs.length} 件
                                    </span>
                                  )}
                                </div>
                                {sc.comment && (
                                  <p className="rsc-body">{sc.comment}</p>
                                )}
                                {!sc.comment && !hasSegMemos && (
                                  <p className="rsc-body">
                                    <span className="muted">（メモなし）</span>
                                  </p>
                                )}
                                {hasSegMemos && (
                                  <ul className="rsc-segments">
                                    {segs
                                      .filter((s) => s.memo.trim().length > 0)
                                      .map((s, i) => (
                                        <li
                                          key={`${s.metric}-${new Date(s.start).getTime()}-${i}`}
                                          className="rsc-segment"
                                        >
                                          <span className="muted">
                                            {s.metric === 'temperature' ? '温度' : '湿度'}{' '}
                                            {s.direction === 'above'
                                              ? '上限超え'
                                              : s.direction === 'below'
                                                ? '下限割れ'
                                                : '上下動'}{' '}
                                            ・{' '}
                                            {new Date(s.start).toLocaleString('ja-JP', {
                                              month: '2-digit',
                                              day: '2-digit',
                                              hour: '2-digit',
                                              minute: '2-digit',
                                            })}{' '}
                                            〜{' '}
                                            {new Date(s.end).toLocaleString('ja-JP', {
                                              month: '2-digit',
                                              day: '2-digit',
                                              hour: '2-digit',
                                              minute: '2-digit',
                                            })}
                                          </span>
                                          <span className="rsc-segment-memo">
                                            {s.memo}
                                          </span>
                                        </li>
                                      ))}
                                  </ul>
                                )}
                              </li>
                            )
                          })}
                        </ul>
                      </div>
                    )}

                    {c.sensorComments.length === 0 && (
                      <p className="record-empty-deviations">
                        <CheckCircle2 size={13} />
                        確認時点で逸脱センサーはありませんでした。
                      </p>
                    )}

                    {c.approval?.comment && (
                      <p className="record-approval-comment">
                        <span className="record-comment-label">承認コメント:</span>{' '}
                        {c.approval.comment}
                      </p>
                    )}
                  </li>
                )
              })}
            </ul>
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
    </div>
  )
}
