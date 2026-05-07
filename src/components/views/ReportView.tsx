import { useEffect, useMemo, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  CheckSquare,
  ClipboardCheck,
  FileBarChart2,
  Printer,
  CalendarDays,
  Settings2,
} from 'lucide-react'
import type {
  DashboardCheckinStore,
  DeviceStore,
  ReportKind,
  ReportScheduleStore,
  SavedFilterStore,
  SensorCategoryStore,
  SensorGroupStore,
  SensorNoteStore,
  SensorStore,
  YearMonth,
} from '../../types'
import { SensorPicker } from '../SensorPicker'
import { yearMonthKey } from '../../types'
import {
  deviceHasDataForMonth,
  deviceHasDataForRange,
} from '../../lib/report'
import { startOfWeek } from '../../lib/period'
import { ReportPreview } from '../ReportPreview'
import { RecordsAndNotesReport } from '../RecordsAndNotesReport'

type Props = {
  devices: DeviceStore
  selectedDeviceIds: string[]
  onSelectedDeviceIds: (ids: string[]) => void

  /** Phase 9.5: SensorPicker のための補助情報 */
  sensors: SensorStore
  groups: SensorGroupStore
  categories?: SensorCategoryStore
  savedFilters: SavedFilterStore

  // 月報用
  printMonth: YearMonth | null
  onPrintMonth: (m: YearMonth | null) => void

  // 週報用（月曜起点の週初日）
  printWeekStart: Date | null
  onPrintWeekStart: (d: Date | null) => void

  // 種別
  printKind: ReportKind
  onPrintKind: (k: ReportKind) => void

  /** Phase A-4: 記録履歴・運用メモページの出力可否 */
  includeRecordsPage: boolean
  onIncludeRecordsPage: (v: boolean) => void

  /** Phase A-4: プレビュー描画用に記録履歴・運用メモを参照する */
  checkins: DashboardCheckinStore
  sensorNotes: SensorNoteStore

  /** Phase G: 定期配信バナー用 */
  reportSchedules: ReportScheduleStore
  onGoSettings: () => void

  onPrint: () => void
}

function sortIds(ids: string[]): string[] {
  return [...ids].sort()
}

function weekRange(weekStart: Date): { start: Date; end: Date } {
  const start = new Date(weekStart)
  const end = new Date(start)
  end.setDate(end.getDate() + 7)
  return { start, end }
}

/* ---------- Phase A-1: 期間ヘルパ ---------- */

/** 「先月」（指定日の前月）を YearMonth で返す */
function previousMonthOf(today: Date): YearMonth {
  const m = today.getMonth() // 0..11
  if (m === 0) return { year: today.getFullYear() - 1, month: 12 }
  return { year: today.getFullYear(), month: m } // m は 1..12 の前月値
}

/** 「先週」の月曜（指定日の含まれる週の月曜から 7 日前） */
function previousWeekMondayOf(today: Date): Date {
  const monday = startOfWeek(today)
  monday.setDate(monday.getDate() - 7)
  return monday
}

/** 月の前後移動（year wrap 対応） */
function shiftYearMonth(ym: YearMonth, delta: number): YearMonth {
  let y = ym.year
  let m = ym.month + delta
  while (m > 12) {
    y += 1
    m -= 12
  }
  while (m < 1) {
    y -= 1
    m += 12
  }
  return { year: y, month: m }
}

/** 同じ年月かどうか */
function sameYearMonth(a: YearMonth | null, b: YearMonth | null): boolean {
  if (!a || !b) return false
  return a.year === b.year && a.month === b.month
}

/** 同じ日付（年月日）かどうか */
function sameDate(a: Date | null, b: Date | null): boolean {
  if (!a || !b) return false
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

function formatMonthLabel(ym: YearMonth): string {
  return `${ym.year}年${ym.month}月`
}

function formatWeekLabel(weekStart: Date): string {
  const end = new Date(weekStart)
  end.setDate(end.getDate() + 6)
  const sm = weekStart.getMonth() + 1
  const em = end.getMonth() + 1
  if (weekStart.getMonth() === end.getMonth()) {
    return `${sm}月${weekStart.getDate()}日 〜 ${end.getDate()}日`
  }
  return `${sm}月${weekStart.getDate()}日 〜 ${em}月${end.getDate()}日`
}

export function ReportView({
  devices,
  selectedDeviceIds,
  onSelectedDeviceIds,
  sensors,
  groups,
  categories,
  savedFilters,
  printMonth,
  onPrintMonth,
  printWeekStart,
  onPrintWeekStart,
  printKind,
  onPrintKind,
  includeRecordsPage,
  onIncludeRecordsPage,
  checkins,
  sensorNotes,
  reportSchedules,
  onGoSettings,
  onPrint,
}: Props) {
  const [previewIndex, setPreviewIndex] = useState(0)

  /** Phase A-1: 月／週の値が未設定のとき、先月／先週を既定で埋める */
  useEffect(() => {
    const today = new Date()
    if (printKind === 'monthly' && !printMonth) {
      onPrintMonth(previousMonthOf(today))
    }
    if (printKind === 'weekly' && !printWeekStart) {
      onPrintWeekStart(previousWeekMondayOf(today))
    }
  }, [printKind, printMonth, printWeekStart, onPrintMonth, onPrintWeekStart])

  const selectedSorted = useMemo(() => sortIds(selectedDeviceIds), [selectedDeviceIds])

  const eligibleDeviceIds = useMemo(() => {
    if (printKind === 'monthly') {
      if (!printMonth) return [] as string[]
      return selectedSorted.filter((id) =>
        deviceHasDataForMonth(devices[id], printMonth),
      )
    }
    if (!printWeekStart) return [] as string[]
    const range = weekRange(printWeekStart)
    return selectedSorted.filter((id) => deviceHasDataForRange(devices[id], range))
  }, [printKind, selectedSorted, devices, printMonth, printWeekStart])

  useEffect(() => {
    setPreviewIndex(0)
  }, [printKind, printMonth, printWeekStart, selectedDeviceIds])

  const previewIdx = eligibleDeviceIds.length === 0
    ? 0
    : Math.min(previewIndex, eligibleDeviceIds.length - 1)
  const previewDevice = eligibleDeviceIds[previewIdx] ?? null

  const canPrint =
    eligibleDeviceIds.length > 0 &&
    (printKind === 'monthly' ? printMonth != null : printWeekStart != null)

  function shiftMonth(delta: -1 | 1) {
    const today = new Date()
    const base = printMonth ?? previousMonthOf(today)
    onPrintMonth(shiftYearMonth(base, delta))
  }

  function shiftWeek(delta: -1 | 1) {
    const today = new Date()
    const base = printWeekStart ?? previousWeekMondayOf(today)
    const next = new Date(base)
    next.setDate(next.getDate() + delta * 7)
    onPrintWeekStart(next)
  }

  return (
    <div className="report-view">
      <header className="view-header">
        <div className="view-header-text">
          <h1>
            <FileBarChart2 size={20} className="head-icon" />
            レポート
          </h1>
          <p>
            出力タイプと期間、対象デバイスを指定して、選択した全デバイスを 1 つの PDF にまとめます。
          </p>
        </div>
      </header>

      {/* Phase G: 定期配信設定の有無を 1 行で示す */}
      {(() => {
        const matched = Object.values(reportSchedules).filter(
          (s) => s.enabled && s.reportKind === printKind,
        )
        const kindLabel = printKind === 'monthly' ? '月報' : '週報'
        return (
          <div className="reminder-banner">
            <FileBarChart2 size={14} className="reminder-banner-icon" />
            {matched.length === 0 ? (
              <span>
                {kindLabel}の定期配信は未設定 ・{' '}
                <button
                  type="button"
                  className="link-btn"
                  onClick={onGoSettings}
                >
                  通知設定で追加
                </button>
              </span>
            ) : (
              <span>
                {kindLabel}の定期配信 <strong>{matched.length} 件</strong> 有効 ・{' '}
                <button
                  type="button"
                  className="link-btn"
                  onClick={onGoSettings}
                >
                  通知設定で変更
                </button>
              </span>
            )}
          </div>
        )
      })()}

      {/* Phase A-1: 出力タイプ + 対象期間 を 1 行に並べる
       *  左: [週報] [月報] のセグメントトグル
       *  右: ◀ ラベル ▶ + 先週/先月ボタン
       *  「先週/先月」ボタンは現在値が既定（先週／先月）に一致するときだけ active 表示 */}
      {(() => {
        const today = new Date()
        const defaultMonth = previousMonthOf(today)
        const defaultWeekStart = previousWeekMondayOf(today)
        const isAtDefault =
          printKind === 'monthly'
            ? sameYearMonth(printMonth, defaultMonth)
            : sameDate(printWeekStart, defaultWeekStart)
        const defaultLabel = printKind === 'monthly' ? '先月' : '先週'
        function jumpToDefault() {
          if (printKind === 'monthly') {
            onPrintMonth(defaultMonth)
          } else {
            onPrintWeekStart(defaultWeekStart)
          }
        }
        return (
          <section className="panel-card">
            <div className="panel-card-head">
              <h2>
                <CalendarDays size={16} className="head-icon" />
                出力する期間
              </h2>
            </div>
            <div className="period-card-body">
              <div className="seg-toggle period-kind-toggle">
                <button
                  type="button"
                  className={`seg-toggle-btn ${printKind === 'weekly' ? 'is-active' : ''}`}
                  onClick={() => onPrintKind('weekly')}
                >
                  週報
                </button>
                <button
                  type="button"
                  className={`seg-toggle-btn ${printKind === 'monthly' ? 'is-active' : ''}`}
                  onClick={() => onPrintKind('monthly')}
                >
                  月報
                </button>
              </div>

              <div className="period-navigator">
                <button
                  type="button"
                  className="icon-btn period-nav-btn"
                  onClick={() =>
                    printKind === 'monthly' ? shiftMonth(-1) : shiftWeek(-1)
                  }
                  aria-label={printKind === 'monthly' ? '前の月' : '前の週'}
                >
                  <ChevronLeft size={18} />
                </button>
                <div className="period-nav-label" aria-live="polite">
                  {printKind === 'monthly'
                    ? printMonth
                      ? formatMonthLabel(printMonth)
                      : '—'
                    : printWeekStart
                      ? formatWeekLabel(printWeekStart)
                      : '—'}
                </div>
                <button
                  type="button"
                  className="icon-btn period-nav-btn"
                  onClick={() =>
                    printKind === 'monthly' ? shiftMonth(1) : shiftWeek(1)
                  }
                  aria-label={printKind === 'monthly' ? '次の月' : '次の週'}
                >
                  <ChevronRight size={18} />
                </button>
              </div>

              <button
                type="button"
                className={`period-default-btn ${isAtDefault ? 'is-active' : ''}`}
                onClick={jumpToDefault}
                aria-pressed={isAtDefault}
                title={`${defaultLabel}の期間に戻す`}
              >
                {defaultLabel}
              </button>
            </div>
          </section>
        )
      })()}

      {/* 対象デバイス（変更なし） */}
      <section className="panel-card">
        <div className="panel-card-head">
          <h2>
            <CheckSquare size={16} className="head-icon" />
            対象デバイス
          </h2>
          <span className="panel-card-meta">
            {selectedSorted.length} 台選択中（
            {
              selectedSorted.filter((id) =>
                printKind === 'monthly'
                  ? printMonth && deviceHasDataForMonth(devices[id], printMonth)
                  : printWeekStart &&
                    deviceHasDataForRange(devices[id], weekRange(printWeekStart)),
              ).length
            }{' '}
            台が対象期間にデータあり）
          </span>
        </div>
        <SensorPicker
          candidateSensors={sensors}
          selected={selectedDeviceIds}
          onChange={onSelectedDeviceIds}
          groups={groups}
          categories={categories}
          savedFilters={savedFilters}
        />
      </section>

      {/* Phase A-4: 出力項目（記録履歴・運用メモの任意出力） */}
      <section className="panel-card">
        <div className="panel-card-head">
          <h2>
            <Settings2 size={16} className="head-icon" />
            出力項目
          </h2>
        </div>
        <label className="output-option">
          <input
            type="checkbox"
            checked={includeRecordsPage}
            onChange={(e) => onIncludeRecordsPage(e.target.checked)}
          />
          <span className="output-option-text">
            <span className="output-option-title">
              <ClipboardCheck size={14} />
              記録履歴・運用メモを末尾ページとして出力する
            </span>
            <span className="output-option-desc muted">
              対象期間内のダッシュボード確認履歴（点検日・点検者・承認・確認メモ・各デバイスの逸脱メモ）と、各デバイスの運用メモを 1 ページにまとめて出力します。
            </span>
          </span>
        </label>
      </section>

      {/* プレビュー（変更なし） */}
      <section className="panel-card preview-card">
        <div className="panel-card-head">
          <h2>
            <Settings2 size={16} className="head-icon" />
            プレビュー
          </h2>
          <span className="panel-card-meta">出力前に1台ずつ確認できます</span>
        </div>

        {!previewDevice ||
        (printKind === 'monthly' && !printMonth) ||
        (printKind === 'weekly' && !printWeekStart) ? (
          <p className="muted in-panel">対象デバイスと期間を選択するとプレビューが表示されます。</p>
        ) : (
          <>
            <div className="preview-toolbar-new">
              <button
                type="button"
                className="icon-btn"
                disabled={previewIdx === 0}
                onClick={() => setPreviewIndex((i) => Math.max(0, i - 1))}
                aria-label="前のデバイス"
              >
                <ChevronLeft size={16} />
              </button>
              <select
                className="select"
                value={previewDevice}
                onChange={(e) => {
                  const idx = eligibleDeviceIds.indexOf(e.target.value)
                  if (idx >= 0) setPreviewIndex(idx)
                }}
              >
                {eligibleDeviceIds.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="icon-btn"
                disabled={previewIdx >= eligibleDeviceIds.length - 1}
                onClick={() =>
                  setPreviewIndex((i) => Math.min(eligibleDeviceIds.length - 1, i + 1))
                }
                aria-label="次のデバイス"
              >
                <ChevronRight size={16} />
              </button>
              <span className="preview-pos">
                {previewIdx + 1} / {eligibleDeviceIds.length}
              </span>
            </div>

            <div id="screen-preview-root" className="screen-preview-root">
              {printKind === 'monthly' && printMonth ? (
                <ReportPreview
                  key={`m-${previewDevice}-${yearMonthKey(printMonth)}`}
                  kind="monthly"
                  ym={printMonth}
                  deviceId={previewDevice}
                  readings={devices[previewDevice] ?? []}
                  thresholds={sensors[previewDevice]?.thresholds}
                />
              ) : printKind === 'weekly' && printWeekStart ? (
                <ReportPreview
                  key={`w-${previewDevice}-${printWeekStart.toISOString().slice(0, 10)}`}
                  kind="weekly"
                  weekStart={printWeekStart}
                  deviceId={previewDevice}
                  readings={devices[previewDevice] ?? []}
                  thresholds={sensors[previewDevice]?.thresholds}
                />
              ) : null}

              {/* Phase A-4: 任意で記録履歴・運用メモのページをプレビュー末尾に表示 */}
              {includeRecordsPage &&
                (printKind === 'monthly' && printMonth ? (
                  <RecordsAndNotesReport
                    kind="monthly"
                    ym={printMonth}
                    checkins={checkins}
                    sensorNotes={sensorNotes}
                    deviceIds={selectedSorted}
                  />
                ) : printKind === 'weekly' && printWeekStart ? (
                  <RecordsAndNotesReport
                    kind="weekly"
                    weekStart={printWeekStart}
                    checkins={checkins}
                    sensorNotes={sensorNotes}
                    deviceIds={selectedSorted}
                  />
                ) : null)}
            </div>
          </>
        )}
      </section>

      <div className="action-bar">
        <div className="action-bar-info">
          {printKind === 'monthly' ? (
            printMonth ? (
              <>
                <strong>{formatMonthLabel(printMonth)}</strong> の月報を{' '}
                <strong>{eligibleDeviceIds.length} 台</strong> 分まとめて PDF 出力します。
                {selectedSorted.length > eligibleDeviceIds.length && (
                  <span className="warn-inline">
                    （{selectedSorted.length - eligibleDeviceIds.length} 台はこの月のデータなし）
                  </span>
                )}
              </>
            ) : (
              <span className="muted">出力する月を選んでください。</span>
            )
          ) : printWeekStart ? (
            <>
              <strong>{formatWeekLabel(printWeekStart)}</strong> の週報を{' '}
              <strong>{eligibleDeviceIds.length} 台</strong> 分まとめて PDF 出力します。
              {selectedSorted.length > eligibleDeviceIds.length && (
                <span className="warn-inline">
                  （{selectedSorted.length - eligibleDeviceIds.length} 台はこの週のデータなし）
                </span>
              )}
            </>
          ) : (
            <span className="muted">出力する週を選んでください。</span>
          )}
        </div>
        <button
          type="button"
          className="btn btn-primary btn-lg"
          disabled={!canPrint}
          onClick={onPrint}
        >
          <Printer size={18} />
          <span>PDF を出力</span>
        </button>
      </div>
    </div>
  )
}
