/**
 * 閾値テンプレートの新規作成 / 編集ダイアログ — Phase 9.15
 *
 * 旧 ThresholdTemplateManageDialog の「フォームのみ」を取り出した版。
 * テンプレート一覧は SettingsView 内に直接展開するため、このダイアログは
 * 単一テンプレートの編集に専念する（1 階層浅い構成）。
 */
import { useEffect, useRef, useState } from 'react'
import { Check, Sliders, X } from 'lucide-react'
import type {
  TempHumidityThresholds,
  ThresholdTemplate,
} from '../types'
import {
  TempHumidityThresholdsEditor,
  emptyTempHumidityThresholds,
} from './ThresholdValuesEditor'
import { createTemplate } from '../lib/thresholdTemplates'

type Props = {
  open: boolean
  /** 編集対象。null なら新規作成 */
  initial: ThresholdTemplate | null
  onClose: () => void
  onSubmit: (t: ThresholdTemplate) => void
}

export function ThresholdTemplateEditDialog({
  open,
  initial,
  onClose,
  onSubmit,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [thresholds, setThresholds] = useState<TempHumidityThresholds>(
    emptyTempHumidityThresholds(),
  )

  // ダイアログが開く度に initial で state をリセット
  useEffect(() => {
    if (!open) return
    setName(initial?.name ?? '')
    setDescription(initial?.description ?? '')
    setThresholds(
      initial && initial.thresholds.kind === 'temperature-humidity'
        ? (initial.thresholds as TempHumidityThresholds)
        : emptyTempHumidityThresholds(),
    )
  }, [open, initial])

  useEffect(() => {
    const dlg = ref.current
    if (!dlg) return
    if (open && !dlg.open) dlg.showModal()
    if (!open && dlg.open) dlg.close()
  }, [open])

  const isEdit = initial !== null
  const valid = name.trim().length > 0

  function handleSave() {
    if (!valid) return
    if (initial) {
      onSubmit({
        ...initial,
        name: name.trim(),
        description: description.trim() || undefined,
        thresholds,
      })
    } else {
      onSubmit(
        createTemplate({
          name: name.trim(),
          description: description.trim() || undefined,
          targetKind: 'temperature-humidity',
          thresholds,
        }),
      )
    }
  }

  return (
    <dialog
      ref={ref}
      className="app-dialog app-dialog-md"
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
            {isEdit ? '閾値テンプレートを編集' : '閾値テンプレートを新規作成'}
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
          <label className="form-row">
            <span className="form-label">テンプレート名</span>
            <input
              type="text"
              className="form-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例: 冷蔵 標準 (HACCP)"
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

          <div className="form-row">
            <span className="form-label">閾値の値</span>
            <div className="template-form-values">
              <TempHumidityThresholdsEditor
                value={thresholds}
                onChange={setThresholds}
              />
            </div>
          </div>
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
