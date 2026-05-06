import { useRef, useState } from 'react'
import { Upload, Loader2 } from 'lucide-react'
import { deviceIdFromFileName, parseSensorCsv } from '../lib/csv'
import type { DeviceStore } from '../types'

type Props = {
  devices: DeviceStore
  onDevicesChange: (next: DeviceStore) => void
  variant?: 'primary' | 'secondary' | 'ghost'
  size?: 'md' | 'sm'
  label?: string
  iconOnly?: boolean
  className?: string
}

export function CsvImportButton({
  devices,
  onDevicesChange,
  variant = 'primary',
  size = 'md',
  label = 'CSV をインポート',
  iconOnly = false,
  className,
}: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return
    setBusy(true)
    try {
      const next: DeviceStore = { ...devices }
      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        if (!file.name.toLowerCase().endsWith('.csv')) continue
        const id = deviceIdFromFileName(file.name)
        const text = await file.text()
        try {
          next[id] = parseSensorCsv(text, id)
        } catch (e) {
          alert(`${file.name}: ${e instanceof Error ? e.message : String(e)}`)
        }
      }
      onDevicesChange(next)
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const Icon = busy ? Loader2 : Upload
  const iconClass = busy ? 'spin' : undefined

  return (
    <>
      {iconOnly ? (
        <button
          type="button"
          className={`icon-btn ${className ?? ''}`}
          title={label}
          aria-label={label}
          onClick={() => inputRef.current?.click()}
          disabled={busy}
        >
          <Icon size={14} className={iconClass} />
        </button>
      ) : (
        <button
          type="button"
          className={`btn btn-${variant} btn-${size} ${className ?? ''}`}
          onClick={() => inputRef.current?.click()}
          disabled={busy}
        >
          <Icon size={16} className={iconClass} />
          <span>{busy ? '読み込み中…' : label}</span>
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        multiple
        hidden
        onChange={(e) => void handleFiles(e.target.files)}
      />
    </>
  )
}
