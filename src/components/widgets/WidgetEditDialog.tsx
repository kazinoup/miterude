import { useEffect, useRef, useState } from 'react'
import {
  X,
  LayoutGrid,
  LineChart as LineChartIcon,
  Map as MapIcon,
  Upload,
  AlertTriangle,
} from 'lucide-react'
import type {
  ChartMetric,
  Dashboard,
  SavedFilterStore,
  SensorCategoryStore,
  SensorGroupStore,
  SensorStore,
  Widget,
  WidgetSpan,
  WidgetType,
} from '../../types'
import { SensorPicker } from '../SensorPicker'
import {
  createChartWidget,
  createDeviationWidget,
  createMapWidget,
  createTileWidget,
  syncPins,
} from '../../lib/dashboard'

type Props = {
  open: boolean
  initial: Widget | null
  /** どのダッシュボードに追加するか（候補センサーのソース） */
  dashboard: Dashboard
  sensors: SensorStore
  groups: SensorGroupStore
  categories?: SensorCategoryStore
  savedFilters: SavedFilterStore
  onClose: () => void
  onSubmit: (widget: Widget) => void
}

export function WidgetEditDialog({
  open,
  initial,
  dashboard,
  sensors,
  groups,
  categories,
  savedFilters,
  onClose,
  onSubmit,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [type, setType] = useState<WidgetType>('tiles')
  const [title, setTitle] = useState('')
  const [span, setSpan] = useState<WidgetSpan>('full')
  /** 空配列 = ダッシュボードの全センサーを使う */
  const [sensorIds, setSensorIds] = useState<string[]>([])
  const [filterAll, setFilterAll] = useState(true)
  const [metric, setMetric] = useState<ChartMetric>('temperature')
  const [imageUrl, setImageUrl] = useState<string>('')

  useEffect(() => {
    if (!open) return
    if (initial) {
      setType(initial.type)
      setTitle(initial.title)
      setSpan(initial.span)
      const isAll = initial.sensorIds.length === 0
      setFilterAll(isAll)
      setSensorIds(isAll ? [] : [...initial.sensorIds])
      if (initial.type === 'chart') {
        setMetric(initial.metric)
      }
      if (initial.type === 'map') {
        setImageUrl(initial.imageUrl)
      } else {
        setImageUrl('')
      }
    } else {
      setType('tiles')
      setTitle('')
      setSpan('full')
      setSensorIds([])
      setFilterAll(true)
      setMetric('temperature')
      setImageUrl('')
    }
  }, [open, initial])

  useEffect(() => {
    const dlg = ref.current
    if (!dlg) return
    if (open && !dlg.open) dlg.showModal()
    if (!open && dlg.open) dlg.close()
  }, [open])

  const candidateSensorIds = dashboard.targetSensorIds

  async function compressImage(file: File, maxWidth = 1600, quality = 0.82): Promise<string> {
    const dataUrl: string = await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = () => reject(new Error('ファイルの読み込みに失敗しました'))
      reader.readAsDataURL(file)
    })
    const img: HTMLImageElement = await new Promise((resolve, reject) => {
      const i = new Image()
      i.onload = () => resolve(i)
      i.onerror = () => reject(new Error('画像のデコードに失敗しました'))
      i.src = dataUrl
    })
    let { naturalWidth: w, naturalHeight: h } = img
    if (w > maxWidth) {
      h = Math.round((h * maxWidth) / w)
      w = maxWidth
    }
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas が初期化できません')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(img, 0, 0, w, h)
    return canvas.toDataURL('image/jpeg', quality)
  }

  async function handleImageFile(file: File | null | undefined) {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      alert('画像ファイルを選択してください。')
      return
    }
    try {
      const compressed = await compressImage(file)
      setImageUrl(compressed)
    } catch (e) {
      alert(e instanceof Error ? e.message : '画像の処理に失敗しました')
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (type === 'map' && !imageUrl) {
      alert('フロアマップ画像をアップロードしてください。')
      return
    }

    // 空配列 = ダッシュボード全件、それ以外は明示的サブセット
    const finalSensorIds = filterAll ? [] : sensorIds

    let next: Widget
    if (type === 'tiles') {
      next =
        initial && initial.type === 'tiles'
          ? { ...initial, title: title.trim() || '最新計測', sensorIds: finalSensorIds, span }
          : createTileWidget({ sensorIds: finalSensorIds, title, span })
    } else if (type === 'chart') {
      next =
        initial && initial.type === 'chart'
          ? {
              ...initial,
              title:
                title.trim() ||
                (metric === 'temperature' ? '温度推移' : '湿度推移'),
              sensorIds: finalSensorIds,
              metric,
              span,
            }
          : createChartWidget({ sensorIds: finalSensorIds, metric, title, span })
    } else if (type === 'map') {
      // マップは絞り込んだセンサー（finalSensorIds か、空ならダッシュボード全件）に対応するピンを生成
      const effectiveSids = finalSensorIds.length > 0 ? finalSensorIds : candidateSensorIds
      const prevPins = initial && initial.type === 'map' ? initial.pins : []
      const pins = syncPins(prevPins, effectiveSids)
      next =
        initial && initial.type === 'map'
          ? {
              ...initial,
              title: title.trim() || 'フロアマップ',
              imageUrl,
              sensorIds: finalSensorIds,
              pins,
              span,
            }
          : createMapWidget({
              sensorIds: finalSensorIds,
              imageUrl,
              title,
              span,
              pins,
            })
    } else {
      // deviation
      next =
        initial && initial.type === 'deviation'
          ? {
              ...initial,
              title: title.trim() || '逸脱ピックアップ',
              sensorIds: finalSensorIds,
              span,
            }
          : createDeviationWidget({ sensorIds: finalSensorIds, title, span })
    }
    onSubmit(next)
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
      <form className="app-dialog-form" onSubmit={handleSubmit}>
        <header className="app-dialog-head">
          <h2>{initial ? 'ウィジェットを編集' : 'ウィジェットを追加'}</h2>
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
          {!initial && (
            <div className="form-row">
              <label className="form-label">ウィジェットタイプ</label>
              <div className="type-toggle type-toggle-4col">
                <button
                  type="button"
                  className={`type-toggle-btn ${type === 'tiles' ? 'is-active' : ''}`}
                  onClick={() => setType('tiles')}
                >
                  <LayoutGrid size={16} />
                  <div className="type-toggle-text">
                    <strong>タイル群</strong>
                    <span>選択センサーの最新値を並べる</span>
                  </div>
                </button>
                <button
                  type="button"
                  className={`type-toggle-btn ${type === 'chart' ? 'is-active' : ''}`}
                  onClick={() => setType('chart')}
                >
                  <LineChartIcon size={16} />
                  <div className="type-toggle-text">
                    <strong>折れ線グラフ</strong>
                    <span>複数センサーを 1 つのグラフに重ねる</span>
                  </div>
                </button>
                <button
                  type="button"
                  className={`type-toggle-btn ${type === 'map' ? 'is-active' : ''}`}
                  onClick={() => setType('map')}
                >
                  <MapIcon size={16} />
                  <div className="type-toggle-text">
                    <strong>フロアマップ</strong>
                    <span>図面上にセンサーを配置</span>
                  </div>
                </button>
                <button
                  type="button"
                  className={`type-toggle-btn ${type === 'deviation' ? 'is-active' : ''}`}
                  onClick={() => setType('deviation')}
                >
                  <AlertTriangle size={16} />
                  <div className="type-toggle-text">
                    <strong>逸脱ピックアップ</strong>
                    <span>期間内の逸脱だけを連続セグメントで一覧</span>
                  </div>
                </button>
              </div>
            </div>
          )}

          <div className="form-row">
            <label className="form-label" htmlFor="widget-title">
              タイトル
            </label>
            <input
              id="widget-title"
              type="text"
              className="form-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={
                type === 'tiles'
                  ? '最新計測'
                  : type === 'chart'
                    ? metric === 'temperature'
                      ? '温度推移'
                      : '湿度推移'
                    : type === 'map'
                      ? 'フロアマップ'
                      : '逸脱ピックアップ'
              }
              maxLength={40}
            />
          </div>

          {type === 'chart' && (
            <div className="form-row">
              <label className="form-label">表示する指標</label>
              <div className="seg-toggle">
                <button
                  type="button"
                  className={`seg-toggle-btn ${metric === 'temperature' ? 'is-active' : ''}`}
                  onClick={() => setMetric('temperature')}
                >
                  温度
                </button>
                <button
                  type="button"
                  className={`seg-toggle-btn ${metric === 'humidity' ? 'is-active' : ''}`}
                  onClick={() => setMetric('humidity')}
                >
                  湿度
                </button>
              </div>
              <p className="form-hint muted">
                対象期間はダッシュボード設定（{dashboard.defaultPeriod.type === 'day' ? '1日' : dashboard.defaultPeriod.type === 'week' ? '1週間' : '1ヶ月'}）を使用します。
              </p>
            </div>
          )}

          {type === 'map' && (
            <div className="form-row">
              <label className="form-label">フロアマップ画像</label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  void handleImageFile(e.target.files?.[0])
                  if (fileInputRef.current) fileInputRef.current.value = ''
                }}
              />
              {imageUrl ? (
                <div className="image-preview">
                  <img src={imageUrl} alt="マップ プレビュー" />
                  <div className="image-preview-actions">
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <Upload size={14} />
                      <span>画像を変更</span>
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm dialog-delete-btn"
                      onClick={() => setImageUrl('')}
                    >
                      画像を削除
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className="image-dropzone"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload size={20} />
                  <span>画像ファイルを選択</span>
                  <small className="muted">PNG / JPG など。自動で 1600px 幅に圧縮されます。</small>
                </button>
              )}
            </div>
          )}

          <div className="form-row">
            <label className="form-label">幅</label>
            <div className="seg-toggle">
              <button
                type="button"
                className={`seg-toggle-btn ${span === 'half' ? 'is-active' : ''}`}
                onClick={() => setSpan('half')}
              >
                1 / 2
              </button>
              <button
                type="button"
                className={`seg-toggle-btn ${span === 'full' ? 'is-active' : ''}`}
                onClick={() => setSpan('full')}
              >
                全幅
              </button>
            </div>
          </div>

          <div className="form-row">
            <label className="form-label">対象センサー</label>
            <p className="form-hint muted">
              ダッシュボードで選択された {candidateSensorIds.length} 台の中から、このウィジェットで表示するセンサーを選びます。
            </p>
            <div className="seg-toggle">
              <button
                type="button"
                className={`seg-toggle-btn ${filterAll ? 'is-active' : ''}`}
                onClick={() => {
                  setFilterAll(true)
                  setSensorIds([])
                }}
              >
                ダッシュボードと同じ（全件）
              </button>
              <button
                type="button"
                className={`seg-toggle-btn ${!filterAll ? 'is-active' : ''}`}
                onClick={() => setFilterAll(false)}
              >
                絞り込む
              </button>
            </div>

            {!filterAll && (
              <SensorPicker
                candidateSensors={Object.fromEntries(
                  candidateSensorIds.map((id) => [id, sensors[id]]).filter(([, s]) => Boolean(s)),
                )}
                selected={sensorIds}
                onChange={setSensorIds}
                groups={groups}
                categories={categories}
                savedFilters={savedFilters}
                hideSavedFilters
              />
            )}
          </div>
        </div>

        <footer className="app-dialog-foot">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            キャンセル
          </button>
          <button type="submit" className="btn btn-primary">
            {initial ? '保存' : '追加'}
          </button>
        </footer>
      </form>
    </dialog>
  )
}
