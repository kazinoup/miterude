import { AlertTriangle, Battery, Bell, CalendarOff, Clock, Send } from 'lucide-react'
import type {
  AlertSettings,
  NotificationGroupStore,
} from '../types'
import { NOTIFICATION_TIMING_LABELS } from '../types'
import { canReportBattery } from '../lib/supportedDevices'
import {
  ExclusionDatesEditor,
  ExclusionWindowsEditor,
} from './AlertExclusionEditors'
import type { DeviationStreak } from '../lib/alertLog'

type Props = {
  sensorId: string
  /** Phase C: バッテリーアラート UI の出し分けに使う */
  sensorModel: string
  value: AlertSettings
  onChange: (next: AlertSettings) => void
  notificationGroups: NotificationGroupStore
  notificationGroupId: string | null
  onNotificationGroupChange: (id: string | null) => void
  /** いま連続で何回逸脱しているか（直近 readings から計算）。
   *  「あと N 回でアラート発動」を表示するために使う。 */
  deviationStreak?: DeviationStreak
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
  deviationStreak,
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
            {/* 「いまどうなってるか」をリアルタイムに表示。
                逸脱判定が無効でも参考表示する（見えるだけで何もしない）。 */}
            {deviationStreak && (
              <DeviationStreakIndicator
                streak={deviationStreak}
                threshold={value.deviationConsecutiveCount}
                enabled={value.deviationEnabled}
              />
            )}
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
          1.5. 除外時間帯（営業時間外などアラートを止める時間）
          ======================================== */}
      <section className="panel-card alert-card">
        <div className="panel-card-head">
          <h2>
            <Clock size={16} className="head-icon" />
            アラートを止める時間帯
          </h2>
        </div>
        <p className="muted in-panel small-hint">
          ここで指定した時間帯は、選んだ種類のアラートを発生させません。
          例: 飲食店の閉店中（22:00–08:00）の温度逸脱、食品工場の夜間の電波切れ
          オフラインアラートなど。<strong>過去に発生したアラートは消えません</strong>
          が、今後その時間帯に当てはまる事象では発火しなくなります。
        </p>
        <ExclusionWindowsEditor
          windows={value.exclusionWindows ?? []}
          onChange={(next) => update('exclusionWindows', next)}
          showHeader={true}
        />
      </section>

      {/* ========================================
          1.6. 除外日（連休・修理期間などアラートを止める日付）
          ======================================== */}
      <section className="panel-card alert-card">
        <div className="panel-card-head">
          <h2>
            <CalendarOff size={16} className="head-icon" />
            アラートを止める日
          </h2>
        </div>
        <p className="muted in-panel small-hint">
          指定した日付範囲はアラートを発生させません。例: 年末年始の大型連休（12/29 〜 1/3）に
          冷凍庫を停止、故障修理で 2〜3 日センサーを止める、棚卸しなど一時休止期間など。
          範囲は <strong>両端の日付を含みます</strong>（1 日だけ止める場合は同じ日付を選ぶ）。
        </p>
        <ExclusionDatesEditor
          dates={value.exclusionDates ?? []}
          onChange={(next) => update('exclusionDates', next)}
          showHeader={true}
        />
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


/* ====================================================================
   現在の連続逸脱状態インジケータ
   --------------------------------------------------------------------
   「いま 2 回連続で逸脱しています。あと 1 回で発動します」のように、
   設定値（deviationConsecutiveCount）と直近サンプルの実状を結びつけて
   見せる。除外時間中は「除外時間中のため抑制中」も合わせて出す。
   ==================================================================== */
function DeviationStreakIndicator({
  streak,
  threshold,
  enabled,
}: {
  streak: DeviationStreak
  threshold: number
  enabled: boolean
}) {
  // データなし
  if (streak.latestLevel === null) {
    return (
      <div className="streak-indicator streak-empty">
        まだ計測データがないため、現状を判定できません。
      </div>
    )
  }
  // 直近サンプルは正常
  if (streak.count === 0) {
    return (
      <div className="streak-indicator streak-ok">
        <span className="streak-icon">✓</span>
        <span>直近のサンプルは正常範囲内です。</span>
      </div>
    )
  }
  const remaining = Math.max(0, threshold - streak.count)
  const reached = streak.count >= threshold

  // 除外時間中の場合のラベル
  const suppressedSuffix = streak.suppressedByExclusion ? (
    <span className="streak-suppressed">
      （除外時間中のためこの連続はアラートを発動しません）
    </span>
  ) : null

  if (reached) {
    return (
      <div
        className={`streak-indicator streak-fired ${
          streak.latestLevel === 'alert' ? 'is-alert' : 'is-warn'
        }`}
      >
        <span className="streak-icon">●</span>
        <span>
          現在 <strong>{streak.count}</strong> 回連続で逸脱しています。
          {enabled
            ? '基準（' +
              threshold +
              ' 回）を満たしているためアラートが発動しています。'
            : '（連続逸脱アラート OFF：ログには残りません）'}
        </span>
        {suppressedSuffix}
      </div>
    )
  }
  return (
    <div
      className={`streak-indicator streak-warn-up ${
        streak.latestLevel === 'alert' ? 'is-alert' : 'is-warn'
      }`}
    >
      <span className="streak-icon">▲</span>
      <span>
        現在 <strong>{streak.count}</strong> 回連続で逸脱中。
        {enabled ? (
          <>
            あと <strong>{remaining}</strong> 回でアラートが発動します。
          </>
        ) : (
          <>（連続逸脱アラート OFF）</>
        )}
      </span>
      {suppressedSuffix}
    </div>
  )
}
