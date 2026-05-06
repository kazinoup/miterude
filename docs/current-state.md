# ミテルデ 現状仕様メモ（Phase 9 完了時点）

> **対象**: 実装着手時に「いまどこまで作ってあるか」を即座に把握するための一覧
> **最終更新**: 2026-05-05

---

## アプリの位置付け

- 温湿度モニタリング SaaS の**フロントエンドモック**
- React 19 + Vite 8 + recharts 3 + lucide-react
- データは localStorage に保存（永続化）。バックエンドは無し
- マルチテナント・Clerk認証は UI のみのモック

→ Phase 10 で本格的なバックエンド（Supabase + Vercel）に移行予定。詳細は [milesight-integration-plan.md](./milesight-integration-plan.md) 参照。

---

## 実装済みフェーズ一覧

| Phase | 内容 | 主要ファイル |
|---|---|---|
| **Phase 1** | サイドバー型レイアウト・ブラッシュアップ・配色統一（ネイビー＋白＋黒＋赤） | App.tsx, Sidebar.tsx, dashboard.css |
| **Phase 2** | センサー＋ゲートウェイのモックデータ層、localStorage 永続化、CSV インポート | lib/mock.ts, lib/storage.ts, components/views/SensorsView.tsx, GatewaysView.tsx |
| **Phase 3** | センサー一括操作・アラート設定・履歴ビューア（日/週/月＋一覧/グラフ） | components/SensorAlertSettings.tsx, components/views/SensorDetailView.tsx |
| **Phase 4** | ゲートウェイ管理（Phase 2 で機能完備） | components/views/GatewaysView.tsx |
| **Phase 5** | 複数ダッシュボード＋タイル/折れ線/マップウィジェット | components/views/DashboardView.tsx, components/widgets/* |
| **Phase 6** | 週報の追加（月報と並列） | components/WeeklySummaryReport.tsx, WeeklyTableReport.tsx |
| **Phase 7** | Clerk モック・センサー種別拡張・デバイス連携設定・通知グループ | components/UserMenu.tsx, components/views/SettingsView.tsx, lib/notify.ts |
| **Phase 8** | 確認チェックイン・運用メモ・記録履歴・承認ワークフロー | components/DashboardConfirmDialog.tsx, components/SensorNoteDialog.tsx, components/views/RecordsView.tsx, lib/records.ts |
| **Phase 9** | ダッシュボードのテンプレート化（対象センサー＋既定期間の単一設定）、逸脱ピックアップウィジェット、期間モード切替 | components/widgets/DeviationWidget.tsx, lib/report.ts (extractDeviationSegments) |

---

## ディレクトリ構成

```
src/
├── App.tsx                          ─ ルート。ビュー切替・全 state 管理
├── App.css                          ─ 印刷時の調整のみ
├── index.css                        ─ デザイントークン (CSS variables)
├── main.tsx                         ─ エントリ
├── types.ts                         ─ 全型定義
│
├── lib/
│   ├── csv.ts                       ─ CSV パース
│   ├── jp.ts                        ─ 日本語フォーマッタ・経過時間
│   ├── mock.ts                      ─ センサー/ゲートウェイのモックメタ生成
│   ├── period.ts                    ─ 期間（日/週/月）操作
│   ├── records.ts                   ─ 確認チェックイン・運用メモのファクトリ
│   ├── report.ts                    ─ レポート集計・逸脱判定・セグメント抽出
│   ├── storage.ts                   ─ localStorage 永続化（v3）
│   ├── toast.ts                     ─ Toast 通知のストア
│   ├── notify.ts                    ─ 通知グループ・メーカー連携のヘルパ
│   └── dashboard.ts                 ─ ダッシュボード/ウィジェットのファクトリ
│
├── components/
│   ├── Sidebar.tsx                  ─ 左サイドバー（ナビ + UserMenu）
│   ├── UserMenu.tsx                 ─ Clerk モック
│   ├── CsvImportButton.tsx          ─ CSV インポート（アイコン専用モードあり）
│   ├── EmptyState.tsx               ─ センサー0件時の CTA
│   ├── KpiCard.tsx                  ─ KPI カード共通
│   ├── ToastContainer.tsx           ─ Toast UI
│   ├── ReportPreview.tsx            ─ 月報/週報のディスパッチ
│   ├── SummaryReport.tsx            ─ 月報サマリ
│   ├── MonthlyTableReport.tsx       ─ 月報詳細表
│   ├── WeeklySummaryReport.tsx      ─ 週報サマリ
│   ├── WeeklyTableReport.tsx        ─ 週報詳細表
│   ├── ReportHeroLine.tsx           ─ レポート見出しの共通行
│   ├── SensorAlertSettings.tsx      ─ センサー個別のアラート設定
│   ├── SensorNoteDialog.tsx         ─ 運用メモ追加
│   ├── DashboardEditDialog.tsx      ─ ダッシュボード作成・編集
│   ├── DashboardConfirmDialog.tsx   ─ 確認チェックイン
│   ├── NotificationGroupEditDialog.tsx
│   ├── ManufacturerIntegrationDialog.tsx
│   │
│   ├── widgets/
│   │   ├── TileWidget.tsx           ─ タイル群
│   │   ├── ChartWidget.tsx          ─ 折れ線（複数センサー）
│   │   ├── MapWidget.tsx            ─ フロアマップ（ピン配置）
│   │   ├── DeviationWidget.tsx      ─ 逸脱ピックアップ（連続セグメント）
│   │   └── WidgetEditDialog.tsx     ─ ウィジェット作成・編集
│   │
│   └── views/
│       ├── DashboardView.tsx        ─ ダッシュボード本体
│       ├── SensorsView.tsx          ─ センサー一覧
│       ├── SensorDetailView.tsx     ─ センサー詳細
│       ├── GatewaysView.tsx         ─ ゲートウェイ一覧・詳細
│       ├── ReportView.tsx           ─ レポート出力
│       ├── SettingsView.tsx         ─ 設定（デバイス連携・通知グループ）
│       └── RecordsView.tsx          ─ 記録履歴（チェックイン・メモ・承認）
│
└── styles/
    ├── dashboard.css                ─ シェル・ダッシュボード・各種コンポーネント
    └── report.css                   ─ 月報/週報の印刷用 CSS（A4対応）
```

---

## 主要な型（`src/types.ts`）

### センサー・計測

```ts
SensorReading       // 1 件の計測データ (deviceId, measuredAt, temperature, humidity, battery?)
DeviceStore         // Record<sensorId, SensorReading[]>
Sensor              // メタ情報 (id, deviceNumber, serialNumber, model, ...alertSettings, kind, notificationGroupId)
SensorStore         // Record<sensorId, Sensor>
Gateway / GatewayStore
```

### ダッシュボード（Phase 9 で再構成）

```ts
Dashboard {
  id, name, description?,
  targetSensorIds: string[],       // ⭐ ダッシュボード対象センサー
  defaultPeriod: { type: 'day'|'week'|'month' },  // ⭐ 既定期間
  widgets: Widget[],
  createdAt, updatedAt
}

Widget = TileWidget | ChartWidget | MapWidget | DeviationWidget
DashboardPeriodMode = 'fixed' | 'since-last-checkin'
```

### アラート・通知（Phase 7）

```ts
AlertSettings { offlineEnabled, offlineThresholdMinutes, deviationEnabled, deviationConsecutiveCount, notifyChannels }
NotificationGroup { id, name, timing, channels[], approval? }
NotificationTiming = 'immediate' | 'batch-1h' | 'batch-6h' | 'batch-12h' | 'batch-24h'
ManufacturerIntegration { id, manufacturer, enabled, webhookSecret, sensorKinds, ... }
```

### 記録（Phase 8）

```ts
DashboardCheckin { id, dashboardId, dashboardName(snapshot), userName, timestamp, comment?, sensorComments[], snapshot, approval? }
SensorNote { id, sensorId, sensorName(snapshot), authorName, body, category, timestamp, approval? }
RecordApproval { approvedById, approvedByName, approvedAt, comment? }
```

### センサー種別（Phase 7、将来拡張）

```ts
SensorKind = 'temperature-humidity' | 'analog-meter' | 'door' | 'water-level' | 'current'
// 現在 supported は 'temperature-humidity' のみ
```

---

## 永続化の現状

- **localStorage キー**: `miterude:state:v3`
- **構造**: `PersistedState` (storage.ts)
- **マイグレーション**: v2 / v1 のキーは自動削除
- **画像（マップ）**: ウィジェット内に data URL で保管。アップロード時に最大 1600px・JPEG 0.82 で圧縮

---

## 配色ポリシー

| 色 | 用途 |
|---|---|
| ネイビー (`#0f2744` / `#1a4f8a` 系) | プライマリ・サイドバー・ボタン |
| 白・黒・グレースケール | UI ベース、通常テキスト |
| **赤 (`#c00`)** | **逸脱表示専用**（点滅アニメーション含む） |
| ブルー (`#1a6fb5`) | 温度グラフ |
| アンバー (`#b45309`) | 湿度グラフ（ユーザー承認済の例外色） |

冷蔵/冷凍/室温の区分はアイコンとバッジ文字色で分ける（線色には反映しない）：
- 冷凍: `#1a6fb5`
- 冷蔵: `#0f2744`
- 室温: `#6b7480`

---

## 開発コマンド

```bash
npm run dev    # http://localhost:3100/ で起動
npm run build  # tsc -b && vite build
npm run lint
```

---

## 既知の制約

- localStorage 5MB 制限（マップ画像が大きいと QuotaExceeded になる）→ 自動圧縮で対処
- 認証は Clerk のモック表示のみ。本物の認証は Phase 10 から
- 通知（メール/Slack/Webhook）は UI のみで送信は未実装

---

## 関連ドキュメント

- [Milesight 連携実装計画](./milesight-integration-plan.md)
