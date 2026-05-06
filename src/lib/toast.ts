/**
 * 軽量トースト通知ストア — Phase 3
 *
 * 依存ゼロの pub-sub。`toast(message)` を呼ぶとどこからでも通知できる。
 * 描画は <ToastContainer /> が useSyncExternalStore 経由で購読する。
 */

export type ToastKind = 'info' | 'success' | 'error'
export type ToastItem = {
  id: number
  message: string
  kind: ToastKind
}

let nextId = 1
let items: ToastItem[] = []
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

export function toast(message: string, kind: ToastKind = 'info', durationMs = 3500): number {
  const id = nextId++
  items = [...items, { id, message, kind }]
  emit()
  if (durationMs > 0) {
    setTimeout(() => dismissToast(id), durationMs)
  }
  return id
}

export function dismissToast(id: number) {
  const next = items.filter((i) => i.id !== id)
  if (next.length !== items.length) {
    items = next
    emit()
  }
}

export function getToasts(): ToastItem[] {
  return items
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
