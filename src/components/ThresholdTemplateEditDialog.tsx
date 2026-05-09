/**
 * センサー設定テンプレートの新規作成 / 編集ダイアログ — Phase 9.15 を拡張。
 *
 * 4 つの設定項目（閾値判定 / アラート発生条件 / 除外時間・除外日 / 通知設定）を
 * **個別にチェックできるパッケージ** として保存する。チェックを外した項目は
 * テンプレート適用時に上書きされない（各センサーの既存値を維持）。
 *
 * UI 構造:
 *  - 共通項目: テンプレート名 / 説明
 *  - スコープ 4 セクション。各セクションは「☑ このテンプレで上書きする」のチェック
 *    + その下に値の編集 UI を持つ。チェック OFF なら編集 UI は薄く（参考表示）。
 */
import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Battery, Bell, CalendarOff, Check, Clock, Sliders, X } from 'lucide-react'
import type {
  AlertExclusionDate,
  AlertExclusionWindow,
  AlertSettingsForTemplate,
  NotificationGroupStore,
  SensorSettingsTemplateScope,
  TempHumidityThresholds,
  ThresholdTemplate,
} from '../types'
import { NOTIFICATION_TIMING_LABELS } from '../types'
import {
  TempHumidityThresholdsEditor,
  emptyTempHumidityThresholds,
} from './ThresholdValuesEditor'
import {
  ExclusionDatesEditor,
  ExclusionWindowsEditor,
} from './AlertExclusionEditors'
import { createTemplate } from '../lib/thresholdTemplates'

type Props = {
  open: boolean
  /** 編集対象。null なら新規作成 */
  initial: ThresholdTemplate | null
  notificationGroups: NotificationGroupStore
  onClose: () => void
  onSubmit: (t: ThresholdTemplate) => void
}

/** 既定のアラート発生条件（テンプレ初期値）。 */
function defaultTemplateAlertSettings(): AlertSettingsForTemplate {
  return {
    offlineEnabled: true,
    offlineThresholdMinutes: 60,
    deviationEnabled: true,
    deviationConsecutiveCount: 3,
    notifyChannels: { email: true, slack: false, push: false },
    batteryEnabled: false,
    batteryThresholdPercent: 10,
  }
}

export function ThresholdTemplateEditDialog({
  open,
  initial,
  notificationGroups,
  onClose,
  onSubmit,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [scope, setScope] = useState<SensorSettingsTemplateScope>({
    thresholds: true,
    alertSettings: false,
    exclusions: false,
    notification: false,
  })
  const [thresholds, setThresholds] = useState<TempHumidityThresholds>(
    emptyTempHumidityThresholds(),
  )
  const [alertSettings, setAlertSettings] = useState<AlertSettingsForTemplate>(
    defaultTemplateAlertSettings(),
  )
  const [exclusionWindows, setExclusionWindows] = useState<
    AlertExclusionWindow[]
  >([])
  const [exclusionDates, setExclusionDates] = useState<AlertExclusionDate[]>([])
  const [notificationGroupId, setNotificationGroupId] = useState<string | null>(
    null,
  )

  // ダイアログが開く度に initial で state をリセット
  useEffect(() => {
    if (!open) return
    setName(initial?.name ?? '')
    setDescription(initial?.description ?? '')
    setScope(
      initial?.scope ?? {
        thresholds: true,
        alertSettings: false,
        exclusions: false,
        notification: false,
      },
    )
    setThresholds(
      initial?.thresholds && initial.thresholds.kind === 'temperature-humidity'
        ? (initial.thresholds as TempHumidityThresholds)
        : emptyTempHumidityThresholds(),
    )
    setAlertSettings(initial?.alertSettings ?? defaultTemplateAlertSettings())
    setExclusionWindows(initial?.exclusionWindows ?? [])
    setExclusionDates(initial?.exclusionDates ?? [])
    setNotificationGroupId(initial?.notificationGroupId ?? null)
  }, [open, initial])

  useEffect(() => {
    const dlg = ref.current
    if (!dlg) return
    if (open && !dlg.open) dlg.showModal()
    if (!open && dlg.open) dlg.close()
  }, [open])

  const isEdit = initial !== null
  const valid =
    name.trim().length > 0 &&
    // 何か 1 つは scope ON でないと意味のないテンプレになる
    (scope.thresholds || scope.alertSettings || scope.exclusions || scope.notification)

  function handleSave() {
    if (!valid) return
    if (initial) {
      onSubmit({
        ...initial,
        name: name.trim(),
        description: description.trim() || undefined,
        scope,
        thresholds: scope.thresholds ? thresholds : undefined,
        alertSettings: scope.alertSettings ? alertSettings : undefined,
        exclusionWindows: scope.exclusions ? exclusionWindows : undefined,
        exclusionDates: scope.exclusions ? exclusionDates : undefined,
        notificationGroupId: scope.notification ? notificationGroupId : undefined,
      })
    } else {
      onSubmit(
        createTemplate({
          name: name.trim(),
          description: description.trim() || undefined,
          targetKind: 'temperature-humidity',
          scope,
          thresholds: scope.thresholds ? thresholds : undefined,
          alertSettings: scope.alertSettings ? alertSettings : undefined,
          exclusionWindows: scope.exclusions ? exclusionWindows : undefined,
          exclusionDates: scope.exclusions ? exclusionDates : undefined,
          notificationGroupId: scope.notification ? notificationGroupId : undefined,
        }),
      )
    }
  }

  function setScopeAt<K extends keyof SensorSettingsTemplateScope>(
    k: K,
    v: boolean,
  ) {
    setScope((prev) => ({ ...prev, [k]: v }))
  }

  function updateAlert<K extends keyof AlertSettingsForTemplate>(
    k: K,
    v: AlertSettingsForTemplate[K],
  ) {
    setAlertSettings((prev) => ({ ...prev, [k]: v }))
  }

  return (
    <dialog
      ref={ref}
      className="app-dialog app-dialog-lg"
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onClose={onClose}
    >
      <div className="app-dialog-form">
        <header className="app-dialog-head">
          <h2>
            <Sliders size={16} className="head-icon" />
            {isEdit
              ? 'センサー設定テンプレートを編集'
              : 'センサー設定テンプレートを新規作成'}
          </h2>
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
          <p className="muted small-hint" style={{ marginBottom: '0.6rem' }}>
            「センサーごとの設定」を一括コピーするためのテンプレートです。
            下の 4 種類から、テンプレートに含める項目を選んでください。
            含まれない項目は、テンプレを当てたときに各センサーの既存値が維持されます。
          </p>

          <label className="form-row">
            <span className="form-label">テンプレート名</span>
            <input
              type="text"
              className="form-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例: 飲食店 標準セット"
              autoFocus
              maxLength={60}
            />
          </label>

          <label className="form-row">
            <span className="form-label">説明（任意）</span>
            <input
              type="text"
              className="form-input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="このテンプレートの用途や運用基準"
              maxLength={120}
            />
          </label>

          <div className="form-row">
            <span className="form-label">対象種別</span>
            <span className="muted">温湿度センサー</span>
          </div>

          {/* 1. 閾値判定 */}
          <ScopeSection
            icon={<AlertTriangle size={14} />}
            title="閾値判定"
            description="温度・湿度の上下限（注意・危険）"
            checked={scope.thresholds}
            onCheckedChange={(v) => setScopeAt('thresholds', v)}
          >
            <TempHumidityThresholdsEditor
              value={thresholds}
              onChange={setThresholds}
            />
          </ScopeSection>

          {/* 2. アラート発生条件 */}
          <ScopeSection
            icon={<Bell size={14} />}
            title="アラート発生条件"
            description="オフライン / 連続逸脱 / バッテリー残量 のしきい値"
            checked={scope.alertSettings}
            onCheckedChange={(v) => setScopeAt('alertSettings', v)}
          >
            <div className="alert-form">
              <fieldset className="alert-fieldset">
                <legend>オフラインアラート</legend>
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={alertSettings.offlineEnabled}
                    onChange={(e) =>
                      updateAlert('offlineEnabled', e.target.checked)
                    }
                  />
                  <span>受信が途絶えたらアラートログを作成する</span>
                </label>
                <div className="alert-row">
                  <span className="row-label">判定までの時間</span>
                  <div className="num-input-row">
                    <input
                      type="number"
                      min={1}
                      max={1440}
                      step={1}
                      disabled={!alertSettings.offlineEnabled}
                      value={alertSettings.offlineThresholdMinutes}
                      onChange={(e) =>
                        updateAlert(
                          'offlineThresholdMinutes',
                          Math.max(
                            1,
                            Math.min(1440, Number(e.target.value) || 60),
                          ),
                        )
                      }
                    />
                    <span className="num-input-suffix">分</span>
                  </div>
                </div>
              </fieldset>

              <fieldset className="alert-fieldset">
                <legend>連続逸脱アラート</legend>
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={alertSettings.deviationEnabled}
                    onChange={(e) =>
                      updateAlert('deviationEnabled', e.target.checked)
                    }
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
                      disabled={!alertSettings.deviationEnabled}
                      value={alertSettings.deviationConsecutiveCount}
                      onChange={(e) =>
                        updateAlert(
                          'deviationConsecutiveCount',
                          Math.max(1, Math.min(50, Number(e.target.value) || 3)),
                        )
                      }
                    />
                    <span className="num-input-suffix">回</span>
                  </div>
                </div>
              </fieldset>

              <fieldset className="alert-fieldset">
                <legend>
                  <Battery size={13} className="row-leading-icon" />
                  バッテリー残量アラート
                </legend>
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={alertSettings.batteryEnabled ?? false}
                    onChange={(e) =>
                      updateAlert('batteryEnabled', e.target.checked)
                    }
                  />
                  <span>バッテリー残量が一定値を下回ったらアラートログを作成する</span>
                </label>
                <div className="alert-row">
                  <span className="row-label">発動のしきい値</span>
                  <div className="num-input-row">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      disabled={!(alertSettings.batteryEnabled ?? false)}
                      value={alertSettings.batteryThresholdPercent ?? 10}
                      onChange={(e) =>
                        updateAlert(
                          'batteryThresholdPercent',
                          Math.max(
                            0,
                            Math.min(100, Number(e.target.value) || 10),
                          ),
                        )
                      }
                    />
                    <span className="num-input-suffix">% を下回ったら</span>
                  </div>
                </div>
              </fieldset>
            </div>
          </ScopeSection>

          {/* 3. 除外時間・除外日 */}
          <ScopeSection
            icon={<Clock size={14} />}
            title="除外時間・除外日"
            description="営業時間外や連休中など、アラートを止める時間と日付"
            checked={scope.exclusions}
            onCheckedChange={(v) => setScopeAt('exclusions', v)}
          >
            <div className="template-exclusions">
              <ExclusionWindowsEditor
                windows={exclusionWindows}
                onChange={setExclusionWindows}
                showHeader={true}
              />
              <ExclusionDatesEditor
                dates={exclusionDates}
                onChange={setExclusionDates}
                showHeader={true}
              />
            </div>
          </ScopeSection>

          {/* 4. 通知設定 */}
          <ScopeSection
            icon={<CalendarOff size={14} />}
            title="通知設定"
            description="アラート発生時にどの通知グループへ送るか"
            checked={scope.notification}
            onCheckedChange={(v) => setScopeAt('notification', v)}
          >
            <div className="form-row">
              <span className="form-label">通知グループ</span>
              <select
                className="select"
                value={notificationGroupId ?? ''}
                onChange={(e) =>
                  setNotificationGroupId(e.target.value || null)
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
          </ScopeSection>

          {!valid && name.trim().length > 0 && (
            <p className="form-error">
              テンプレートには 1 つ以上の項目を含めてください。
            </p>
          )}
        </div>

        <footer className="app-dialog-foot">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            キャンセル
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleSave}
            disabled={!valid}
          >
            <Check size={14} />
            <span>{isEdit ? '保存' : '作成'}</span>
          </button>
        </footer>
      </div>
    </dialog>
  )
}

/** スコープごとに「適用するか」のチェック + 編集 UI を 1 セクションに収めるカード */
function ScopeSection({
  icon,
  title,
  description,
  checked,
  onCheckedChange,
  children,
}: {
  icon: React.ReactNode
  title: string
  description: string
  checked: boolean
  onCheckedChange: (v: boolean) => void
  children: React.ReactNode
}) {
  return (
    <div className={`tpl-scope-section ${checked ? 'is-active' : 'is-inactive'}`}>
      <label className="tpl-scope-head">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onCheckedChange(e.target.checked)}
        />
        <span className="tpl-scope-title">
          <span className="tpl-scope-icon">{icon}</span>
          {title}
        </span>
        <span className="tpl-scope-desc">{description}</span>
      </label>
      <div className="tpl-scope-body">{children}</div>
    </div>
  )
}
