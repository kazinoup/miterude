# ミテルデ ドキュメント

> このディレクトリには、ミテルデの設計方針・実装計画を文章で残しています。
> Cursor などで開発を再開するときは、まずここから読んでください。

## ドキュメント一覧

### 📋 [現状仕様メモ（current-state.md）](./current-state.md)
Phase 1〜9 までで実装済みの機能・ファイル構成・型定義の一覧。
**「いまどこまで作ってあるか」を把握する**ためのリファレンスです。

### 🚀 [Milesight 連携 実装計画（milesight-integration-plan.md）](./milesight-integration-plan.md)
Phase 10 以降の実装計画書。
- 全体アーキテクチャ（Supabase + Vercel）
- データベーススキーマ（DDL 込み）
- Webhook エンドポイント仕様
- マルチテナント運用フロー
- アラート2軸設計
- Phase 10〜15 の段階別実装ステップ
- テスト戦略・残課題

実装に着手する前に、本ドキュメントの「**12. 残課題・次の決定事項**」の選択を確定させてください。

---

## 開発再開時のクイックスタート

```bash
# 1. 依存インストール
npm install

# 2. 開発サーバー起動
npm run dev
# → http://localhost:3100/

# 3. ビルド確認
npm run build
```

## アプリ概要

- 温湿度モニタリング SaaS（マルチテナント想定）
- 現状: フロントのみ（React + Vite + localStorage）
- 次フェーズ: Supabase + Vercel + Milesight Webhook 連携で本格バックエンド化
