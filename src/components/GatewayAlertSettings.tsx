/**
 * ゲートウェイ用のアラート設定パネル — Phase F-3
 *
 * センサー側の SensorAlertSettings と見た目を揃えた簡易版。
 * ゲートウェイには温湿度の閾値判定もバッテリー残量もないため、
 * 発火条件は **オフラインのみ**。
 * 「アラート停止時間帯 / アラート停止日 / 通知設定」はセンサーと同じ仕様。
 */
import { AlertTriangle, Bell, CalendarOff, Clock, Send } from 'lucide-react'
import type {
  GatewayAlertSettings as GatewayAlertSettingsValue,
  NotificationGroupStore,
} from '../types'
import { NOTIFICATION_TIMING_LABELS } from '../types'
import {
  ExclusionDatesEditor,
  ExclusionWindowsEditor,
} from './AlertExclusionEditors'

type Props = {
  gatewayId: string
  value: GatewayAlertSettingsValue
  onChange: (next: GatewayAlertSettingsValue) => void
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

export function GatewayAlertSettings({
  gatewayId: _gatewayId,
  value,
  onChange,
  notificationGroups,
  notificationGroupId,
  onNotificationGroupChange,
}: Props) {
  function update<K extends keyof GatewayAlertSettingsValue>(
    key: K,
    val: GatewayAlertSettingsValue[K],
  ) {
    onChange({ ...value, [key]: val })
  }

  const groupList = Object.values(notificationGroups).sort((a, b) =>
    a.name.localeCompare(b.name),
  )
  const currentGroup = notificationGroupId
    ? notificationGroups[notificationGroupId]
    : undefined

  return (
    <>
      {/* ========================================
          1. アラート発生条件（オフラインのみ）
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
          ゲートウェイには温湿度の判定もバッテリーもないため、発生条件は
          <strong>オフライン通知のみ</strong>です。実際にメールなどで通知するかは
          下の「通知設定」で指定します。
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
              <span>
                ゲートウェイからの受信が途絶えたらアラートログを作成する
              </span>
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
        </div>
      </section>

      {/* ========================================
          2. アラート停止時間帯
          ======================================== */}
      <section className="panel-card alert-card">
        <div className="panel-card-head">
          <h2>
            <Clock size={16} className="head-icon" />
            アラートを止める時間帯
          </h2>
        </div>
        <p className="muted in-panel small-hint">
          ここで指定した時間帯はオフラインアラートを発生させません。
          例: 営業時間外や夜間メンテナンス中など。
          <strong>過去に発生したアラートは消えません</strong>
          が、今後その時間帯に当てはまる事象では発火しなくなります。
        </p>
        <ExclusionWindowsEditor
          windows={value.exclusionWindows ?? []}
          onChange={(next) => update('exclusionWindows', next)}
          showHeader={true}
        />
      </section>

      {/* ========================================
          3. アラート停止日
          ======================================== */}
      <section className="panel-card alert-card">
        <div className="panel-card-head">
          <h2>
            <CalendarOff size={16} className="head-icon" />
            アラートを止める日
          </h2>
        </div>
        <p className="muted in-panel small-hint">
          年末年始や故障修理期間など、特定日付の抑制設定。
          範囲内ではオフラインアラートを発生させません。
        </p>
        <ExclusionDatesEditor
          dates={value.exclusionDates ?? []}
          onChange={(next) => update('exclusionDates', next)}
          showHeader={true}
        />
      </section>

      {/* ========================================
          4. 通知設定（通知グループ紐付け）
          ======================================== */}
      <section className="panel-card alert-card">
        <div className="panel-card-head">
          <h2>
            <Bell size={16} className="head-icon" />
            通知設定
          </h2>
          <span className="panel-card-meta muted">
            蓄積されたアラートをどの通知グループで送るかを指定します。
          </span>
        </div>

        <div className="alert-form">
          <fieldset className="alert-fieldset">
            <legend>通知グループ</legend>
            <div className="alert-row">
              <span className="row-label">送信先</span>
              <select
                className="select"
                value={notificationGroupId ?? ''}
                onChange={(e) => {
                  const v = e.target.value
                  onNotificationGroupChange(v === '' ? null : v)
                }}
              >
                <option value="">— 通知しない —</option>
                {groupList.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}（{NOTIFICATION_TIMING_LABELS[g.timing] ?? g.timing}）
                  </option>
                ))}
              </select>
            </div>
            {currentGroup && (
              <p className="muted small in-panel">
                <Send size={11} className="row-leading-icon" />
                「{currentGroup.name}」に紐付け済み（送信タイミング:{' '}
                {NOTIFICATION_TIMING_LABELS[currentGroup.timing] ?? currentGroup.timing}）
              </p>
            )}
          </fieldset>
        </div>
      </section>
    </>
  )
}
