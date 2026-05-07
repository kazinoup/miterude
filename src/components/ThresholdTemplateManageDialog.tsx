/**
 * 閾値テンプレートの管理ダイアログ — Phase 9.14
 *
 * - 一覧表示: テンプレ名・対象種別・説明・編集／削除ボタン
 * - 新規作成: 名前 + 値（TempHumidityThresholdsEditor）の入力フォーム
 * - 編集: 既存テンプレを書き換え（リアルタイム保存）
 *
 * テンプレ自体は自由に編集できるが、適用済みのセンサー側へは伝搬しない
 * （スナップショット方式）。
 */
import { useEffect, useRef, useState } from 'react'
import {
  Check,
  ChevronRight,
  FileText,
  Pencil,
  Plus,
  Sliders,
  Trash2,
  X,
} from 'lucide-react'
import type {
  TempHumidityThresholds,
  ThresholdTemplate,
  ThresholdTemplateStore,
} from '../types'
import {
  TempHumidityThresholdsEditor,
  emptyTempHumidityThresholds,
} from './ThresholdValuesEditor'
import { createTemplate } from '../lib/thresholdTemplates'

type Props = {
  open: boolean
  templates: ThresholdTemplateStore
  onClose: () => void
  onUpsert: (t: ThresholdTemplate) => void
  onDelete: (id: string) => void
}

type Mode =
  | { kind: 'list' }
  | { kind: 'edit'; templateId: string }
  | { kind: 'create' }

export function ThresholdTemplateManageDialog({
  open,
  templates,
  onClose,
  onUpsert,
  onDelete,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const [mode, setMode] = useState<Mode>({ kind: 'list' })

  useEffect(() => {
    if (!open) setMode({ kind: 'list' })
  }, [open])

  useEffect(() => {
    const dlg = ref.current
    if (!dlg) return
    if (open && !dlg.open) dlg.showModal()
    if (!open && dlg.open) dlg.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      className="app-dialog"
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
            閾値テンプレート
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
          {mode.kind === 'list' && (
            <TemplateListView
              templates={templates}
              onCreate={() => setMode({ kind: 'create' })}
              onEdit={(id) => setMode({ kind: 'edit', templateId: id })}
              onDelete={onDelete}
            />
          )}

          {mode.kind === 'create' && (
            <TemplateForm
              initial={null}
              onCancel={() => setMode({ kind: 'list' })}
              onSubmit={(t) => {
                onUpsert(t)
                setMode({ kind: 'list' })
              }}
            />
          )}

          {mode.kind === 'edit' && templates[mode.templateId] && (
            <TemplateForm
              initial={templates[mode.templateId]}
              onCancel={() => setMode({ kind: 'list' })}
              onSubmit={(t) => {
                onUpsert(t)
                setMode({ kind: 'list' })
              }}
            />
          )}
        </div>

        <footer className="app-dialog-foot">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            閉じる
          </button>
        </footer>
      </div>
    </dialog>
  )
}

/* ---------- List view ---------- */
function TemplateListView({
  templates,
  onCreate,
  onEdit,
  onDelete,
}: {
  templates: ThresholdTemplateStore
  onCreate: () => void
  onEdit: (id: string) => void
  onDelete: (id: string) => void
}) {
  const list = Object.values(templates).sort((a, b) =>
    a.name.localeCompare(b.name),
  )

  return (
    <>
      <p className="muted in-panel">
        よく使う閾値の組み合わせを保存しておくと、各センサーや一括選択で
        まとめて適用できます。テンプレートを編集しても、すでに適用済みの
        センサー側の値は変わりません（スナップショット方式）。
      </p>

      <div className="template-list-toolbar">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={onCreate}
        >
          <Plus size={14} />
          <span>新しいテンプレートを作成</span>
        </button>
      </div>

      {list.length === 0 ? (
        <p className="muted in-panel">テンプレートがまだありません。</p>
      ) : (
        <ul className="template-list">
          {list.map((t) => (
            <li key={t.id} className="template-list-item">
              <div className="template-list-main">
                <button
                  type="button"
                  className="template-list-name-btn"
                  onClick={() => onEdit(t.id)}
                  title="編集"
                >
                  <FileText size={13} />
                  <strong className="template-list-name">{t.name}</strong>
                  <ChevronRight size={13} className="muted" />
                </button>
                {t.description && (
                  <span className="template-list-desc muted">
                    {t.description}
                  </span>
                )}
                <span className="template-list-summary">
                  {summarizeTemplate(t)}
                </span>
              </div>
              <div className="template-list-actions">
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="編集"
                  onClick={() => onEdit(t.id)}
                >
                  <Pencil size={14} />
                </button>
                <button
                  type="button"
                  className="icon-btn icon-btn-danger"
                  aria-label="削除"
                  onClick={() => {
                    if (confirm(`テンプレート「${t.name}」を削除しますか？`)) {
                      onDelete(t.id)
                    }
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

/** テンプレ内容のかんたんなサマリ表示 */
function summarizeTemplate(t: ThresholdTemplate): string {
  if (t.thresholds.kind === 'temperature-humidity') {
    const parts: string[] = []
    const tt = t.thresholds.temperature
    const hh = t.thresholds.humidity
    if (tt.alert.enabled || tt.warn.enabled) {
      const a = tt.alert
      if (a.enabled && (a.min != null || a.max != null)) {
        parts.push(formatLevel('温度', a.min, a.max, '℃'))
      }
    }
    if (hh.alert.enabled || hh.warn.enabled) {
      const a = hh.alert
      if (a.enabled && (a.min != null || a.max != null)) {
        parts.push(formatLevel('湿度', a.min, a.max, '%'))
      }
    }
    return parts.length > 0 ? parts.join(' / ') : '判定対象なし'
  }
  return '—'
}

function formatLevel(
  label: string,
  min: number | undefined,
  max: number | undefined,
  unit: string,
): string {
  if (min != null && max != null) return `${label} ${min}〜${max}${unit}`
  if (min != null) return `${label} ${min}${unit}以上`
  if (max != null) return `${label} ${max}${unit}以下`
  return label
}

/* ---------- Form (create / edit) ---------- */
function TemplateForm({
  initial,
  onCancel,
  onSubmit,
}: {
  initial: ThresholdTemplate | null
  onCancel: () => void
  onSubmit: (t: ThresholdTemplate) => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [thresholds, setThresholds] = useState<TempHumidityThresholds>(
    initial && initial.thresholds.kind === 'temperature-humidity'
      ? (initial.thresholds as TempHumidityThresholds)
      : emptyTempHumidityThresholds(),
  )

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
    <div className="template-form">
      <div className="template-form-head">
        <button
          type="button"
          className="link-btn template-form-back"
          onClick={onCancel}
        >
          ← テンプレート一覧へ戻る
        </button>
      </div>

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
        <span className="muted">温湿度センサー（Phase 9.14 では本種別のみ対応）</span>
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

      <div className="template-form-foot">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>
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
      </div>
    </div>
  )
}
