/**
 * Admin: テナント詳細 > センサータブ > kebab > 「1 件追加」から開く単発フォーム。
 *
 * 設計（2026-05-09 改訂）:
 *  - メーカー・モデルは **対応マスタからの選択式**（自由入力廃止）
 *    対応中（supported=true, category='sensor'）に限定
 *  - メーカー先 → そのメーカーのモデル選択（cascade）
 *  - 種別 (kind) は選択モデルから自動決定（手で触れない）
 *  - シリアル番号 / DevEUI も入力欄として持つが、未登録 DevEUI 行から
 *    開いたとき（preset あり）は **DevEUI / sn / model / manufacturer / kind を全て固定**
 *  - ゲートウェイ項目は廃止（Milesight MDP に対応する設定が無いため）
 *
 * ユーザが触れる項目（preset の有無に関わらず編集可）:
 *  - ID（デバイス番号）
 *  - 表示名
 *  - テンプレート（任意）
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import {
  loadState,
  saveState,
  sensorsFromState,
  withSensors,
} from '../../lib/storage'
import { logStaffAction } from '../lib/adminStorage'
import {
  commitSensorDrafts,
  validateSensorDrafts,
  type SensorDraft,
} from '../lib/sensorRegistration'
import {
  processInbox,
  reprocessForDevEUI,
} from '../lib/webhookInbox'
import {
  applyTemplateToSensor,
  describeScope,
  isTemplateApplicableToKind,
} from '../../lib/thresholdTemplates'
import {
  inferSensorKindFromModel,
  supportedManufacturers,
  supportedSensorModelsByManufacturer,
} from '../../lib/supportedDevices'
import { toast } from '../../lib/toast'
import type { Organization, SensorKind } from '../../types'

/** 未登録 DevEUI 行から開いたときに固定する一式。
 *  Webhook 受信時の deviceProfile から拾った値で、ユーザは触らない。 */
export type CreateSensorPreset = {
  devEUI: string
  serialNumber?: string
  model?: string
  manufacturer?: string
}

type Props = {
  org: Organization
  adminUserId: string
  onClose: () => void
  onCreated: () => void
  /** 未登録 DevEUI 行から開いたときの固定値セット。指定された場合は
   *  メーカー / モデル / sn / DevEUI / 種別 すべて読み取り専用になる。 */
  preset?: CreateSensorPreset
}

/** メーカー名（"Milesight" 等）→ MANUFACTURERS の key を逆引き。
 *  preset.manufacturer は表示名で来るので、選択 UI は内部 key を扱うため変換。 */
function manufacturerKeyByName(name: string | undefined): string | undefined {
  if (!name) return undefined
  return supportedManufacturers().find(
    (m) => m.name.toLowerCase() === name.toLowerCase(),
  )?.key
}

export function CreateSensorDialog({
  org,
  adminUserId,
  onClose,
  onCreated,
  preset,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dlg = ref.current
    if (!dlg) return
    if (!dlg.open) dlg.showModal()
    // 注意: React StrictMode の double-mount でクリーンアップから dlg.close() を
    // 呼ぶと dialog の close イベントが発火し、親の onClose が誤って呼ばれて
    // 即座にダイアログが消える。ここでは close() を呼ばず、コンポーネント
    // unmount に任せる（DOM から取り除かれる）。
  }, [])

  const tenantState = loadState(org.id)
  const templates = Object.values(tenantState?.thresholdTemplates ?? {})

  const lockedFromPreset = !!preset

  // メーカー / モデルの選択肢（対応中のみ、センサーのみ）
  const manufacturers = useMemo(() => supportedManufacturers(), [])
  const initialMfrKey =
    manufacturerKeyByName(preset?.manufacturer) ?? manufacturers[0]?.key ?? ''
  const [manufacturerKey, setManufacturerKey] = useState<string>(initialMfrKey)
  const modelOptions = useMemo(
    () => supportedSensorModelsByManufacturer(manufacturerKey),
    [manufacturerKey],
  )
  const initialModel = preset?.model ?? modelOptions[0]?.model ?? ''
  const [model, setModel] = useState<string>(initialModel)

  // 編集可能項目: ID / 表示名 / テンプレート
  const [id, setId] = useState('')
  const [name, setName] = useState('')
  const [templateId, setTemplateId] = useState<string>('')

  // 固定（preset から or マスタから自動決定）項目
  const [serialNumber, setSerialNumber] = useState(preset?.serialNumber ?? '')
  const [devEUI, setDevEUI] = useState((preset?.devEUI ?? '').toUpperCase())
  const manufacturerName = useMemo(
    () => manufacturers.find((m) => m.key === manufacturerKey)?.name ?? '',
    [manufacturers, manufacturerKey],
  )
  const kind: SensorKind = useMemo(
    () => inferSensorKindFromModel(model),
    [model],
  )

  // メーカー切り替え時はそのメーカーの先頭モデルに戻す（preset がない場合のみ）
  useEffect(() => {
    if (lockedFromPreset) return
    if (modelOptions.length === 0) {
      setModel('')
      return
    }
    if (!modelOptions.some((m) => m.model === model)) {
      setModel(modelOptions[0].model)
    }
  }, [manufacturerKey, modelOptions, model, lockedFromPreset])

  // 種別が変わったら、互換性のないテンプレ選択は外す
  useEffect(() => {
    if (!templateId) return
    const t = templates.find((x) => x.id === templateId)
    if (!t || !isTemplateApplicableToKind(t, kind)) setTemplateId('')
  }, [kind, templateId, templates])

  const applicableTemplates = templates.filter((t) =>
    isTemplateApplicableToKind(t, kind),
  )
  const selectedTemplate = templates.find((t) => t.id === templateId)
  const [errors, setErrors] = useState<string[]>([])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const draft: SensorDraft = {
      id: id.trim(),
      deviceNumber: id.trim(),
      serialNumber: serialNumber.trim(),
      devEUI: devEUI.trim().toUpperCase(),
      name: name.trim(),
      model: model.trim(),
      manufacturer: manufacturerName,
      // ゲートウェイ紐付けは廃止（MDP に対応設定がない）。常に空。
      gatewayId: '',
      kind,
    }
    const issues = validateSensorDrafts([draft], org.id)
    if (issues.length > 0) {
      setErrors(issues.map((i) => i.message))
      return
    }
    commitSensorDrafts([draft], org.id)
    // テンプレートが選ばれていれば、commit 直後に適用する。
    if (selectedTemplate) {
      const after = loadState(org.id)
      if (after) {
        const sensors = sensorsFromState(after)
        const created = sensors[draft.id]
        if (created) {
          const updated = applyTemplateToSensor(created, selectedTemplate)
          saveState(
            withSensors(after, { ...sensors, [draft.id]: updated }),
            org.id,
          )
        }
      }
    }
    logStaffAction({
      staffUserId: adminUserId,
      organizationId: org.id,
      action: 'sensor_added_by_admin',
      targetTable: 'sensors',
      targetId: draft.id,
      metadata: {
        deviceNumber: draft.deviceNumber,
        serialNumber: draft.serialNumber,
        devEUI: draft.devEUI,
        viaUnmatched: lockedFromPreset,
        appliedTemplate: selectedTemplate
          ? { id: selectedTemplate.id, name: selectedTemplate.name }
          : undefined,
      },
    })
    // 同 DevEUI の unmatched を pending に戻して即時仕分け（遡及反映）
    if (draft.devEUI) {
      const { reverted } = reprocessForDevEUI(org.id, draft.devEUI)
      if (reverted > 0) {
        const r = processInbox()
        toast(
          `センサー「${draft.name}」を追加しました（過去の ${reverted} 件を遡及反映: 仕分け ${r.processed} 件）`,
          'success',
        )
      } else {
        toast(`センサー「${draft.name}」を追加しました`, 'success')
      }
    } else {
      toast(`センサー「${draft.name}」を追加しました`, 'success')
    }
    onCreated()
  }

  return (
    <dialog
      ref={ref}
      className="app-dialog"
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
    >
      <form className="app-dialog-form" onSubmit={handleSubmit}>
        <header className="app-dialog-head">
          <h2>センサーを 1 件追加</h2>
          <button type="button" className="icon-btn" aria-label="閉じる" onClick={onClose}>
            <X size={16} />
          </button>
        </header>

        <div className="app-dialog-body">
          <div className="form-grid-2">
            {/* ----- 編集可能: ID / 表示名 ----- */}
            <div className="form-row">
              <label className="form-label" htmlFor="sensor-id">
                ID / デバイス番号
              </label>
              <input
                id="sensor-id"
                className="form-input mono"
                value={id}
                onChange={(e) => setId(e.target.value)}
                placeholder="CK01 / CBO-039"
                autoFocus
                required
              />
            </div>
            <div className="form-row">
              <label className="form-label" htmlFor="sensor-name">
                表示名
              </label>
              <input
                id="sensor-name"
                className="form-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="3F 製品冷凍庫1"
                required
              />
            </div>

            {/* ----- メーカー / モデル: cascade 選択（preset あれば固定表示） ----- */}
            <div className="form-row">
              <label className="form-label" htmlFor="sensor-mfr">
                メーカー
              </label>
              {lockedFromPreset ? (
                <div className="form-input form-input-static">
                  {manufacturerName || '—'}
                </div>
              ) : (
                <select
                  id="sensor-mfr"
                  className="select"
                  value={manufacturerKey}
                  onChange={(e) => setManufacturerKey(e.target.value)}
                >
                  {manufacturers.map((m) => (
                    <option key={m.key} value={m.key}>
                      {m.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div className="form-row">
              <label className="form-label" htmlFor="sensor-model">
                モデル
              </label>
              {lockedFromPreset ? (
                <div className="form-input form-input-static mono">
                  {model || '—'}
                </div>
              ) : (
                <select
                  id="sensor-model"
                  className="select"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  disabled={modelOptions.length === 0}
                >
                  {modelOptions.length === 0 && (
                    <option value="">対応中のモデルがありません</option>
                  )}
                  {modelOptions.map((m) => (
                    <option key={m.id} value={m.model}>
                      {m.model}
                      {m.typeLabel ? `（${m.typeLabel}）` : ''}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* ----- シリアル番号 / DevEUI: preset があれば固定 ----- */}
            <div className="form-row">
              <label className="form-label" htmlFor="sensor-sn">
                シリアル番号 (Milesight sn)
              </label>
              {lockedFromPreset ? (
                <div className="form-input form-input-static mono">
                  {serialNumber || '—'}
                </div>
              ) : (
                <input
                  id="sensor-sn"
                  className="form-input mono"
                  value={serialNumber}
                  onChange={(e) => setSerialNumber(e.target.value)}
                  placeholder="6785D19065740023"
                  required
                />
              )}
            </div>
            <div className="form-row">
              <label className="form-label" htmlFor="sensor-eui">
                DevEUI
              </label>
              {lockedFromPreset ? (
                <div className="form-input form-input-static mono">
                  {devEUI || '—'}
                </div>
              ) : (
                <input
                  id="sensor-eui"
                  className="form-input mono"
                  value={devEUI}
                  onChange={(e) => setDevEUI(e.target.value.toUpperCase())}
                  placeholder="24E124785D190657"
                  required
                />
              )}
              <p className="form-help">
                {lockedFromPreset
                  ? 'Webhook で観測された未登録デバイスの情報です。固定値で取り込みます。'
                  : 'Webhook 受信時のセンサー照合キー。16 字 HEX。'}
              </p>
            </div>

            {/* ----- 種別: モデルから自動決定（常に固定表示） ----- */}
            <div className="form-row">
              <label className="form-label">種別</label>
              <div className="form-input form-input-static">
                {kindLabel(kind)}
              </div>
              <p className="form-help">
                モデルから自動で決まります。
              </p>
            </div>

            {/* ----- テンプレート: 編集可能 ----- */}
            <div className="form-row form-row-wide">
              <label className="form-label" htmlFor="sensor-template">
                テンプレート（任意）
              </label>
              <select
                id="sensor-template"
                className="select"
                value={templateId}
                onChange={(e) => setTemplateId(e.target.value)}
                disabled={applicableTemplates.length === 0}
              >
                <option value="">— 適用しない（後でセンサー詳細から設定）—</option>
                {applicableTemplates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {t.description ? `（${t.description}）` : ''}
                  </option>
                ))}
              </select>
              {selectedTemplate && (
                <p className="form-help">
                  <strong>適用対象:</strong> {describeScope(selectedTemplate.scope)}
                  （これ以外は既定値で作成し、必要に応じて後から調整できます）
                </p>
              )}
              {applicableTemplates.length === 0 && (
                <p className="form-help">
                  この種別に適用できるテンプレートはありません。
                  「設定 → センサー設定テンプレート」で作成できます。
                </p>
              )}
            </div>
          </div>

          {errors.length > 0 && (
            <div className="form-error-block">
              <strong>追加できません:</strong>
              <ul>
                {errors.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <footer className="app-dialog-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            キャンセル
          </button>
          <button type="submit" className="btn btn-primary">
            追加
          </button>
        </footer>
      </form>
    </dialog>
  )
}

function kindLabel(k: SensorKind): string {
  switch (k) {
    case 'temperature-humidity':
      return '温湿度'
    case 'analog-meter':
      return 'アナログメーター'
    case 'door':
      return '扉開閉'
    case 'water-level':
      return '水位'
    case 'current':
      return '電流'
    default:
      return k
  }
}
