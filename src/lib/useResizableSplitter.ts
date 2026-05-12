/**
 * 2 カラムレイアウトの「左カラム幅」をドラッグでリサイズするフック。
 *
 * 戻り値:
 *  - leftWidth: number — 現在の左カラム px 幅
 *  - startDrag: MouseEventHandler — リサイザのつまみに付ける mousedown ハンドラ
 *  - dragging: boolean — ドラッグ中フラグ（カーソル変更や iframe overlay に使う）
 *
 * 幅は localStorage に永続化（key を変えれば画面ごとに別保存）。
 */
import { useCallback, useEffect, useRef, useState } from 'react'

export function useResizableSplitter(opts: {
  storageKey: string
  defaultWidth: number
  minWidth?: number
  maxWidth?: number
}): {
  leftWidth: number
  startDrag: (e: React.MouseEvent) => void
  dragging: boolean
} {
  const { storageKey, defaultWidth, minWidth = 160, maxWidth = 640 } = opts

  const [leftWidth, setLeftWidth] = useState<number>(() => {
    if (typeof window === 'undefined') return defaultWidth
    const raw = window.localStorage.getItem(storageKey)
    const n = raw ? Number(raw) : NaN
    if (Number.isFinite(n) && n >= minWidth && n <= maxWidth) return n
    return defaultWidth
  })
  const [dragging, setDragging] = useState(false)

  // ドラッグ中は最新値を ref に保持し、mouseup でまとめて localStorage に書く
  const widthRef = useRef(leftWidth)
  useEffect(() => {
    widthRef.current = leftWidth
  }, [leftWidth])

  const startDrag = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      setDragging(true)
      const startX = e.clientX
      const startWidth = widthRef.current

      function onMove(ev: MouseEvent) {
        const delta = ev.clientX - startX
        const next = Math.min(maxWidth, Math.max(minWidth, startWidth + delta))
        setLeftWidth(next)
      }
      function onUp() {
        setDragging(false)
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        try {
          window.localStorage.setItem(storageKey, String(widthRef.current))
        } catch {
          /* noop */
        }
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [storageKey, minWidth, maxWidth],
  )

  return { leftWidth, startDrag, dragging }
}
