/**
 * グローバル ErrorBoundary — Phase 9.14
 *
 * いずれかの子ツリーで render 中に例外が起きても、画面が完全に真っ白に
 * なるのを防ぎ、復旧手段（リロード／状態クリア）を提示する。
 *
 * 開発時は console にスタックトレースを出して、本番でも詳細メッセージを
 * 折りたたみで開けるようにしておく（モックアプリのため、過度に隠さない）。
 */
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, RotateCcw, Trash2 } from 'lucide-react'

type Props = { children: ReactNode }
type State = { error: Error | null; info: ErrorInfo | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary] Render exception:', error, info)
    this.setState({ info })
  }

  reload = () => {
    window.location.reload()
  }

  clearAndReload = () => {
    if (
      !confirm(
        'localStorage に保存された全データを削除して再読み込みします。よろしいですか？',
      )
    ) {
      return
    }
    try {
      localStorage.clear()
    } catch {
      /* noop */
    }
    window.location.reload()
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children

    return (
      <div className="error-boundary">
        <div className="error-boundary-card">
          <div className="error-boundary-icon">
            <AlertTriangle size={32} />
          </div>
          <h1>画面の描画でエラーが発生しました</h1>
          <p>
            想定外のデータ形式や状態が原因の可能性があります。
            まずは再読み込みをお試しください。改善しない場合は、
            「データをクリアして再読み込み」で初期状態に戻せます。
          </p>

          <div className="error-boundary-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={this.reload}
            >
              <RotateCcw size={14} />
              <span>再読み込み</span>
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={this.clearAndReload}
            >
              <Trash2 size={14} />
              <span>データをクリアして再読み込み</span>
            </button>
          </div>

          <details className="error-boundary-details">
            <summary>エラーの詳細（開発者向け）</summary>
            <pre className="error-boundary-pre">{this.state.error.toString()}</pre>
            {this.state.info?.componentStack && (
              <pre className="error-boundary-pre">
                {this.state.info.componentStack}
              </pre>
            )}
          </details>
        </div>
      </div>
    )
  }
}
