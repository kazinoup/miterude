/**
 * 履歴データを CSV 文字列に変換する共通ヘルパ。
 *
 * - センサー詳細画面の「CSV ダウンロード」
 * - センサー一覧の「一括 CSV 出力（ZIP）」
 * の双方から呼び出される。
 *
 * Excel が日本語を文字化けせず開けるよう先頭に BOM を付与し、改行は CRLF。
 * センサー番号 / モデル / メーカー / シリアル番号 / 区分 / 部屋は
 * 1 行目以降のコメント行 (# ...) として書き出し、各データ行で繰り返さない。
 */
import type { SensorThresholds } from '../types'
import { getThresholdForMetric } from './report'

type Reading = {
  measuredAt: Date
  temperature: number
  humidity: number
  battery?: number
}

/** CSV の先頭メタコメントに書き出すセンサー情報。 */
export type CsvSensorMeta = {
  deviceNumber: string
  manufacturer: string
  model: string
  serialNumber: string
  /** 区分（カテゴリ）名。未設定なら '(未設定)' を書く。 */
  categoryName?: string | null
  /** 部屋 / グループ名。未設定なら '(未設定)' を書く。 */
  groupName?: string | null
}

/** 計測値が「危険 / 注意 / 正常 / 判定なし」のどれに該当するか文字列で返す。
 *  CSV の判定列に出力する。 */
function classifyValue(
  v: number,
  metric: ReturnType<typeof getThresholdForMetric>,
): string {
  if (!metric) return ''
  const alertActive =
    metric.alert.enabled && (metric.alert.min != null || metric.alert.max != null)
  const warnActive =
    metric.warn.enabled && (metric.warn.min != null || metric.warn.max != null)
  if (!alertActive && !warnActive) return ''
  if (alertActive) {
    if (metric.alert.min != null && v < metric.alert.min) return '危険'
    if (metric.alert.max != null && v > metric.alert.max) return '危険'
  }
  if (warnActive) {
    if (metric.warn.min != null && v < metric.warn.min) return '注意'
    if (metric.warn.max != null && v > metric.warn.max) return '注意'
  }
  return '正常'
}

const LINE_BREAK = '\r\n'
const BOM = '﻿'

/** 履歴データを CSV 文字列に変換する。
 *  先頭にメタ情報（# センサー番号: ...）、続いてヘッダ、各行が計測値。 */
export function buildHistoryCsv(
  sensorMeta: CsvSensorMeta,
  readings: Reading[],
  thresholds: SensorThresholds | undefined,
): string {
  const header = [
    '計測日時',
    '温度(℃)',
    '湿度(%)',
    'バッテリー(%)',
    '温度判定',
    '湿度判定',
  ].join(',')
  const tempT = getThresholdForMetric(thresholds, 'temperature')
  const humT = getThresholdForMetric(thresholds, 'humidity')

  const rows = readings.map((r) => {
    const ts = r.measuredAt.toLocaleString('sv-SE').replace('T', ' ')
    const t = r.temperature.toFixed(1)
    const h = r.humidity.toFixed(1)
    const b = r.battery != null ? r.battery.toFixed(0) : ''
    const tJ = classifyValue(r.temperature, tempT)
    const hJ = classifyValue(r.humidity, humT)
    return [ts, t, h, b, tJ, hJ].join(',')
  })

  const metaLines = [
    `# センサー番号: ${sensorMeta.deviceNumber}`,
    `# モデル: ${sensorMeta.model}`,
    `# メーカー: ${sensorMeta.manufacturer}`,
    `# シリアル番号: ${sensorMeta.serialNumber}`,
    `# 区分: ${sensorMeta.categoryName ?? '(未設定)'}`,
    `# 部屋: ${sensorMeta.groupName ?? '(未設定)'}`,
  ]

  return BOM + [...metaLines, header, ...rows].join(LINE_BREAK) + LINE_BREAK
}

/** Blob を生成してブラウザにダウンロードさせる */
export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** 文字列を CSV 用 Blob にして渡す（ヘルパ）。 */
export function downloadCsv(filename: string, csvContent: string): void {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  downloadBlob(filename, blob)
}

/** ファイル名に使えない文字を `_` に置換する。
 *  `/ \\ : * ? " < > |` および制御文字、連続スペースを処理。 */
export function sanitizeFilenameSegment(s: string | undefined | null): string {
  if (!s) return ''
  return s
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
}
