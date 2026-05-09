/**
 * 一括 CSV 出力ダイアログ — Phase F-3
 *
 * センサー一覧で複数選択したセンサーに対し、指定期間の計測データを
 * 1 センサー = 1 CSV として出力し、ZIP にまとめてダウンロードする。
 *
 * ファイル名は「センサー名_デバイス名称_デバイス番号_開始日_終了日.csv」。
 * デバイス名称はモデル名（例: EM320-TH）を採用する。
 */
import { useEffect, useRef, useState } from 'react'
import { Download, X } from 'lucide-react'
import JSZip from 'jszip'
import type { DeviceStore, SensorStore } from '../types'
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

type Props = {
  open: boolean
  selectedSensorIds: string[]
  sensors: SensorStore
  devices: DeviceStore
  onClose: () => void
}

export function SensorBulkCsvDialog({
  open,
  selectedSensorIds,
  sensors,
  devices,
  onClose,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const [start, setStart] = useState<string>('')
  const [end, setEnd] = useState<string>('')
  const [busy, setBusy] = useState(false)

  // ダイアログを開いたら既定の期間（直近 30 日）をセット
  useEffect(() => {
    if (!open) return
    const today = new Date()
    const past = new Date(today)
    past.setDate(past.getDate() - 30)
    setStart(toDateInputValue(past))
    setEnd(toDateInputValue(today))
    setBusy(false)
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
      alert('期間を正しく指定してください。')
      return
    }
    if (sDate.getTime() > eDate.getTime()) {
      alert('開始日が終了日より後になっています。')
      return
    }
    if (selectedSensorIds.length === 0) {
      alert('対象センサーが選択されていません。')
      return
    }

    setBusy(true)
    try {
      // end は inclusive（その日 23:59:59 まで）として、翌日 0:00 で切る
      const startTs = sDate.getTime()
      const endExclusive = new Date(eDate)
      endExclusive.setDate(endExclusive.getDate() + 1)
      const endTs = endExclusive.getTime()

      const zip = new JSZip()
      let totalRows = 0
      let emptyCount = 0

      for (const sid of selectedSensorIds) {
        const sensor = sensors[sid]
        if (!sensor) continue
        const all = devices[sid] ?? []
        const filtered = all.filter((r) => {
          const t = r.measuredAt.getTime()
          return t >= startTs && t < endTs
        })
        if (filtered.length === 0) emptyCount += 1
        totalRows += filtered.length

        const filename = buildCsvFilename(
          sensor.name ?? sensor.id,
          sensor.model,
          sensor.deviceNumber ?? sensor.id,
          start,
          end,
        )
        const csv = buildHistoryCsv(sensor.id, filtered, sensor.thresholds)
        zip.file(filename, csv)
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
      toast('CSV 出力に失敗しました', 'error')
    } finally {
      setBusy(false)
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
              />
              <span className="muted">〜</span>
              <input
                type="date"
                className="select"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                aria-label="終了日"
              />
            </div>
            <p className="form-hint muted">
              指定した両端の日付を含みます（00:00:00 〜 23:59:59）。
            </p>
          </div>
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
