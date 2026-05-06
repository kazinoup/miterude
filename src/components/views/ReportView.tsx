import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Settings2,
  CheckSquare,
  Printer,
  CalendarDays,
  Sliders,
  FileBarChart2,
} from 'lucide-react'
import type {
  DeviceStore,
  MissingDisplay,
  ReportKind,
  ReportThresholds,
  SavedFilterStore,
  SensorCategoryStore,
  SensorGroupStore,
  SensorStore,
  YearMonth,
} from '../../types'
import { SensorPicker } from '../SensorPicker'
import { yearMonthKey } from '../../types'
import {
  collectYearMonths,
  deviceHasDataForMonth,
  deviceHasDataForRange,
} from '../../lib/report'
import {
  fromDateInputValue,
  startOfWeek,
  toDateInputValue,
} from '../../lib/period'
import { ReportPreview } from '../ReportPreview'

type Props = {
  devices: DeviceStore
  thresholds: ReportThresholds
  onThresholds: (t: ReportThresholds) => void
  missingDisplay: MissingDisplay
  onMissingDisplay: (m: MissingDisplay) => void
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

  onPrint: () => void
  onBack: () => void
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

function formatWeekLabel(weekStart: Date): string {
  const end = new Date(weekStart)
  end.setDate(end.getDate() + 6)
  if (weekStart.getMonth() === end.getMonth()) {
    return `${weekStart.getFullYear()}年${weekStart.getMonth() + 1}月${weekStart.getDate()}日 〜 ${end.getDate()}日`
  }
  return `${weekStart.getFullYear()}年${weekStart.getMonth() + 1}月${weekStart.getDate()}日 〜 ${end.getMonth() + 1}月${end.getDate()}日`
}

export function ReportView({
  devices,
  thresholds,
  onThresholds,
  missingDisplay,
  onMissingDisplay,
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
  onPrint,
  onBack,
}: Props) {
  const allMonths = useMemo(
    () => collectYearMonths(Object.values(devices).flat()),
    [devices],
  )

  const [previewIndex, setPreviewIndex] = useState(0)
  const [showThresholds, setShowThresholds] = useState(false)

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

  function shiftWeek(delta: -1 | 1) {
    if (!printWeekStart) return
    const next = new Date(printWeekStart)
    next.setDate(next.getDate() + delta * 7)
    onPrintWeekStart(next)
  }

  return (
    <div className="report-view">
      <div className="breadcrumb">
        <button type="button" className="link-btn" onClick={onBack}>
          <ArrowLeft size={14} />
          <span>戻る</span>
        </button>
      </div>

      <header className="view-header">
        <div className="view-header-text">
          <h1>レポート出力</h1>
          <p>
            対象デバイスと出力対象の{printKind === 'monthly' ? '月' : '週'}を指定して、選択した全デバイスを 1 つの PDF にまとめます。
          </p>
        </div>
      </header>

      <section className="panel-card">
        <div className="panel-card-head">
          <h2>
            <FileBarChart2 size={16} className="head-icon" />
            出力タイプ
          </h2>
        </div>
        <div className="seg-toggle">
          <button
            type="button"
            className={`seg-toggle-btn ${printKind === 'monthly' ? 'is-active' : ''}`}
            onClick={() => onPrintKind('monthly')}
          >
            月報
          </button>
          <button
            type="button"
            className={`seg-toggle-btn ${printKind === 'weekly' ? 'is-active' : ''}`}
            onClick={() => onPrintKind('weekly')}
          >
            週報
          </button>
        </div>
      </section>

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

      <section className="panel-card">
        <div className="panel-card-head">
          <h2>
            <CalendarDays size={16} className="head-icon" />
            出力する{printKind === 'monthly' ? '月' : '週'}
          </h2>
        </div>

        {printKind === 'monthly' ? (
          <div className="month-tabs">
            {allMonths.length === 0 && <span className="muted">対象月がありません。</span>}
            {allMonths.map((m) => {
              const key = yearMonthKey(m)
              const active = printMonth && yearMonthKey(printMonth) === key
              return (
                <button
                  key={key}
                  type="button"
                  className={`month-tab ${active ? 'is-active' : ''}`}
                  onClick={() => onPrintMonth(m)}
                >
                  {m.year}年{m.month}月
                </button>
              )
            })}
          </div>
        ) : (
          <div className="week-picker">
            <button
              type="button"
              className="icon-btn"
              onClick={() => shiftWeek(-1)}
              disabled={!printWeekStart}
              aria-label="前の週"
            >
              <ChevronLeft size={16} />
            </button>
            <input
              type="date"
              className="select"
              value={printWeekStart ? toDateInputValue(printWeekStart) : ''}
              onChange={(e) => {
                const d = fromDateInputValue(e.target.value)
                if (d) onPrintWeekStart(startOfWeek(d))
              }}
            />
            <button
              type="button"
              className="icon-btn"
              onClick={() => shiftWeek(1)}
              disabled={!printWeekStart}
              aria-label="次の週"
            >
              <ChevronRight size={16} />
            </button>
            {printWeekStart && (
              <span className="period-label">
                {formatWeekLabel(printWeekStart)}
              </span>
            )}
            <span className="muted week-hint">月曜起点で週を集計します。</span>
          </div>
        )}
      </section>

      <section className="panel-card">
        <button
          type="button"
          className="advanced-toggle"
          onClick={() => setShowThresholds((v) => !v)}
        >
          <Sliders size={16} />
          <span>逸脱判定・閾値・欠損表示の設定</span>
          <ChevronRight
            size={16}
            className={`chev ${showThresholds ? 'is-open' : ''}`}
          />
        </button>
        {showThresholds && (
          <div className="advanced-body">
            <div className="advanced-row">
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={thresholds.useTempDeviation}
                  onChange={() =>
                    onThresholds({
                      ...thresholds,
                      useTempDeviation: !thresholds.useTempDeviation,
                    })
                  }
                />
                <span>温度の逸脱を判定する</span>
              </label>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={thresholds.useHumDeviation}
                  onChange={() =>
                    onThresholds({
                      ...thresholds,
                      useHumDeviation: !thresholds.useHumDeviation,
                    })
                  }
                />
                <span>湿度の逸脱を判定する</span>
              </label>
            </div>

            <div className="thresholds-grid">
              <fieldset disabled={!thresholds.useTempDeviation}>
                <legend>温度・冷蔵庫用（℃）</legend>
                <div className="num-pair">
                  <label>
                    <span>下限</span>
                    <input
                      type="number"
                      step="0.1"
                      value={thresholds.fridgeTempMin}
                      onChange={(e) =>
                        onThresholds({
                          ...thresholds,
                          fridgeTempMin: Number(e.target.value),
                        })
                      }
                    />
                  </label>
                  <label>
                    <span>上限</span>
                    <input
                      type="number"
                      step="0.1"
                      value={thresholds.fridgeTempMax}
                      onChange={(e) =>
                        onThresholds({
                          ...thresholds,
                          fridgeTempMax: Number(e.target.value),
                        })
                      }
                    />
                  </label>
                </div>
              </fieldset>

              <fieldset disabled={!thresholds.useTempDeviation}>
                <legend>温度・冷凍庫用（℃）</legend>
                <div className="num-pair">
                  <label>
                    <span>下限</span>
                    <input
                      type="number"
                      step="0.1"
                      value={thresholds.freezerTempMin}
                      onChange={(e) =>
                        onThresholds({
                          ...thresholds,
                          freezerTempMin: Number(e.target.value),
                        })
                      }
                    />
                  </label>
                  <label>
                    <span>上限</span>
                    <input
                      type="number"
                      step="0.1"
                      value={thresholds.freezerTempMax}
                      onChange={(e) =>
                        onThresholds({
                          ...thresholds,
                          freezerTempMax: Number(e.target.value),
                        })
                      }
                    />
                  </label>
                </div>
              </fieldset>

              <fieldset disabled={!thresholds.useHumDeviation} className="span-2">
                <legend>湿度（共通・%）</legend>
                <div className="num-pair">
                  <label>
                    <span>下限</span>
                    <input
                      type="number"
                      step="0.1"
                      value={thresholds.humMin}
                      onChange={(e) =>
                        onThresholds({ ...thresholds, humMin: Number(e.target.value) })
                      }
                    />
                  </label>
                  <label>
                    <span>上限</span>
                    <input
                      type="number"
                      step="0.1"
                      value={thresholds.humMax}
                      onChange={(e) =>
                        onThresholds({ ...thresholds, humMax: Number(e.target.value) })
                      }
                    />
                  </label>
                </div>
              </fieldset>
            </div>

            <div className="advanced-row">
              <span className="row-label">欠損表示</span>
              <label className="radio-inline">
                <input
                  type="radio"
                  name="missing"
                  checked={missingDisplay === 'blank'}
                  onChange={() => onMissingDisplay('blank')}
                />
                空欄
              </label>
              <label className="radio-inline">
                <input
                  type="radio"
                  name="missing"
                  checked={missingDisplay === 'hyphen'}
                  onChange={() => onMissingDisplay('hyphen')}
                />
                ハイフン（-）
              </label>
            </div>
          </div>
        )}
      </section>

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
                  thresholds={thresholds}
                  missingDisplay={missingDisplay}
                />
              ) : printKind === 'weekly' && printWeekStart ? (
                <ReportPreview
                  key={`w-${previewDevice}-${printWeekStart.toISOString().slice(0, 10)}`}
                  kind="weekly"
                  weekStart={printWeekStart}
                  deviceId={previewDevice}
                  readings={devices[previewDevice] ?? []}
                  thresholds={thresholds}
                  missingDisplay={missingDisplay}
                />
              ) : null}
            </div>
          </>
        )}
      </section>

      <div className="action-bar">
        <div className="action-bar-info">
          {printKind === 'monthly' ? (
            printMonth ? (
              <>
                <strong>{printMonth.year}年{printMonth.month}月</strong> の月報を{' '}
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
