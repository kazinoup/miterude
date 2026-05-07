# ミテルデ — プロジェクト規約（Claude Code 向け）

このファイルは Claude Code が参照する開発規約。ユーザが毎回指定しなくても、ここに書かれた方針に従ってコードを生成する。

## デザインシステム

### カラー
- ブランドの基調色は **ネイビー**（`--navy-700: #14365e`、`--navy-800: #0f2744` など）
  - サイドバーのバックグラウンド、見出し、強調テキスト、強調ボタンなど
- 逸脱・危険は **赤**（`--danger: #c00`）
- 注意は **オレンジ**（`#d97706`）
- 背景・グレースケールは `--gray-50 〜 --gray-700`
- カラートークンはすべて `src/index.css` の `:root` に定義済み

### フォーム要素

#### チェックボックス・ラジオボタン
- **ブラウザ標準のブルーは使わない**
- `src/index.css` で全体に `accent-color: var(--navy-700)` を適用済み
- **個別の `<input>` に `accent-color` を上書き指定しないこと**
- カスタムチェックマーク UI（`<span>` で代替する形）も原則作らず、ブラウザネイティブ + accent-color に統一

#### テキスト入力・セレクト・テキストエリア
- `font-family: inherit` を継承（`src/index.css` で設定済み）
- 既存のクラス（`.form-input`、`.select`）を再利用する。新規ルールを足すときは既存トークン（`--gray-300` など）に合わせる

### ボタン
- プライマリ: `.btn .btn-primary`（ネイビー塗りつぶし）
- セカンダリ: `.btn .btn-secondary`（白背景 + ネイビー枠）
- ゴースト: `.btn .btn-ghost`（透過 + ネイビー文字）
- 危険操作: 必要なら `bulk-danger` 等の修飾クラス

### バッジ・ピル
- オンライン: `.badge-online`（緑系）
- オフライン: `.badge-offline`（赤系）
- 区分・タグなどユーザー定義: `.badge-outline`（白背景 + 細枠）
- ダッシュボードウィジェットでは `.badge-kind` を使用

## アーキテクチャ規約

### 状態管理
- **すべての設定はリアルタイム保存** が原則（`onChange` で即 setState、save ボタンは置かない）
- 複数フィールドを 1 つのトランザクションで保存する必要がある場合のみ「保存」ボタンを使う
- 永続化は `localStorage` 経由（キー: `miterude:state:v3` ほか）。`src/lib/storage.ts` に集約

### センサー閾値（逸脱判定）
- 閾値は **センサーごとに個別** に持つ（`Sensor.thresholds`）
- `ThresholdLevel = { enabled, min?, max? }` で下限・上限は **それぞれ独立に省略可能**
- 危険（alert）と注意（warn）は **独立にチェック ON/OFF** できる
- 「チェック ON だが値未設定」は中間状態として保存する
  - 保存判定は `enabled` だけで OK（`hasUserIntent`）
  - 実際の判定ロジックは `enabled && (min != null || max != null)` で評価する（`isLevelActive`）

### 分類軸の使い分け
- **区分（カテゴリ）**: 1 センサー = 1 区分。ユーザー定義のアイコン付きエンティティ
- **グループ**: 物理配置（フロア、部屋）など 1 階層
- **タグ**: 自由テキスト、複数付与可
- 「区分」は閾値判定からは独立した分類軸（旧 `StorageKind` 自動推定は閾値判定に使わない）

### ファイル構成
- ビュー: `src/components/views/`
- ダッシュボードウィジェット: `src/components/widgets/`
- 共通コンポーネント: `src/components/`
- ロジック: `src/lib/`
- スタイル: `src/styles/`（メイン: `dashboard.css`、レポート: `report.css`）

## 命名・実装規約

### TypeScript
- `any` は使わない（厳格モード）
- 型は `src/types.ts` に集約
- 関数の引数で `Sensor` を直接受け取れる場面では、グローバル設定オブジェクトを渡さない

### コメント
- 日本語のコメントを推奨（既存コードと統一）
- 複雑な分岐や設計上の意図はコメントで残す

### Git
- コミットメッセージは日本語、先頭は `feat:` `fix:` `refactor:` `docs:` `style:` `chore:` のプレフィックス
- Co-Author に Claude を付ける（`Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`）
- 強制プッシュは原則禁止。明示の依頼があれば `--force-with-lease` を使う

## ビルド・デプロイ

- ローカル開発: `npm run dev` (Vite, port 3100)
- ビルド: `npm run build` (`tsc -b && vite build`)
- 本番デプロイ: `main` への `git push` で Vercel が自動デプロイ
- 本番 URL: https://miterude-demo.vercel.app/

## やってはいけないこと（典型的な落とし穴）

- ❌ チェックボックスに独自の青色を当てる（accent-color に任せる）
- ❌ センサー詳細画面で個別に「保存」ボタンを増やす（リアルタイム保存に統一する）
- ❌ 旧 `ReportThresholds`（グローバル閾値）を復活させる
- ❌ `inferStorageKind` の結果を閾値判定に使う（センサー個別の `thresholds` を参照する）
- ❌ ユーザに無断で `git push --force` する
