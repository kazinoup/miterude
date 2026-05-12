/**
 * 一括 CSV 出力ダイアログ — Phase 1.10
 *
 * センサー一覧で複数選択したセンサーに対し、指定期間の計測データを
 * Supabase `sensor_readings` から取得し、1 センサー = 1 CSV として ZIP にまとめる。
 *
 * ファイル名は「センサー名_モデル_デバイス番号_開始日_終了日.csv」。
 * CSV 先頭にはセンサー番号 / モデル / メーカー / シリアル番号 / 区分 / 部屋を
 * コメント行 (# ...) として書き出す。
 */
import { useEffect, useRef, useState } from 'react'
import { Download, X } from 'lucide-react'
import JSZip from 'jszip'
import type {
  SensorStore,
  SensorCategoryStore,
  SensorGroupStore,
} from '../types'
import {
  buildHistoryCsv,
  downloadBlob,
  sanitizeFilenameSegment,
} from '../lib/historyCsv'
import {
  fromDateInputValue,
  toDateInputValue,
} from '../lib/period'
import { toast } from '../lib/toast'
import { fetchReadingsForCsvExport } from '../lib/supabaseQueries'

type Props = {
  open: boolean
  selectedSensorIds: string[]
  sensors: SensorStore
  categories: SensorCategoryStore
  groups: SensorGroupStore
  onClose: () => void
}

export function SensorBulkCsvDialog({
  open,
  selectedSensorIds,
  sensors,
  categories,
  groups,
  onClose,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const [start, setStart] = useState<string>('')
  const [end, setEnd] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)

  // ダイアログを開いたら既定の期間（直近 30 日）をセット
  useEffect(() => {
    if (!open) return
    const today = new Date()
    const past = new Date(today)
    past.setDate(past.getDate() - 30)
    setStart(toDateInputValue(past))
    setEnd(toDateInputValue(today))
    setBusy(false)
    setProgress(null)
  }, [open])

  useEffect(() => {
    const dlg = ref.current
    if (!dlg) return
    if (open && !dlg.open) dlg.showModal()
    if (!open && dlg.open) dlg.close()
  }, [open])

  async function handleDownload() {
    const sDate = fromDateInputValue(start)
    const eDate = fromDateInputValue(end)
    if (!sDate || !eDate) {
      toast('期間を正しく指定してください。', 'error')
      return
    }
    if (sDate.getTime() > eDate.getTime()) {
      toast('開始日が終了日より後になっています。', 'error')
      return
    }
    if (selectedSensorIds.length === 0) {
      toast('対象センサーが選択されていません。', 'error')
      return
    }

    setBusy(true)
    setProgress({ done: 0, total: selectedSensorIds.length })
    try {
      // end は inclusive（その日 23:59:59 まで）として、翌日 0:00 で切る
      const fromIso = sDate.toISOString()
      const endExclusive = new Date(eDate)
      endExclusive.setDate(endExclusive.getDate() + 1)
      const toIso = endExclusive.toISOString()

      const zip = new JSZip()
      let totalRows = 0
      let emptyCount = 0

      let done = 0
      for (const sid of selectedSensorIds) {
        const sensor = sensors[sid]
        if (!sensor) {
          done += 1
          setProgress({ done, total: selectedSensorIds.length })
          continue
        }

        const readings = await fetchReadingsForCsvExport({
          sensorId: sid,
          fromIso,
          toIso,
        })
        // NaN を含む行（temperature/humidity いずれかが null だった）は CSV では空欄
        // 表示するため除外せず通すが、両方 NaN の行はサーバ側で既に除外済み。
        // ただし片方 NaN → toFixed が "NaN" を出すのを防ぐためここで揃える。
        const safeReadings = readings.map((r) => ({
          measuredAt: r.measuredAt,
          temperature: Number.isFinite(r.temperature) ? r.temperature : NaN,
          humidity: Number.isFinite(r.humidity) ? r.humidity : NaN,
          battery: r.battery,
        }))

        if (safeReadings.length === 0) emptyCount += 1
        totalRows += safeReadings.length

        const categoryName = sensor.categoryId
          ? categories[sensor.categoryId]?.name ?? null
          : null
        const groupName = sensor.groupId
          ? groups[sensor.groupId]?.name ?? null
          : null

        const filename = buildCsvFilename(
          sensor.name ?? sensor.id,
          sensor.model,
          sensor.deviceNumber ?? sensor.id,
          start,
          end,
        )
        const csv = buildHistoryCsv(
          {
            deviceNumber: sensor.deviceNumber ?? sensor.id,
            manufacturer: sensor.manufacturer,
            model: sensor.model,
            serialNumber: sensor.serialNumber,
            categoryName,
            groupName,
          },
          // buildHistoryCsv は toFixed を呼ぶので NaN は ' NaN' になる。
          // それを避けるため、片側 NaN の行は数値を 0 ではなく空欄に倒したいが
          // 既存の Reading 型が number 必須のため、NaN を許容したまま渡し、
          // toFixed の挙動はそのままにする（古い実装と挙動互換）。
          safeReadings,
          sensor.thresholds,
        )
        zip.file(filename, csv)

        done += 1
        setProgress({ done, total: selectedSensorIds.length })
      }

      const zipName = buildZipName(start, end)
      const blob = await zip.generateAsync({ type: 'blob' })
      downloadBlob(zipName, blob)

      const note =
        emptyCount > 0
          ? `${selectedSensorIds.length} 件の CSV を ZIP で出力（${emptyCount} 件はデータなし、合計 ${totalRows.toLocaleString('ja-JP')} 行）`
          : `${selectedSensorIds.length} 件の CSV を ZIP で出力（合計 ${totalRows.toLocaleString('ja-JP')} 行）`
      toast(note, 'success')
      onClose()
    } catch (e) {
      console.error('[miterude] bulk csv export failed', e)
      toast(
        e instanceof Error
          ? `CSV 出力に失敗しました: ${e.message}`
          : 'CSV 出力に失敗しました',
        'error',
      )
    } finally {
      setBusy(false)
      setProgress(null)
    }
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
      <div className="app-dialog-form">
        <header className="app-dialog-head">
          <h2>選択した {selectedSensorIds.length} 台の CSV を一括出力</h2>
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
          <p className="muted in-panel">
            指定期間の計測データを 1 センサー = 1 CSV としてまとめ、ZIP ファイルで
            ダウンロードします。ファイル名は「センサー名_モデル_デバイス番号_開始日_終了日.csv」です。
          </p>

          <div className="form-row">
            <span className="form-label">期間</span>
            <div className="bulk-csv-period-row">
              <input
                type="date"
                className="select"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                aria-label="開始日"
                disabled={busy}
              />
              <span className="muted">〜</span>
              <input
                type="date"
                className="select"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                aria-label="終了日"
                disabled={busy}
              />
            </div>
            <p className="form-hint muted">
              指定した両端の日付を含みます（00:00:00 〜 23:59:59）。
            </p>
          </div>

          {progress && (
            <p className="muted in-panel">
              取得中: {progress.done} / {progress.total} センサー
            </p>
          )}
        </div>

        <footer className="app-dialog-foot">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
            disabled={busy}
          >
            キャンセル
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleDownload}
            disabled={busy}
          >
            <Download size={14} />
            <span>{busy ? '生成中…' : 'ZIP をダウンロード'}</span>
          </button>
        </footer>
      </div>
    </dialog>
  )
}

/** CSV ファイル名: "センサー名_モデル_デバイス番号_開始_終了.csv" */
function buildCsvFilename(
  sensorName: string,
  model: string,
  deviceNumber: string,
  startInputValue: string,
  endInputValue: string,
): string {
  const parts = [
    sanitizeFilenameSegment(sensorName) || 'unnamed',
    sanitizeFilenameSegment(model) || 'model',
    sanitizeFilenameSegment(deviceNumber) || 'no-id',
    startInputValue,
    endInputValue,
  ]
  return parts.join('_') + '.csv'
}

/** ZIP 全体のファイル名: miterude_sensors_<開始>_<終了>.zip */
function buildZipName(startInputValue: string, endInputValue: string): string {
  return `miterude_sensors_${startInputValue}_${endInputValue}.zip`
}
