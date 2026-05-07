/**
 * 記録履歴・運用メモページ — Phase A-4
 *
 * 月報・週報の末尾に任意で追加する 1 ページ（あふれた場合は複数ページ）。
 * 構成:
 *  - 記録履歴一覧（DashboardCheckin から）: 点検日、点検者、承認、異常有無、確認メモ、各デバイスの逸脱メモ
 *  - 運用メモ（SensorNote から）: デバイス別の運用メモ
 *
 * 期間判定:
 *  - 月報: その年月（1日〜末日）に timestamp が含まれるエントリ
 *  - 週報: weekStart 〜 +7 日（exclusive）に timestamp が含まれるエントリ
 */
import type {
  DashboardCheckinStore,
  SensorNoteStore,
  YearMonth,
} from '../types'
import { SENSOR_NOTE_CATEGORY_LABELS } from '../types'

type Props =
  | {
      kind: 'monthly'
      ym: YearMonth
      checkins: DashboardCheckinStore
      sensorNotes: SensorNoteStore
      /** 報告対象として選ばれているデバイス ID（運用メモはこれに該当するセンサーのものに絞る） */
      deviceIds: string[]
    }
  | {
      kind: 'weekly'
      weekStart: Date
      checkins: DashboardCheckinStore
      sensorNotes: SensorNoteStore
      deviceIds: string[]
    }

function rangeOf(props: Props): { start: Date; end: Date } {
  if (props.kind === 'monthly') {
    const start = new Date(props.ym.year, props.ym.month - 1, 1)
    const end = new Date(props.ym.year, props.ym.month, 1)
    return { start, end }
  }
  const start = new Date(props.weekStart)
  const end = new Date(start)
  end.setDate(end.getDate() + 7)
  return { start, end }
}

function formatPeriodLabel(props: Props): string {
  if (props.kind === 'monthly') {
    return `${props.ym.year}年${props.ym.month}月`
  }
  const start = props.weekStart
  const end = new Date(start)
  end.setDate(end.getDate() + 6)
  const sm = start.getMonth() + 1
  const em = end.getMonth() + 1
  if (start.getMonth() === end.getMonth()) {
    return `${start.getFullYear()}年${sm}月${start.getDate()}日 〜 ${end.getDate()}日`
  }
  return `${start.getFullYear()}年${sm}月${start.getDate()}日 〜 ${em}月${end.getDate()}日`
}

function formatDateTime(d: Date): string {
  const dd = d instanceof Date ? d : new Date(d)
  const y = dd.getFullYear()
  const m = String(dd.getMonth() + 1).padStart(2, '0')
  const day = String(dd.getDate()).padStart(2, '0')
  const hh = String(dd.getHours()).padStart(2, '0')
  const mm = String(dd.getMinutes()).padStart(2, '0')
  return `${y}/${m}/${day} ${hh}:${mm}`
}

function formatDate(d: Date): string {
  const dd = d instanceof Date ? d : new Date(d)
  const y = dd.getFullYear()
  const m = String(dd.getMonth() + 1).padStart(2, '0')
  const day = String(dd.getDate()).padStart(2, '0')
  return `${y}/${m}/${day}`
}

export function RecordsAndNotesReport(props: Props) {
  const { start, end } = rangeOf(props)

  const checkinsInPeriod = Object.values(props.checkins)
    .filter((c) => {
      const t = c.timestamp instanceof Date ? c.timestamp : new Date(c.timestamp)
      return t >= start && t < end
    })
    .sort((a, b) => {
      const ta = a.timestamp instanceof Date ? a.timestamp.getTime() : new Date(a.timestamp).getTime()
      const tb = b.timestamp instanceof Date ? b.timestamp.getTime() : new Date(b.timestamp).getTime()
      return ta - tb
    })

  const deviceSet = new Set(props.deviceIds)
  const notesInPeriod = Object.values(props.sensorNotes)
    .filter((n) => {
      const t = n.timestamp instanceof Date ? n.timestamp : new Date(n.timestamp)
      if (!(t >= start && t < end)) return false
      // 対象デバイスとして選ばれているセンサーのみ
      return deviceSet.size === 0 || deviceSet.has(n.sensorId)
    })
    .sort((a, b) => {
      const ta = a.timestamp instanceof Date ? a.timestamp.getTime() : new Date(a.timestamp).getTime()
      const tb = b.timestamp instanceof Date ? b.timestamp.getTime() : new Date(b.timestamp).getTime()
      return ta - tb
    })

  // センサー別にグルーピング
  const notesByDevice = new Map<string, typeof notesInPeriod>()
  for (const n of notesInPeriod) {
    const arr = notesByDevice.get(n.sensorId) ?? []
    arr.push(n)
    notesByDevice.set(n.sensorId, arr)
  }

  return (
    <div className="report-page records-page">
      <h1 className="monthly-title">記録履歴・運用メモ</h1>
      <p className="report-hero-line">
        <span className="report-hero-ym">【{formatPeriodLabel(props)}】</span>
      </p>

      {/* ========== 記録履歴一覧 ========== */}
      <section className="records-section">
        <h2 className="records-section-title">記録履歴一覧</h2>
        {checkinsInPeriod.length === 0 ? (
          <p className="records-empty">対象期間に記録履歴はありません。</p>
        ) : (
          <table className="records-table">
            <thead>
              <tr>
                <th>点検日時</th>
                <th>点検者</th>
                <th>承認日時</th>
                <th>承認者</th>
                <th>異常</th>
                <th>確認メモ</th>
                <th>逸脱確認メモ（デバイス別）</th>
              </tr>
            </thead>
            <tbody>
              {checkinsInPeriod.map((c) => (
                <tr key={c.id}>
                  <td className="cell-nowrap">{formatDateTime(c.timestamp)}</td>
                  <td className="cell-nowrap">{c.userName}</td>
                  <td className="cell-nowrap">
                    {c.approval ? formatDateTime(c.approval.approvedAt) : '—'}
                  </td>
                  <td className="cell-nowrap">{c.approval?.approvedByName ?? '—'}</td>
                  <td className="cell-nowrap">
                    {c.status === 'has-issue'
                      ? <span className="records-issue-yes">異常あり</span>
                      : c.status === 'no-issue'
                        ? <span className="records-issue-no">異常なし</span>
                        : '—'}
                  </td>
                  <td className="cell-memo">{c.comment || '—'}</td>
                  <td className="cell-memo">
                    {c.sensorComments.length === 0 ? (
                      '—'
                    ) : (
                      <ul className="records-sensor-memos">
                        {c.sensorComments.map((sc) => (
                          <li key={sc.sensorId}>
                            <strong>{sc.sensorName}</strong>
                            <span className="records-sensor-kinds">
                              （{sc.deviationKinds.map((k) => (k === 'temperature' ? '温度' : '湿度')).join('・')}）
                            </span>
                            ：{sc.comment || '—'}
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* ========== 運用メモ ========== */}
      <section className="records-section">
        <h2 className="records-section-title">運用メモ</h2>
        {notesByDevice.size === 0 ? (
          <p className="records-empty">対象期間に運用メモはありません。</p>
        ) : (
          <div className="records-notes">
            {Array.from(notesByDevice.entries())
              .sort(([, a], [, b]) =>
                (a[0]?.sensorName ?? '').localeCompare(b[0]?.sensorName ?? ''),
              )
              .map(([sensorId, list]) => (
                <div key={sensorId} className="records-note-block">
                  <h3 className="records-note-device">
                    {list[0]?.sensorName ?? sensorId}
                  </h3>
                  <table className="records-table records-notes-table">
                    <thead>
                      <tr>
                        <th>記録日</th>
                        <th>区分</th>
                        <th>記入者</th>
                        <th>承認</th>
                        <th>内容</th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.map((n) => (
                        <tr key={n.id}>
                          <td className="cell-nowrap">{formatDate(n.timestamp)}</td>
                          <td className="cell-nowrap">
                            {SENSOR_NOTE_CATEGORY_LABELS[n.category]}
                          </td>
                          <td className="cell-nowrap">{n.authorName}</td>
                          <td className="cell-nowrap">
                            {n.approval
                              ? `${n.approval.approvedByName} (${formatDate(n.approval.approvedAt)})`
                              : '—'}
                          </td>
                          <td className="cell-memo">{n.body}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
          </div>
        )}
      </section>
    </div>
  )
}
