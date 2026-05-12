import { Thermometer, Droplets, Tags, AlertCircle } from 'lucide-react'
import type {
  DeviceStore,
  GatewayStore,
  SensorCategory,
  SensorCategoryStore,
  SensorStore,
  TileWidget as TileWidgetT,
} from '../../types'
import { cellIsDeviation } from '../../lib/report'
import { CATEGORY_ICON_COMPONENTS } from '../../lib/categories'
import { ensureDate } from '../../lib/mock'
import { formatRelativeAgo } from '../../lib/jp'

type Props = {
  widget: TileWidgetT
  devices: DeviceStore
  sensors: SensorStore
  gateways: GatewayStore
  categories: SensorCategoryStore
  onOpenSensor: (id: string) => void
}

function CategoryBadge({ category }: { category?: SensorCategory }) {
  if (!category) {
    return (
      <span className="badge badge-kind badge-kind-other">
        <Tags size={11} strokeWidth={2.4} />
        未設定
      </span>
    )
  }
  const Icon = CATEGORY_ICON_COMPONENTS[category.icon]
  return (
    <span className="badge badge-kind" title={category.name}>
      <Icon size={11} strokeWidth={2.4} />
      {category.name}
    </span>
  )
}

export function TileWidget({
  widget,
  devices,
  sensors,
  gateways: _gateways,
  categories,
  onOpenSensor,
}: Props) {
  if (widget.sensorIds.length === 0) {
    return (
      <p className="muted in-panel">
        <AlertCircle size={14} className="inline-icon" />{' '}
        センサーが選択されていません。ウィジェットを編集してください。
      </p>
    )
  }

  return (
    <div className="widget-tile-grid">
      {widget.sensorIds.map((sid) => {
        const sensor = sensors[sid]
        if (!sensor) {
          return (
            <div key={sid} className="widget-tile widget-tile-missing">
              <span className="muted">{sid}（削除済み）</span>
            </div>
          )
        }
        const readings = devices[sid] ?? []
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

        const lastAt = lastReading
          ? ensureDate(lastReading.measuredAt)
          : ensureDate(sensor.lastSeenAt)

        return (
          <button
            type="button"
            key={sid}
            className={`widget-tile ${tDev || hDev ? 'has-deviation' : ''}`}
            onClick={() => onOpenSensor(sid)}
          >
            {/* Row 1: センサー名（name > deviceNumber > id の順で表示） */}
            <div
              className="widget-tile-name"
              title={sensor.id}
            >
              {sensor.name?.trim() || sensor.deviceNumber || sensor.id}
            </div>

            {/* Row 2: 温度・湿度（最新／太字） */}
            <div className="widget-tile-readings">
              <div className="widget-tile-reading">
                <Thermometer size={13} strokeWidth={2.2} />
                <span className={`widget-tile-value ${tDev ? 'cell-deviation' : ''}`}>
                  {lastReading?.temperature != null
                    ? lastReading.temperature.toFixed(1)
                    : '-'}
                </span>
                <span className="widget-tile-unit">℃</span>
              </div>
              <div className="widget-tile-reading">
                <Droplets size={13} strokeWidth={2.2} />
                <span className={`widget-tile-value ${hDev ? 'cell-deviation' : ''}`}>
                  {lastReading?.humidity != null
                    ? lastReading.humidity.toFixed(1)
                    : '-'}
                </span>
                <span className="widget-tile-unit">%</span>
              </div>
            </div>

            {/* Row 3: 区分 + 経過時間 */}
            <div className="widget-tile-foot">
              <CategoryBadge
                category={
                  sensor.categoryId ? categories[sensor.categoryId] : undefined
                }
              />
              <span className="widget-tile-ago" title={lastAt.toLocaleString('ja-JP')}>
                {formatRelativeAgo(lastAt)}
              </span>
            </div>
          </button>
        )
      })}
    </div>
  )
}
