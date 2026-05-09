/**
 * Admin: テナント詳細 > ゲートウェイタブ > kebab > 「1 件追加」フォーム。
 */
import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { logStaffAction } from '../lib/adminStorage'
import {
  commitGatewayDrafts,
  validateGatewayDrafts,
  type GatewayDraft,
} from '../lib/sensorRegistration'
import { toast } from '../../lib/toast'
import type { Organization } from '../../types'

type Props = {
  org: Organization
  adminUserId: string
  onClose: () => void
  onCreated: () => void
}

export function CreateGatewayDialog({ org, adminUserId, onClose, onCreated }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dlg = ref.current
    if (!dlg) return
    if (!dlg.open) dlg.showModal()
    // StrictMode 対策: cleanup で close() しない
  }, [])

  const [id, setId] = useState('')
  const [serialNumber, setSerialNumber] = useState('')
  const [devEUI, setDevEUI] = useState('')
  const [name, setName] = useState('')
  const [model, setModel] = useState('UG65')
  const [manufacturer, setManufacturer] = useState('Milesight')
  const [location, setLocation] = useState('')
  const [errors, setErrors] = useState<string[]>([])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const draft: GatewayDraft = {
      id: id.trim(),
      serialNumber: serialNumber.trim(),
      devEUI: devEUI.trim().toUpperCase(),
      name: name.trim(),
      model: model.trim(),
      manufacturer: manufacturer.trim(),
      location: location.trim(),
    }
    const issues = validateGatewayDrafts([draft], org.id)
    if (issues.length > 0) {
      setErrors(issues.map((i) => i.message))
      return
    }
    commitGatewayDrafts([draft], org.id)
    logStaffAction({
      staffUserId: adminUserId,
      organizationId: org.id,
      action: 'gateway_added_by_admin',
      targetTable: 'gateways',
      targetId: draft.id,
      metadata: { serialNumber: draft.serialNumber, devEUI: draft.devEUI },
    })
    toast(`ゲートウェイ「${draft.name}」を追加しました`, 'success')
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
          <h2>ゲートウェイを 1 件追加</h2>
          <button type="button" className="icon-btn" aria-label="閉じる" onClick={onClose}>
            <X size={16} />
          </button>
        </header>

        <div className="app-dialog-body">
          <div className="form-grid-2">
            <div className="form-row">
              <label className="form-label" htmlFor="gw-id">ID</label>
              <input id="gw-id" className="form-input mono" value={id} onChange={(e) => setId(e.target.value)} placeholder="GW01 / UG-65-1" autoFocus />
            </div>
            <div className="form-row">
              <label className="form-label" htmlFor="gw-name">名前</label>
              <input id="gw-name" className="form-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="本社ゲートウェイ" />
            </div>
            <div className="form-row">
              <label className="form-label" htmlFor="gw-sn">シリアル番号</label>
              <input id="gw-sn" className="form-input mono" value={serialNumber} onChange={(e) => setSerialNumber(e.target.value)} placeholder="6221D1576324" />
            </div>
            <div className="form-row">
              <label className="form-label" htmlFor="gw-eui">DevEUI</label>
              <input id="gw-eui" className="form-input mono" value={devEUI} onChange={(e) => setDevEUI(e.target.value.toUpperCase())} placeholder="24E124FFFEF72F86" />
            </div>
            <div className="form-row">
              <label className="form-label" htmlFor="gw-model">モデル</label>
              <input id="gw-model" className="form-input" value={model} onChange={(e) => setModel(e.target.value)} placeholder="UG65 / UG63" />
            </div>
            <div className="form-row">
              <label className="form-label" htmlFor="gw-mfr">メーカー</label>
              <input id="gw-mfr" className="form-input" value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} />
            </div>
            <div className="form-row form-row-wide">
              <label className="form-label" htmlFor="gw-loc">設置場所</label>
              <input id="gw-loc" className="form-input" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="1F 受付 / 厨房など" />
            </div>
          </div>

          {errors.length > 0 && (
            <div className="form-error-block">
              <strong>追加できません:</strong>
              <ul>
                {errors.map((m, i) => (<li key={i}>{m}</li>))}
              </ul>
            </div>
          )}
        </div>

        <footer className="app-dialog-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>キャンセル</button>
          <button type="submit" className="btn btn-primary">追加</button>
        </footer>
      </form>
    </dialog>
  )
}
