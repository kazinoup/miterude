import { Battery, Bell, Send } from 'lucide-react'
import type { AlertSettings, NotificationGroupStore } from '../types'
import { NOTIFICATION_TIMING_LABELS } from '../types'
import { canReportBattery } from '../lib/supportedDevices'

type Props = {
  sensorId: string
  /** Phase C: バッテリーアラート UI の出し分けに使う */
  sensorModel: string
  value: AlertSettings
  onChange: (next: AlertSettings) => void
  notificationGroups: NotificationGroupStore
  notificationGroupId: string | null
  onNotificationGroupChange: (id: string | null) => void
}

const OFFLINE_PRESETS: { label: string; minutes: number }[] = [
  { label: '30 分', minutes: 30 },
  { label: '1 時間', minutes: 60 },
  { label: '6 時間', minutes: 360 },
  { label: '24 時間', minutes: 1440 },
]

/** Phase C: バッテリー残量しきい値プリセット（5% 刻み）。
 *  自由入力もできるが、よく使う値はチップで選べるようにする。 */
const BATTERY_PRESETS: number[] = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50]

/**
 * センサーごとのアラート設定 — Phase 9.12 でリアルタイム保存に統一。
 *
 * 順序:
 * 1. 通知グループ（送信先・送信タイミング）
 * 2. オフライン通知
 * 3. 連続逸脱通知
 * 4. バッテリー残量通知（Phase C / 機種が取得可能な場合のみ）
 */
export function SensorAlertSettings({
  sensorId: _sensorId,
  sensorModel,
  value,
  onChange,
  notificationGroups,
  notificationGroupId,
  onNotificationGroupChange,
}: Props) {
  function update<K extends keyof AlertSettings>(key: K, val: AlertSettings[K]) {
    onChange({ ...value, [key]: val })
  }

  const showBatterySection = canReportBattery(sensorModel)

  // 古いデータでは undefined → 既定値で表示
  const batteryEnabled = value.batteryEnabled ?? false
  const batteryThreshold = value.batteryThresholdPercent ?? 10

  return (
    <section className="panel-card alert-card">
      <div className="panel-card-head">
        <h2>
          <Bell size={16} className="head-icon" />
          アラート設定
        </h2>
        <span className="panel-card-meta muted">
          変更は自動保存されます
        </span>
      </div>

      <div className="alert-form">
        <fieldset className="alert-fieldset">
          <legend>通知グループ</legend>
          <div className="alert-row">
            <Send size={13} className="row-leading-icon" />
            <span className="row-label">通知の送信先・送信タイミング</span>
            <select
              className="select"
              value={notificationGroupId ?? ''}
              onChange={(e) => onNotificationGroupChange(e.target.value || null)}
            >
              <option value="">設定なし（通知しない）</option>
              {Object.values(notificationGroups)
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}（{NOTIFICATION_TIMING_LABELS[g.timing]}・{g.channels.length} 件）
                  </option>
                ))}
            </select>
          </div>
          {notificationGroupId == null && (
            <p className="muted in-panel" style={{ marginTop: '0.4rem' }}>
              「設定」→「通知グループ」で送信先と送信タイミングを定義し、ここから選択できます。
            </p>
          )}
        </fieldset>

        <fieldset className="alert-fieldset">
          <legend>オフライン通知</legend>
          <label className="check-row">
            <input
              type="checkbox"
              checked={value.offlineEnabled}
              onChange={(e) => update('offlineEnabled', e.target.checked)}
            />
            <span>センサーからの受信が途絶えたら通知する</span>
          </label>
          <div className="alert-row">
            <span className="row-label">判定までの時間</span>
            <div className="chip-group">
              {OFFLINE_PRESETS.map((p) => (
                <button
                  key={p.minutes}
                  type="button"
                  disabled={!value.offlineEnabled}
                  className={`chip-toggle ${
                    value.offlineThresholdMinutes === p.minutes ? 'is-active' : ''
                  }`}
                  onClick={() => update('offlineThresholdMinutes', p.minutes)}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </fieldset>

        <fieldset className="alert-fieldset">
          <legend>連続逸脱通知</legend>
          <label className="check-row">
            <input
              type="checkbox"
              checked={value.deviationEnabled}
              onChange={(e) => update('deviationEnabled', e.target.checked)}
            />
            <span>連続して閾値を超えたら通知する</span>
          </label>
          <div className="alert-row">
            <span className="row-label">何回連続で通知するか</span>
            <div className="num-input-row">
              <input
                type="number"
                min={1}
                max={50}
                step={1}
                disabled={!value.deviationEnabled}
                value={value.deviationConsecutiveCount}
                onChange={(e) =>
                  update(
                    'deviationConsecutiveCount',
                    Math.max(1, Math.min(50, Number(e.target.value) || 1)),
                  )
                }
              />
              <span className="num-input-suffix">回</span>
            </div>
          </div>
        </fieldset>

        {/* Phase C: バッテリー残量通知 — 機種が取得可能なときのみ表示 */}
        {showBatterySection && (
          <fieldset className="alert-fieldset">
            <legend>
              <Battery size={13} className="row-leading-icon" />
              バッテリー残量通知
            </legend>
            <label className="check-row">
              <input
                type="checkbox"
                checked={batteryEnabled}
                onChange={(e) => update('batteryEnabled', e.target.checked)}
              />
              <span>バッテリー残量が一定値を下回ったら通知する</span>
            </label>
            <div className="alert-row">
              <span className="row-label">通知のしきい値</span>
              <div className="num-input-row">
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  disabled={!batteryEnabled}
                  value={batteryThreshold}
                  onChange={(e) => {
                    const n = Number(e.target.value)
                    update(
                      'batteryThresholdPercent',
                      Math.max(0, Math.min(100, Number.isFinite(n) ? n : 10)),
                    )
                  }}
                />
                <span className="num-input-suffix">% を下回ったら</span>
              </div>
            </div>
            <div className="alert-row">
              <span className="row-label">よく使う値</span>
              <div className="chip-group">
                {BATTERY_PRESETS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    disabled={!batteryEnabled}
                    className={`chip-toggle ${
                      batteryThreshold === p ? 'is-active' : ''
                    }`}
                    onClick={() => update('batteryThresholdPercent', p)}
                  >
                    {p}%
                  </button>
                ))}
              </div>
            </div>
          </fieldset>
        )}
      </div>
    </section>
  )
}
