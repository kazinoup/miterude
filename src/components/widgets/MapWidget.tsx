import { useEffect, useRef, useState } from 'react'
import {
  Move,
  Check,
  ImageOff,
  X,
  Thermometer,
  Droplets,
  Tags,
} from 'lucide-react'
import type {
  DeviceStore,
  MapWidget as MapWidgetT,
  PinDisplay,
  PinSize,
  SensorCategory,
  SensorCategoryStore,
  SensorPin,
  SensorStore,
} from '../../types'
import { cellIsDeviation } from '../../lib/report'
import { CATEGORY_ICON_COMPONENTS } from '../../lib/categories'
import { ensureDate } from '../../lib/mock'
import { formatRelativeAgo } from '../../lib/jp'

type Props = {
  widget: MapWidgetT
  devices: DeviceStore
  sensors: SensorStore
  categories: SensorCategoryStore
  onUpdate: (widget: MapWidgetT) => void
  onOpenSensor: (id: string) => void
  /** ダッシュボードのビュー / 編集モード。false なら配置編集 UI を非表示 */
  editable?: boolean
}

function clamp01(n: number): number {
  if (n < 0) return 0
  if (n > 1) return 1
  return n
}

function MapCategoryBadge({ category }: { category?: SensorCategory }) {
  if (!category) {
    return (
      <span className="badge badge-kind badge-kind-other">
        <Tags size={10} strokeWidth={2.4} />
        未設定
      </span>
    )
  }
  const Icon = CATEGORY_ICON_COMPONENTS[category.icon]
  return (
    <span className="badge badge-kind" title={category.name}>
      <Icon size={10} strokeWidth={2.4} />
      {category.name}
    </span>
  )
}

const DRAG_THRESHOLD_PX = 4

export function MapWidget({
  widget,
  devices,
  sensors,
  categories,
  onUpdate,
  onOpenSensor,
  editable = true,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [editMode, setEditMode] = useState(false)
  const [localPins, setLocalPins] = useState<SensorPin[]>(widget.pins)
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null)
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null)

  // ダッシュボードがビューモードに戻ったらピン編集も解除する
  useEffect(() => {
    if (!editable && editMode) {
      setEditMode(false)
      setSelectedIdx(null)
    }
  }, [editable, editMode])

  // ドラッグ判定: pointerdown 時の座標と drag 発生フラグ
  const dragStartRef = useRef<{ x: number; y: number } | null>(null)
  const draggedRef = useRef(false)

  // 外部からのウィジェット更新（タイトル変更・画像変更など）に追従
  useEffect(() => {
    setLocalPins(widget.pins)
  }, [widget.pins])

  // 編集モード OFF にしたら選択状態もクリア
  useEffect(() => {
    if (!editMode) setSelectedIdx(null)
  }, [editMode])

  function startInteraction(idx: number, e: React.PointerEvent) {
    if (!editMode) return
    e.preventDefault()
    e.stopPropagation()
    ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
    setDraggingIdx(idx)
    dragStartRef.current = { x: e.clientX, y: e.clientY }
    draggedRef.current = false
  }

  function onPointerMove(e: React.PointerEvent) {
    if (draggingIdx === null) return
    const start = dragStartRef.current
    if (!start) return
    const dx = e.clientX - start.x
    const dy = e.clientY - start.y
    if (!draggedRef.current && Math.abs(dx) < DRAG_THRESHOLD_PX && Math.abs(dy) < DRAG_THRESHOLD_PX) {
      return
    }
    draggedRef.current = true
    const container = containerRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return
    const x = clamp01((e.clientX - rect.left) / rect.width)
    const y = clamp01((e.clientY - rect.top) / rect.height)
    setLocalPins((prev) => prev.map((p, i) => (i === draggingIdx ? { ...p, x, y } : p)))
  }

  function endInteraction() {
    if (draggingIdx === null) return
    const idx = draggingIdx
    setDraggingIdx(null)
    dragStartRef.current = null

    if (draggedRef.current) {
      // ドラッグ完了 → 差分があれば保存
      const same =
        widget.pins.length === localPins.length &&
        widget.pins.every((p, i) => {
          const q = localPins[i]
          return p.sensorId === q.sensorId && p.x === q.x && p.y === q.y
        })
      if (!same) onUpdate({ ...widget, pins: localPins })
    } else {
      // クリック扱い: 選択をトグル
      setSelectedIdx((prev) => (prev === idx ? null : idx))
    }
  }

  function deselectIfBackground(e: React.PointerEvent) {
    // 背景クリックは選択を解除（ピン上は startInteraction で stopPropagation してる）
    if (e.target === containerRef.current || (e.target as HTMLElement).classList.contains('map-image')) {
      setSelectedIdx(null)
    }
  }

  function handleOpenSensor(sid: string, e: React.MouseEvent) {
    if (editMode) {
      // 編集モード時は遷移しない（select は pointerup 側で処理）
      e.stopPropagation()
      return
    }
    onOpenSensor(sid)
  }

  function updateSelectedPin(patch: Partial<SensorPin>) {
    if (selectedIdx === null) return
    const next = localPins.map((p, i) => (i === selectedIdx ? { ...p, ...patch } : p))
    setLocalPins(next)
    onUpdate({ ...widget, pins: next })
  }

  if (!widget.imageUrl) {
    return (
      <div className="map-empty">
        <ImageOff size={28} strokeWidth={1.5} />
        <p>マップ画像が設定されていません。</p>
        <small className="muted">
          ウィジェットの「編集」から画像をアップロードしてください。
        </small>
      </div>
    )
  }

  const selectedPin = selectedIdx !== null ? localPins[selectedIdx] : null
  const selectedSensor = selectedPin ? sensors[selectedPin.sensorId] : null

  return (
    <div className="map-widget">
      {editable && (
        <div className="map-toolbar">
          <span className="muted">{widget.sensorIds.length} センサー配置中</span>
          <button
            type="button"
            className={`btn btn-sm ${editMode ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setEditMode((v) => !v)}
          >
            {editMode ? (
              <>
                <Check size={14} />
                <span>配置を完了</span>
              </>
            ) : (
              <>
                <Move size={14} />
                <span>配置を編集</span>
              </>
            )}
          </button>
        </div>
      )}

      <div
        ref={containerRef}
        className={`map-container ${editMode ? 'is-editing' : ''}`}
        onPointerDown={deselectIfBackground}
        onPointerMove={onPointerMove}
        onPointerUp={endInteraction}
        onPointerCancel={endInteraction}
      >
        <img src={widget.imageUrl} alt={widget.title} className="map-image" draggable={false} />

        {localPins.map((pin, idx) => {
          const sensor = sensors[pin.sensorId]
          if (!sensor) return null

          const readings = devices[pin.sensorId] ?? []
          const lastReading = readings[readings.length - 1]

          const tDev = cellIsDeviation(
            lastReading?.temperature ?? null,
            'temperature',
            sensor.thresholds,
          )
          const hDev = cellIsDeviation(
            lastReading?.humidity ?? null,
            'humidity',
            sensor.thresholds,
          )

          const isDeviation = tDev || hDev
          const isDragging = draggingIdx === idx
          const isSelected = selectedIdx === idx
          const size = pin.size ?? 'md'
          const display = pin.display ?? 'both'

          const lastAt = lastReading
            ? ensureDate(lastReading.measuredAt)
            : ensureDate(sensor.lastSeenAt)

          return (
            <div
              key={pin.sensorId}
              className={[
                'map-pin',
                `size-${size}`,
                editMode ? 'is-editable' : '',
                isDragging ? 'is-dragging' : '',
                isSelected ? 'is-selected' : '',
                // 編集中は逸脱の点滅は止め、配置作業に集中できるようにする
                !editMode && isDeviation ? 'has-deviation' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              style={{
                left: `${pin.x * 100}%`,
                top: `${pin.y * 100}%`,
              }}
              onPointerDown={(e) => startInteraction(idx, e)}
              onClick={(e) => handleOpenSensor(pin.sensorId, e)}
              title={sensor.name?.trim() || sensor.deviceNumber || sensor.id}
            >
              {/* Row 1: 表示名（name > deviceNumber > id） */}
              <div className="map-pin-name">
                {sensor.name?.trim() || sensor.deviceNumber || sensor.id}
              </div>

              {/* Row 2: 編集中は表示項目のラベル、通常時は実際の値 */}
              <div className="map-pin-readings">
                {editMode ? (
                  <>
                    {(display === 'both' || display === 'temperature') && (
                      <span className="map-pin-placeholder">温度</span>
                    )}
                    {(display === 'both' || display === 'humidity') && (
                      <span className="map-pin-placeholder">湿度</span>
                    )}
                  </>
                ) : (
                  <>
                    {(display === 'both' || display === 'temperature') && (
                      <span className={tDev ? 'cell-deviation' : ''}>
                        {lastReading?.temperature != null
                          ? `${lastReading.temperature.toFixed(1)}℃`
                          : '-'}
                      </span>
                    )}
                    {(display === 'both' || display === 'humidity') && (
                      <span className={hDev ? 'cell-deviation' : ''}>
                        {lastReading?.humidity != null
                          ? `${lastReading.humidity.toFixed(1)}%`
                          : '-'}
                      </span>
                    )}
                  </>
                )}
              </div>

              {/* Row 3: 区分バッジ + 経過時間（編集中は経過時間を出さない） */}
              <div className="map-pin-foot">
                <MapCategoryBadge
                  category={
                    sensor.categoryId ? categories[sensor.categoryId] : undefined
                  }
                />
                {!editMode && (
                  <span className="map-pin-ago" title={lastAt.toLocaleString('ja-JP')}>
                    {formatRelativeAgo(lastAt)}
                  </span>
                )}
              </div>
            </div>
          )
        })}

        {editMode && selectedPin && selectedSensor && (
          <div
            className="map-pin-properties"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div className="properties-head">
              <span className="properties-label">選択中</span>
              <strong className="properties-name">{selectedSensor.id}</strong>
              <button
                type="button"
                className="icon-btn"
                aria-label="選択を解除"
                onClick={() => setSelectedIdx(null)}
              >
                <X size={14} />
              </button>
            </div>
            <div className="properties-row">
              <span className="properties-row-label">サイズ</span>
              <div className="seg-toggle">
                {(['sm', 'md', 'lg'] as PinSize[]).map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={`seg-toggle-btn ${(selectedPin.size ?? 'md') === s ? 'is-active' : ''}`}
                    onClick={() => updateSelectedPin({ size: s })}
                  >
                    {s === 'sm' ? '小' : s === 'md' ? '中' : '大'}
                  </button>
                ))}
              </div>
            </div>
            <div className="properties-row">
              <span className="properties-row-label">表示</span>
              <div className="seg-toggle">
                {([
                  { key: 'both', label: '両方' },
                  { key: 'temperature', label: '温度' },
                  { key: 'humidity', label: '湿度' },
                ] as { key: PinDisplay; label: string }[]).map((d) => (
                  <button
                    key={d.key}
                    type="button"
                    className={`seg-toggle-btn ${(selectedPin.display ?? 'both') === d.key ? 'is-active' : ''}`}
                    onClick={() => updateSelectedPin({ display: d.key })}
                  >
                    {d.key === 'temperature' && <Thermometer size={12} />}
                    {d.key === 'humidity' && <Droplets size={12} />}
                    {d.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {editMode && (
        <p className="muted map-edit-hint">
          ピンをドラッグで移動、クリックで選択（サイズ・表示項目を変更できます）。
        </p>
      )}
    </div>
  )
}
