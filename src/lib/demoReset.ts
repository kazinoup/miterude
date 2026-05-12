/**
 * デモ用ローカル状態のクリーンアップ — Phase G (Block I)
 *
 * Supabase 移行後に localStorage に残った旧 demo データを一掃するためのヘルパ。
 * - URL に `?reset=demo` が含まれていれば、起動時に自動でクリア＋リロード
 * - コンソールから `window.miterudeResetDemo()` で手動実行も可能
 *
 * UI 設定（列順 / カラム表示 / ページサイズ）は学習結果として残したいので
 * 既定では保持し、`?reset=demo&deep=1` で完全初期化する。
 */

/** miterude:* 系の localStorage キーのうち、状態（永続化された業務データ）に該当するプレフィクス */
const STATE_PREFIXES = [
  'miterude:tenant:', // tenant state v3/v4/v5/v6
  'miterude:admin:', // admin 側のモックストア
  'miterude:auth:', // セッション
]

/** 加えて deep モードで消す UI 設定系プレフィクス */
const UI_PREFIXES = [
  'miterude:sensors:', // カラム順 / 表示 / ページサイズ
  'miterude:gateways:',
  'miterude:alerts:',
  'miterude:dashboard:', // period-mode 等
]

export function clearDemoLocalStorage(opts: { deep?: boolean } = {}): string[] {
  const removed: string[] = []
  const prefixes = opts.deep ? [...STATE_PREFIXES, ...UI_PREFIXES] : STATE_PREFIXES
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const key = localStorage.key(i)
    if (!key) continue
    if (prefixes.some((p) => key.startsWith(p))) {
      localStorage.removeItem(key)
      removed.push(key)
    }
  }
  return removed
}

/** ページ起動時のフックを実行する。
 *  ?reset=demo が指定されていれば clearDemoLocalStorage を実行し、location.replace で
 *  クエリを取り除いて再読込する。`window.miterudeResetDemo()` も登録する。 */
export function installDemoResetHook(): void {
  if (typeof window === 'undefined') return

  // 手動実行用のグローバル関数
  const globalWindow = window as Window & {
    miterudeResetDemo?: (opts?: { deep?: boolean }) => void
  }
  globalWindow.miterudeResetDemo = (opts: { deep?: boolean } = {}) => {
    const removed = clearDemoLocalStorage(opts)
    console.info('[demo-reset] cleared', removed)
    window.location.reload()
  }

  // URL クエリ経由の自動実行
  const url = new URL(window.location.href)
  const flag = url.searchParams.get('reset')
  if (flag === 'demo') {
    const deep = url.searchParams.get('deep') === '1'
    const removed = clearDemoLocalStorage({ deep })
    console.info('[demo-reset] cleared from URL', removed)
    // クエリを除去してから replace（リロード相当）
    url.searchParams.delete('reset')
    url.searchParams.delete('deep')
    window.location.replace(url.toString())
  }
}
