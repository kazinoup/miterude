import { AlertTriangle, Battery, Bell, Send } from 'lucide-react'
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

/** Phase C: バッテリー残量しきい値プリセット（5% 刻み）。 */
const BATTERY_PRESETS: number[] = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50]

/**
 * センサーごとのアラート設定 + 通知設定。
 *
 * 設計（Phase: アラートと通知を概念分離）:
 *  - 上段「アラート発生条件」: ON にすると、その条件で AlertLog エントリが作られる
 *    （オフライン / 連続逸脱 / バッテリー残量）。通知の有無に関わらずログは溜まる。
 *  - 下段「通知設定」: 蓄積された AlertLog を、どの通知グループ（メール等）で
 *    送るかを指定する。通知グループ未設定でもログ自体は記録される。
 *
 * このため画面では 2 つの panel-card に明確に分け、
 *  「いつアラートを発生させるか」と「どう通知するか」を視覚的に分離する。
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
    <>
      {/* ========================================
          1. アラート発生条件（ログ作成のトリガー）
          ======================================== */}
      <section className="panel-card alert-card">
        <div className="panel-card-head">
          <h2>
            <AlertTriangle size={16} className="head-icon" />
            アラート発生条件
          </h2>
          <span className="panel-card-meta muted">変更は自動保存されます</span>
        </div>
        <p className="muted in-panel small-hint">
          以下の条件を ON にすると、その条件に該当した時点でアラートログが作成されます。実際にメールなどで通知するかは下の「通知設定」で指定します。
        </p>

        <div className="alert-form">
          <fieldset className="alert-fieldset">
            <legend>オフラインアラート</legend>
            <label className="check-row">
              <input
                type="checkbox"
                checked={value.offlineEnabled}
                onChange={(e) => update('offlineEnabled', e.target.checked)}
              />
              <span>センサーからの受信が途絶えたらアラートログを作成する</span>
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
            <legend>連続逸脱アラート</legend>
            <label className="check-row">
              <input
                type="checkbox"
                checked={value.deviationEnabled}
                onChange={(e) => update('deviationEnabled', e.target.checked)}
              />
              <span>連続して閾値を超えたらアラートログを作成する</span>
            </label>
            <div className="alert-row">
              <span className="row-label">何回連続で発動するか</span>
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

          {/* Phase C: バッテリー残量アラート — 機種が取得可能なときのみ表示 */}
          {showBatterySection && (
            <fieldset className="alert-fieldset">
              <legend>
                <Battery size={13} className="row-leading-icon" />
                バッテリー残量アラート
              </legend>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={batteryEnabled}
                  onChange={(e) => update('batteryEnabled', e.target.checked)}
                />
                <span>
                  バッテリー残量が一定値を下回ったらアラートログを作成する
                </span>
              </label>
              <div className="alert-row">
                <span className="row-label">発動のしきい値</span>
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

      {/* ========================================
          2. 通知設定（アラートログをどう通知するか）
          ======================================== */}
      <section className="panel-card alert-card">
        <div className="panel-card-head">
          <h2>
            <Bell size={16} className="head-icon" />
            通知設定
          </h2>
          <span className="panel-card-meta muted">変更は自動保存されます</span>
        </div>
        <p className="muted in-panel small-hint">
          上のアラート発生条件で作られたログをメール等で通知する場合に、配信先と送信タイミングを「通知グループ」で指定します。未設定でもアラートログ自体は溜まります。
        </p>

        <div className="alert-form">
          <fieldset className="alert-fieldset">
            <legend>通知グループ</legend>
            <div className="alert-row">
              <Send size={13} className="row-leading-icon" />
              <span className="row-label">通知の送信先・送信タイミング</span>
              <select
                className="select"
                value={notificationGroupId ?? ''}
                onChange={(e) =>
                  onNotificationGroupChange(e.target.value || null)
                }
              >
                <option value="">設定なし（通知しない）</option>
                {Object.values(notificationGroups)
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}（{NOTIFICATION_TIMING_LABELS[g.timing]}・
                      {g.channels.length} 件）
                    </option>
                  ))}
              </select>
            </div>
            {notificationGroupId == null && (
              <p className="muted in-panel" style={{ marginTop: '0.4rem' }}>
                「設定」→「通知設定」→「通知グループ」で送信先と送信タイミングを定義し、ここから選択できます。
              </p>
            )}
          </fieldset>
        </div>
      </section>
    </>
  )
}
