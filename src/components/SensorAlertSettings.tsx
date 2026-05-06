import { useEffect, useState } from 'react'
import { Bell, Save, RotateCcw, Send } from 'lucide-react'
import type { AlertSettings, NotificationGroupStore } from '../types'
import { NOTIFICATION_TIMING_LABELS } from '../types'
import { defaultAlertSettings } from '../lib/mock'
import { toast } from '../lib/toast'

type Props = {
  sensorId: string
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

export function SensorAlertSettings({
  sensorId,
  value,
  onChange,
  notificationGroups,
  notificationGroupId,
  onNotificationGroupChange,
}: Props) {
  // 編集中の値（保存ボタンで反映）
  const [draft, setDraft] = useState<AlertSettings>(value)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    setDraft(value)
    setDirty(false)
  }, [value, sensorId])

  function update<K extends keyof AlertSettings>(key: K, val: AlertSettings[K]) {
    setDraft((d) => ({ ...d, [key]: val }))
    setDirty(true)
  }

  function handleSave() {
    onChange(draft)
    setDirty(false)
    toast(`${sensorId} のアラート設定を保存しました`, 'success')
  }

  function handleReset() {
    const def = defaultAlertSettings()
    setDraft(def)
    setDirty(true)
  }

  return (
    <section className="panel-card alert-card">
      <div className="panel-card-head">
        <h2>
          <Bell size={16} className="head-icon" />
          アラート設定
        </h2>
        <div className="panel-card-meta">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={handleReset}
            title="既定値に戻す"
          >
            <RotateCcw size={14} />
            <span>既定値</span>
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={!dirty}
            onClick={handleSave}
          >
            <Save size={14} />
            <span>{dirty ? '保存' : '保存済み'}</span>
          </button>
        </div>
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
              checked={draft.offlineEnabled}
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
                  disabled={!draft.offlineEnabled}
                  className={`chip-toggle ${
                    draft.offlineThresholdMinutes === p.minutes ? 'is-active' : ''
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
              checked={draft.deviationEnabled}
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
                disabled={!draft.deviationEnabled}
                value={draft.deviationConsecutiveCount}
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

      </div>
    </section>
  )
}
