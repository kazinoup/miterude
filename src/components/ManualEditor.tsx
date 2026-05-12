/**
 * BlockNote をラップした共通エディタ。
 *
 * - mode='edit': リッチエディタとして表示。content の差分が出るたびに onChange を呼ぶ。
 * - mode='view': 閲覧専用（テナント側で使用）。
 *
 * 段組（カラム）は BlockNote の公式拡張 `@blocknote/xl-multi-column` を入れれば
 * 対応可能だが、現状その拡張は GPL-3.0 / 商用ライセンスのため非採用。
 * 代替として「画像ブロック + 整列」「テーブルブロック」で 2 カラム相当の表現が可能。
 */
import { useCreateBlockNote } from '@blocknote/react'
import { BlockNoteView } from '@blocknote/mantine'
import type { Block } from '@blocknote/core'
import { useEffect, useMemo, useRef } from 'react'
import { isSupabaseConfigured } from '../lib/supabase'
import { uploadManualImage } from '../lib/supabaseQueries'
import '@blocknote/core/fonts/inter.css'
import '@blocknote/mantine/style.css'

type Props = {
  /** 初期 content（BlockNote の Block[] を JSON 化したもの）。null の場合は空のドキュメント */
  initialContent: unknown
  mode: 'edit' | 'view'
  /** edit モード時の変更通知（document を JSON で渡す） */
  onChange?: (next: Block[]) => void
}

export function ManualEditor({ initialContent, mode, onChange }: Props) {
  // BlockNote の document は内部で string id を持つので、 unknown → Block[] へ無理キャスト
  const blocks = useMemo(() => {
    if (!initialContent) return undefined
    if (Array.isArray(initialContent) && initialContent.length > 0) {
      return initialContent as Block[]
    }
    return undefined
  }, [initialContent])

  const editor = useCreateBlockNote({
    initialContent: blocks,
    // 画像挿入時に Supabase Storage (manual-images) へアップロードし、その public URL を返す。
    // Supabase 未設定時は BlockNote の既定挙動（dataURL 埋め込み）にフォールバック。
    uploadFile: isSupabaseConfigured()
      ? async (file: File) => {
          return await uploadManualImage(file)
        }
      : undefined,
  })

  // BlockNote の onChange はインスタンスメソッドで購読する形なので useEffect で配線
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])
  useEffect(() => {
    if (mode !== 'edit') return
    const handler = () => {
      onChangeRef.current?.(editor.document)
    }
    const cleanup = editor.onChange(handler)
    return () => {
      cleanup?.()
    }
  }, [editor, mode])

  return (
    <div className={`manual-editor manual-editor-${mode}`}>
      <BlockNoteView
        editor={editor}
        editable={mode === 'edit'}
        theme="light"
      />
    </div>
  )
}
