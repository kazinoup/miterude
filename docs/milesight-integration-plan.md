# ミテルデ × Milesight Webhook 連携 実装計画

> **対象**: ミテルデ (温湿度モニタリング SaaS) の Phase F〜G（Webhook 受信・自動配信）以降の実装計画書
> **最終更新**: 2026-05-08
> **状態**: 設計フェーズ。実装着手前の合意ドキュメント。

> **⚠ 重要**: 本ドキュメントの DB スキーマ詳細は [`docs/database-schema.md`](./database-schema.md) に統合されました。
> 全テーブル DDL・RLS 方針・ロール体系（4 階層）は schema 側を正とし、本ドキュメントは
> **Milesight 固有の運用フロー / Webhook 受信仕様 / アラート判定アルゴリズム** にフォーカスします。
> 表記が食い違っている場合は schema 側を優先してください。

---

## 0. このドキュメントの位置付け

ミテルデは現在、React + Vite + localStorage で動作する**フロントエンド完結のモック**です。
Phase F（Webhook 受信）以降では、これを **Milesight Development Platform (MDP) からの Webhook を受信して、リアルタイムに温湿度を監視する本番アプリ**へと進化させます。

本ドキュメントは、その実装に着手する前に**設計と決定事項を文章として固める**ことを目的とします。
実装中はここを起点に作業を進めてください。

> 全体のフェーズ計画（A〜G）は `database-schema.md` の「7. 実装フェーズ」を参照してください。
> 本ドキュメントは Phase F・G（Webhook 受信、アラート判定、通知配信）の詳細仕様を扱います。

---

## 1. ゴール

冷蔵庫・冷凍庫など現場のセンサーから上がってくるデータを、

1. **Milesight MDP → ミテルデ** へ Webhook で受信する
2. 受信データを永続化（PostgreSQL）し、ダッシュボードでリアルタイム表示する
3. 逸脱を検知して通知グループ経由で関係者に通知する
4. 過去データ（CSV インポート）と Webhook で受け取る今後のデータを**シームレスに統合**する
5. **マルチテナント**として複数組織を分離した状態で同時運用できる

---

## 2. 前提と決定事項

ユーザーとの議論で確定した事項：

| 項目 | 決定 |
|---|---|
| **Webhook 受信の所在** | ミテルデ側（ツクルデではなく） |
| **CSV インポート機能** | 残す（旧システム移行 + バックフィル用途） |
| **バックエンド** | **Supabase + Vercel** （A 案） |
| **マルチテナント方式** | 1 テナント = 1 Milesight Application（1:1 マッピング） |
| **未登録センサーの扱い** | Webhook 着信時に**自動で `unassigned` 状態で新規登録**。データは即座に蓄積。命名・割当はユーザーが後から実施 |
| **データ取り込み** | 非同期（`raw_events` で生保管 → 別ジョブが正規化） |
| **アラート設計** | 2 軸：①連続逸脱回数で「**判定**」、②通知グループの timing で「**通知頻度**」 |
| **過去データ** | センサーごとに CSV 過去 + Webhook 現在を時系列で連続表示 |
| **スケール想定** | 将来 1万台規模も視野（要 Edge Function + TimescaleDB） |
| **認証** | Clerk（既にモック化済）+ Supabase Auth との JWT 連携 |
| **配信方式** | Supabase Realtime（WebSocket）でフロント自動更新 |

---

## 3. システム構成

### 3.1 全体図

```
┌──────────────────────────────────────┐
│   Milesight Development Platform     │
│   (MDP)                              │
│                                      │
│   ┌─Application A (= Tenant A)─┐     │
│   │ Devices: EM320-TH × N      │     │
│   │ Webhook URL:               │     │
│   │   …/milesight/{org_a_id}   │     │
│   │ Secret: <random>           │─┐   │
│   └────────────────────────────┘ │   │
│   ┌─Application B (= Tenant B)─┐ │   │
│   │ …                          │─┤   │
│   └────────────────────────────┘ │   │
└──────────────────────────────────┼───┘
                                   │ HTTPS POST (JSON)
                                   ▼
            ┌──────────────────────────────────────────┐
            │  Vercel API Route (Edge Runtime)         │
            │  POST /api/webhooks/milesight/[org_id]   │
            │  - Header: X-Webhook-Secret 検証         │
            │  - idempotency_key で重複排除            │
            │  - webhook_inbox に INSERT のみ          │
            │  - **即 200 OK 返却**                    │
            └──────────────────┬───────────────────────┘
                               │
                               ▼
            ┌──────────────────────────────────────────┐
            │  Supabase Postgres                       │
            │  ┌────────────────┐                      │
            │  │ webhook_inbox  │ ← 全 payload を生で  │
            │  │ (payload_raw)  │   保管。マスタ照合   │
            │  │                │   はしない           │
            │  └────────┬───────┘                      │
            │           │ Edge Function                │
            │           │ process_webhook_inbox        │
            │           │ (pg_cron 5min + 手動 invoke) │
            │           ▼                              │
            │  ┌────────────────────────┐              │
            │  │ sensors (admin が事前   │ ← マスタ     │
            │  │   手動登録)            │              │
            │  └────────────────────────┘              │
            │           │ バルク照合                    │
            │           ▼                              │
            │  ┌────────────────────────┐              │
            │  │ sensor_readings        │ ← 時系列     │
            │  │ gateway_status_events  │   (bigint    │
            │  │                        │    identity) │
            │  └────────┬───────────────┘              │
            │  未マッチは webhook_inbox に              │
            │  parse_status='unmatched' で残し、admin   │
            │  が claim → 過去ぶんも遡及反映            │
            │           │ Realtime Channel (WebSocket) │
            │           ▼                              │
            │  ┌──────────────────┐                    │
            │  │ alert_logs       │ ← 判定結果を       │
            │  │                  │   フラットに蓄積   │
            │  └────────┬─────────┘                    │
            │           │                              │
            │           ▼                              │
            │  ┌──────────────────────┐                │
            │  │ Alert Evaluator      │                │
            │  │ Notif Dispatcher     │ → メール/Slack/│
            │  │ (cron 1min)          │   Webhook      │
            │  │ → notification_      │                │
            │  │   dispatches         │                │
            │  └──────────────────────┘                │
            └──────────────────┬───────────────────────┘
                               │
                               ▼
            ┌──────────────────────────────────────────┐
            │  ミテルデ フロントエンド (React + Vite)   │
            │  - Vercel Static Hosting                 │
            │  - Supabase JS Client (Realtime 購読)    │
            │  - Clerk 認証                            │
            └──────────────────────────────────────────┘
```

### 3.2 採用技術と理由

| 層 | 採用 | 理由 |
|---|---|---|
| **フロント** | React 19 + Vite（既存）+ Vercel | 既存資産を活かす。Vercel デプロイは1コマンド |
| **API** | Vercel API Route（Edge Runtime） | Webhook 受信に最適。コールドスタート短い、グローバル分散 |
| **DB** | Supabase（PostgreSQL + TimescaleDB extension） | 時系列 + RLS + Realtime + Auth が1パッケージ |
| **認証** | Clerk（org 機能）+ Supabase JWT 検証 | Clerk は既存。Supabase RLS と JWT で連携可能 |
| **リアルタイム配信** | Supabase Realtime（WebSocket） | postgres 行変更を即フロントへ。自前実装ゼロ |
| **非同期処理** | Supabase Edge Function + pg_cron | 軽量、Postgres にネイティブ統合 |
| **将来のキュー（10万台超想定）** | Inngest または QStash の検討余地 | Phase 15 以降 |

---

## 4. データベーススキーマ — 概要

> **詳細な DDL・全テーブル定義は [`docs/database-schema.md`](./database-schema.md) を参照。**
> 本セクションは Milesight 連携の文脈で関わるテーブルの位置づけだけ抜粋する。

### 4.1 Milesight 連携で主に触れるテーブル

| テーブル | 役割（Milesight 連携の観点） |
|---|---|
| `organizations` | テナント（1 org = 1 Milesight Application） |
| `manufacturer_integrations` | Milesight / IoT Mobile 連携設定。Webhook secret、有効/無効、`config jsonb`（Milesight 双方向 API 用 client_id 等もここに） |
| `sensors` | センサーマスタ。`serial_number`（DevEUI 相当）と `name` を持つ。**admin が事前登録**するため `name IS NULL` の運用は廃止 |
| `gateways` | ゲートウェイマスタ。`external_id` に Milesight 側の MAC を入れる |
| `webhook_inbox` | **Webhook 生 payload 保管。冪等性キーで重複排除**。Milesight 連携の入り口 |
| `sensor_readings` | 正規化された時系列計測（bigint identity）。webhook_inbox から Edge Function でパースして INSERT |
| `gateway_status_events` | ゲートウェイの online/offline 遷移履歴 |
| `alert_logs` | 判定結果のフラットなイベントログ。連続逸脱の状態管理は **このテーブルから動的に算出** する設計（独立した state テーブルは持たない） |
| `notification_dispatches` | 通知配信履歴。`alert_log_ids[]` でまとめ送信のスナップショットを保持 |
| `notification_groups` / `notification_channels` | 配信先（メール/Slack/Webhook） |
| `dashboards` / `widgets` | ダッシュボード（既存） |
| `dashboard_checkins` + `_sensor_comments` + `_segment_comments` | 確認記録。`alert_logs.confirm_comment` への伝搬元 |

### 4.2 Milesight 連携で「特殊な」設計判断

- **`manufacturer_integrations` の `config jsonb`** に Milesight 固有設定（`app_name` / `client_id` / `client_secret` / `server_address` 等）を入れる。
  メーカー別に専用テーブル（旧 `milesight_applications`）を作らず、JSONB で柔軟に持つ方針。
- **マスタ登録は admin が事前手動**: 旧設計では Webhook 受信時の自動登録（`name IS NULL` で
  暫定作成）を想定していたが廃止。`sensors` は admin が CSV 貼り付け or フォームで明示登録する。
  Webhook で来た未登録 DevEUI は `webhook_inbox.parse_status='unmatched'` で残し、admin が claim
  してから sensors に追加する（Phase F-3 / Section 9.4 参照）。
- **アラート状態管理**: 旧設計では `alert_states` + `alerts` の二段構成だったが、現スキーマでは
  `alert_logs` の単一テーブルにフラット化。連続逸脱の判定状態（連続カウンタ等）は
  Edge Function（or アプリ層）が `alert_logs` を SELECT して算出する。
- **TimescaleDB**: 当面は通常の Postgres + `bigint identity` で運用。月数百万行を超える規模になったら
  `sensor_readings` を partitioned table（`PARTITION BY RANGE (measured_at)`）に切り替え検討。

### 4.3 RLS について

詳細は `database-schema.md` の「4. RLS 方針」を参照。
**Webhook 受信 API は service_role キー**で動作させ、RLS をバイパスする
（テナント分離は URL の `org_id` + secret 検証で担保）。

#### `webhook_inbox` のアクセス制御

`webhook_inbox.payload_raw` には Milesight が送ってきた JSON が **そのままの形**
で保管される。生ログには内部の deviceId や IP 情報など、テナント運用者には
見せたくない要素が混じる可能性があるため、**閲覧は staff（super_admin /
support）のみ**に制限する:

- 書き込み: webhook 受信 API のみ（service_role）
- 読み取り: staff のみ（RLS で `auth.jwt()->>'system_role' IN ('super_admin', 'support')` を要求）
- 顧客テナント側からは UI も API も提供しない（モック実装でも `src/admin/` 配下に
  限定し、テナント側コードからは import 経路すら作らない方針）

仕分け済みの `sensor_readings` / `alert_logs` は通常の RLS（自テナント可視）
に従うので、顧客側はそちらを見れば十分。

---

## 5. Webhook エンドポイント仕様

### 5.1 URL 設計

```
POST https://app.miterude.example.com/api/webhooks/milesight/{org_id}
Content-Type: application/json
Header: X-Webhook-Secret: <secret>
Body: <Milesight-formatted JSON>
```

- `org_id`: ミテルデ内の `organizations.id` (UUID)
- `X-Webhook-Secret`: テナントごとに発行されたシークレット。`manufacturer_integrations.webhook_secret`（manufacturer='Milesight' の行）と照合
- リクエストボディは Milesight が決める形式（実物の JSON 構造は付録 F 参照）

#### なぜテナントごとに異なる URL（パスパラメータ）にしたか

選択肢として「全テナント共通の単一 URL に POST → MDP 側 UUID を見て仕分ける」案も
あったが、以下の理由で **パスパラメータ方式（`/{org_id}`）** を採用:

| 観点 | パスパラメータ方式 | 共通 URL + UUID 仕分け |
|---|---|---|
| サーバ実装 | Vercel/Next.js の動的ルート（`[org_id]/route.ts`）で標準対応、追加実装ゼロ | UUID → org_id の lookup テーブル必須 |
| 受信時の DB アクセス | パスから即取得 → secret 検証 1 回 | UUID 検索 1 回 + secret 検証 1 回（合計 2 回） |
| アクセスログ | URL に org_id 入り → ログ grep で即特定 | UUID から DB 引かないと特定不可 |
| MDP 設定ミス | URL に org_id 入り → 別テナントの URL を貼ると目視で気付ける | UUID は機械的、貼り間違いに気付けない |
| 多段防御 | URL 構造 + secret + (任意で) UUID | secret + UUID |

→ **動的 URL 生成**といっても、サーバが新規 URL を発行するわけではなく、
1 つのルートテンプレートのパス変数部分が変わるだけ。**追加インフラは不要**。

#### Milesight 側 Webhook UUID の扱い

MDP の Webhook 設定には Application 単位で UUID（例 `665e05dd-2f56-4c11-ac17-a77d74d747cf`）
が自動発行される。これは **コールバック URI とは独立した補助識別子**。

我々の使い方:
- `manufacturer_integrations.webhook_uuid` カラム（または `metadata JSONB`）に保存
- 用途は Webhook 受信の **三段目の検証**（secret 検証 + URL の org_id 一致 + UUID 一致）と監査
- Admin Console の Milesight 連携タブに「MDP 側 UUID: ◯◯」と並べて表示することで、
  サポート時に「MDP のどの Application と紐付いてるか」を即確認可能

### 5.2 受信ハンドラの責務（最小化）

```
1. Header の secret 検証 → 不一致なら 401
2. body から idempotency_key を算出
   ┌ event_id があれば: hash(org_id, event_id)
   └ なければ:           hash(org_id, payload全体, received_minute)
3. webhook_inbox に INSERT (重複なら ON CONFLICT DO NOTHING)
   - manufacturer = 'Milesight'
   - payload_raw = body
   - parse_status = 'pending'
4. 200 OK を即返却
   ※パース・正規化・アラート評価は一切行わない
```

> **冪等性の実装**: `webhook_inbox` には `unique (organization_id, payload_raw->>'event_id')` 等の
> 部分インデックスを追加するか、もしくは `idempotency_key` 列を追加して unique 制約を貼る方式を検討。
> マイグレーション SQL 起こす段階で確定する。

これにより応答時間は概ね**100ms以下**に抑える。Milesight 側のタイムアウトと再送ループを回避。

### 5.3 受信レスポンス

```
HTTP/1.1 200 OK
Content-Type: application/json

{ "ok": true }
```

400/401/500 を返すと Milesight 側がリトライしてくる。重複は冪等性で排除されるので問題なし。

### 5.4 Milesight Open API（逆方向通信）の存在と扱い

MDP の Application 設定には Webhook の他に **Open API** の認証情報（`Server Address` /
`Client ID` / `Client Secret` / `Request Restriction`）も含まれる。これは **Webhook と
反対方向の通信**:

| 方向 | 経路 | 役割 |
|---|---|---|
| MDP → ミテルデ | Webhook | センサー測定値・状態変化の **push** |
| ミテルデ → MDP | Open API（OAuth2 client credentials） | デバイス情報の **pull** / 制御命令 |

#### 想定ユースケース（Phase G-2 以降で検討）

| シナリオ | Open API で何ができるか |
|---|---|
| デバイス一覧の同期 | MDP に登録済みのデバイスを定期 pull → ミテルデの `sensors` 未登録分を Admin に通知（"未登録 DevEUI" UX より早く拾える）|
| 機種カタログの自動更新 | 新しい機種が MDP に増えたら Open API でメタを取得 → `SUPPORTED_DEVICES` を自動更新 |
| リモート設定変更 | Sampling interval 等を Admin 画面から変更 → MDP に反映 |
| デバイス再起動 | サポート時の「現場に行かずに reboot」 |
| 過去データのエクスポート | センサー復帰時の過去ぶん追送を Webhook 待ちじゃなく能動取得 |

#### MVP 範囲か？

**MVP（Phase F-1〜G-1）には不要**。Webhook 受信 + 仕分けバッチ + アラート通知で
運用は回る。Open API は **Phase G-2** の運用堅牢化フェーズで「未登録 DevEUI のリードタイム
短縮」「リモートメンテ」のために検討する。

ただし `Client ID` / `Client Secret` は MDP 上にすでに発行されているので、
将来必要になったときに使える状態にしておく（`manufacturer_integrations.openapi_client_id`
等の任意カラムを付与しておくとよい）。

#### Request Restriction（IP 制限）

MDP 側で Open API を叩く相手の IP allowlist を設定できる機能。Vercel Functions の
egress IP は安定しないため、Open API を使う段階になったら:
- **Vercel の Pro プラン以上 + Static IP 機能** を有効化
- もしくは Cloud Run / AWS Lambda + NAT Gateway 等の固定 IP を持てる環境を経由
- IP 固定が難しければ Restriction を OFF + Client Secret に強い rotation ポリシー

---

## 6. マルチテナント運用フロー

### 6.1 想定される運用ステップ

> **重要な方針変更**: 顧客が自由にデバイスを追加できる設計（旧プランの自動登録）は廃止。
> センサー / ゲートウェイのマスタは Admin Console で **自社が事前に手動登録** する。

#### 通常フロー（出荷前にマスタ登録できるケース）

```
1. [自社] Admin Console > テナントを新規作成
2. [自社] MDP で Application を新規作成（テナント名と同じ名前）
3. [自社] MDP の "Devices" にセンサー（EM320-TH, UG65 等）を追加し、
          作成した Application に割り当て
4. [自社] ミテルデの Admin Console > テナント詳細 > Milesight 連携設定 から
          **Webhook URL** と **Secret** を取得
5. [自社] MDP の Application Settings に
          - Callback URI を貼り付け
          - Secret を貼り付け（双方向に同じ値）
          - Webhook を Enable
          - 「Test」ボタンで疎通確認 (WEBHOOK_TEST が来る)
6. [自社] Admin Console > テナント詳細 > センサータブ で
          DevEUI / 名前 / モデル / ゲートウェイ を **マスタに登録**
          （30 台規模の bulk 登録は CSV/TSV 貼り付けで一括投入）
7. [自社] センサーの電源を入れて、ゲートウェイ経由で MDP に登録
8. [自動] MDP がセンサーデータを Webhook で送信開始
9. [自動] ミテルデが Webhook を `webhook_inbox` に積む（マスタ照合しない）
10. [自動] **5 分 cron** で仕分けバッチが実行され、
           マスタ済みのデータは `sensor_readings` に正規化される
11. [顧客] テナント画面でダッシュボードに紐付けて運用開始
```

#### 例外フロー（先に電源 ON されて、後からマスタ登録するケース）

現場の都合でマスタ登録より先にセンサーが起動して Webhook が来てしまう場合:

```
A. [自動] Webhook 受信 → `webhook_inbox` に積む
B. [自動] 5 分バッチ → 該当 DevEUI が sensors にないので
          `parse_status='unmatched'` で残る（データは捨てない）
C. [自社] Admin Console のサイドバーに「未登録デバイス N 件」バッジが点灯
D. [自社] テナント詳細 > センサータブ で「未登録 DevEUI」カードを見て
          [このテナントに登録] ボタン → 名前 / モデル / GW を入力
E. [自動] 過去の `unmatched` 行が `pending` に戻り、即時バッチで `sensor_readings` に流れる
F. [顧客] **登録忘れ期間中のデータも含めて** ダッシュボードに表示される
```

### 6.2 自社が管理するもの・顧客が管理するもの

| 管理者 | 担当範囲 |
|---|---|
| **自社（オペレーター）** | MDP のデバイス・アプリ登録、ハードウェア発送、テナント新規作成、**センサー / GW マスタの登録**、未登録 DevEUI の claim、契約 / 請求管理 |
| **顧客（テナント管理者）** | ダッシュボード作成、通知設定、確認運用、CSV による過去データの後追い取り込み（センサー詳細画面） |

**ポイント**:
- 顧客がデバイスを追加することは**できない**（マスタ操作は admin のみ）
- ただし、登録済デバイスへの「過去データ追加（CSV インポート）」は editor 権限の顧客でも可能
- 未登録 DevEUI を claim できるのは admin のみ → 誤テナントへのデータ流入を防げる

---

## 7. アラート設計（2 軸）

### 7.1 設計の2軸

| 軸 | 設定の所在 | 役割 |
|---|---|---|
| **判定** | センサーの `alert_settings.deviationConsecutiveCount` | 連続 N 回の逸脱で初めてアラート確定 |
| **通知** | 通知グループの `timing` | 即時/1h/6h/12h/24h でまとめ送信 |

### 7.2 判定アルゴリズム

> **設計変更**: 旧設計の `alert_states` + `alerts` 二段構成を廃止し、
> `alert_logs` の単一テーブルにフラット化。連続カウンタは
> Edge Function 内のメモリ or `alert_logs` を SELECT して動的算出する。

```
[新しい sensor_readings INSERT]
        ↓
[逸脱判定]
   reading.value vs sensors.thresholds（個別閾値）
        ↓
[直近 N 件の連続逸脱をカウント]
   - 同センサー × 同 metric の sensor_readings を
     occurred_at desc で N 件 SELECT
   - 連続して逸脱しているか確認
        ↓
[アラート確定判定]
   if (連続逸脱 >= sensor.alert_settings.deviationConsecutiveCount
       AND 直近の alert_logs に同じセンサー×種別の未解消 'deviation-alert'
       が既に存在しない):
       → alert_logs に INSERT (kind='deviation-alert' or 'deviation-warn')
         - notification_status='pending'
         - confirm_comment は確認時に後追いで埋まる

   オフライン判定（cron で定期実行）:
       - sensors.last_seen_at が
         alert_settings.offlineThresholdMinutes を超過 →
         alert_logs に INSERT (kind='offline')

   バッテリー判定（reading 到着時）:
       - sensor_readings.battery <
         sensor.alert_settings.batteryThresholdPercent →
         alert_logs に INSERT (kind='battery')
```

> **「解消」イベントの扱い**: 現スキーマでは `alert_logs` は基本「発生」のみを記録する。
> 解消通知が必要な場合は `kind='deviation-resolved'` を将来追加するか、
> 直近の deviation-alert/warn が一定時間続かなかったら自動解消とする運用を採用。

### 7.3 通知ディスパッチ

```
[1分おきに動く cron ジョブ]
   alert_logs を notification_status='pending' で SELECT
        ↓
   通知グループの timing で scheduled_for を決定
        ↓
   通知グループの送信先（メール/Slack/Webhook）に
   alert_log_ids[] にひも付くアラートを集約してまとめ送信
        ↓
   notification_dispatches に履歴 INSERT
   alert_logs.notification_status='sent', notified_at=now()
```

タイミングごとの動作（`notification_groups.timing` で指定）:

| timing | scheduled_for の決め方 |
|---|---|
| `immediate` | アラート発生時刻 |
| `batch-1h` | 次の正時 (例: 14:23 → 15:00) |
| `batch-6h` | 0/6/12/18 時の次の到来時刻 |
| `batch-12h` | 0/12 時 |
| `batch-24h` | 翌 0 時 |

---

## 8. CSV インポートの設計

CSV インポートは **admin 専用機能** とする（顧客側 UI は提供しない）。
用途別に 2 つのルートに分かれる。

| ルート | 場所 | 操作者 | 用途 | 表示条件 |
|---|---|---|---|---|
| **(8.A) 移行用 CSV** | Admin Console > テナント詳細 > センサータブ | admin / support | 既存システムからの一括移行（初期セットアップ専用） | `migrationMode` 中のみ表示 |
| **(8.B) モック開発用 CSV** | テナント画面 > 設定 > CSV インポート（既存） | dev | センサー / GW を擬似生成して動作確認 | 開発ビルドのみ（フィーチャーフラグ） |

> **顧客側に CSV インポート UI は置かない**。理由:
> 1. データ起源を admin 側で完全に管理できる（誤データ混入の防止）
> 2. 顧客に「過去データを追加で取り込む」ニーズが出てきたら、admin がインポーソネーションで作業する運用に倒す
> 3. 通常運用は Webhook → 5 分バッチで自動化されるため、追加 CSV ルートが必要になる場面は限られる

### 8.A 移行用 CSV（admin、一括インポート + 紐付けプレビュー）

**目的**: 既存システム（Milesight 純正クラウドや別 SaaS）を使っていた顧客 ~10 社を移行する初期作業のため。

**前提**:
- 通常運用では使わない。常時メニューに出すと誤操作の原因になる
- `Organization.migrationMode = { startedAt, finishedAt? }` で表示制御
  - 未設定 / `finishedAt != null` → パネル非表示
  - `startedAt != null && finishedAt == null` → 「移行 CSV インポート」パネルが表示

**配置**:

```
Admin Console > テナント詳細 > センサータブ
├─ [上部] 「今すぐ更新」ボタン（Phase F-3 手動再仕分け）
├─ [上部] 未登録 DevEUI キュー（claim 用）
├─ [移行モード時のみ表示] ── 移行 CSV インポートパネル ←★ ここ
│   └─ ドロップゾーン（複数 CSV 同時受け取り）
├─ センサー一覧グリッド（読み取り専用、変更なし）
└─ ゲートウェイ一覧グリッド（変更なし）
```

センサー一覧の各行に CSV アイコンは置かず、グリッド自体は読み取り専用を保つ。

#### 操作フロー（4 ステップ）

##### Step 1: 移行モード開始 + ドロップゾーン

admin が「移行モードを開始」ボタンを押すと `migrationMode.startedAt` がセットされ、移行 CSV インポートパネルが現れる。

```
┌─ 移行 CSV インポート ─────────────────────────────┐
│  ⚠️ 移行モード中にのみ表示されています              │
│                                                    │
│  ┌──────────────────────────────────────────────┐ │
│  │   📂 CSV ファイルをここにドロップ              │ │
│  │      （複数ファイル同時 OK / 1 ファイル =      │ │
│  │       1 センサー）                            │ │
│  │   または [ファイルを選択]                      │ │
│  └──────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────┘
```

##### Step 2: 紐付けプレビュー（自動マッチング + 手動上書き）

ファイル名から自動でセンサー候補を推定。admin はプレビュー表で確認・上書きしてから確定する。

```
┌─ 取り込み内容を確認 ────────────────────────────────────────────────────┐
│  16 ファイル中 14 件マッチ ・ 2 件未マッチ                              │
│                                                                        │
│  ファイル名                  期間                  対象センサー         状態      │
│  ───────────────────────────────────────────────────────────────────── │
│  CK01：3F製品冷凍庫1.csv     2024/01〜2025/12   [CK01: 3F …      ▼]  ✓ 自動    │
│  CK02：地下野菜.csv          2024/01〜2025/12   [CK02: 地下野菜  ▼]  ✓ 自動    │
│  CK26：卵冷蔵庫.csv          2024/06〜2025/12   [CK26: 卵冷蔵庫  ▼]  ✓ 自動    │
│  …                                                                     │
│  unknown_001.csv             2024/01〜2025/12   [選択してください▼]  ⚠ 要選択  │
│  test_export.csv             不明              [— スキップ      ▼]  — スキップ │
│                                                                        │
│  ✓ 既存と重複する 124 行は自動 skip / 新規 8,432 行を追加予定             │
│                                                                        │
│       [キャンセル]    [全 14 件を取り込む]                             │
└────────────────────────────────────────────────────────────────────────┘
```

**自動マッチングの優先順位**:

1. ファイル名先頭が `sensors.deviceNumber` と一致（例: `CK01:...csv` → `CK01`）
2. ファイル名に完全な DevEUI / シリアル番号が含まれる（例: `device_24E124710D123456.csv`）
3. ファイル名（拡張子・先頭デバイス番号除く）が `sensors.name` を含む（あいまい）
4. 上記いずれにも該当しない → 未マッチ → admin が手動選択するまでコミット不可

**プレビュー機能**:

- 各行の対象センサーをドロップダウンで上書き可能
- 「— スキップ」を選ぶと、そのファイルは取り込み対象外（試験ファイルや誤投下を除外）
- 期間カラム: ファイル内の最古〜最新タイムスタンプ
- 件数プレビュー: `sensor_readings` の `(sensor_id, measured_at)` ユニーク制約で重複行を事前計算 → 「N 件 skip / M 件 add」を確定前に表示

##### Step 3: 取り込み実行

```
┌─ 取り込み中 ──────────────────────────────────┐
│  CK14：3F 製品冷凍庫2 を取り込み中...         │
│  ████████████░░░░░░░░  12 / 14 ファイル       │
└──────────────────────────────────────────────┘
```

各ファイルを順次パースして `sensor_readings` に bulk INSERT（`source_inbox_id=NULL`）。

##### Step 4: 結果表示

```
┌─ 取り込み完了 ─────────────────────────────────────┐
│  ✓ 14 ファイル / 8,432 行を取り込みました         │
│  ⚠ 124 行は既存データと重複していたため skip       │
│  ⚠ 「unknown_001.csv」はマッチせずスキップしました │
│                                                   │
│  [移行を続ける]    [移行モードを完了する]          │
└───────────────────────────────────────────────────┘
```

「移行モードを完了する」を押すと `Organization.migrationMode.finishedAt` がセットされ、
**この CSV インポートパネルが画面から消える**。再度移行が必要なら admin が手動で再開できる。

#### 監査ログ

全工程を `audit_logs` に記録:

```
migration_started        (admin_id, target_organization_id, started_at)
csv_import_by_admin      (admin_id, target_organization_id, file_count, total_rows, skipped, added)
migration_finished       (admin_id, target_organization_id, finished_at, total_files, total_rows)
```

#### 実装上の注意

- パーサ部分（1 CSV → `sensor_readings[]` 変換）は再利用可能なライブラリ関数として切り出す
  → 8.B モック開発用 CSV や、将来テナント側にエンドポイントを追加する際に流用しやすい
- ドロップゾーンは複数ファイル受け取りに対応（FormData で複数ファイル送信）
- パース・件数プレビューはクライアントサイドで実行（小規模 CSV 想定 / メモリで処理可）。
  10MB 超えるような大型ファイルが出てきたら Edge Function 側で chunk 処理に切り替え

### 8.B モック開発用 CSV（既存・現行コード）

Phase A までで構築したモックの CSV インポート機能（センサー / GW を擬似生成）は **開発ビルドだけで残す**。

- ソースコード冒頭に `// MOCK ONLY: Phase F で本番実装 (8.A admin 移行 CSV) に置換予定` のコメント
- フィーチャーフラグ（環境変数 `VITE_MOCK_CSV_IMPORT=1` 等）で本番ビルドからは消す
- ローカル開発で「センサー追加が面倒」な時の便利機能として残置

### 8.C 共通: Milesight 実 CSV のフォーマット

実際の出力（[付録 E: Milesight CSV フォーマット仕様](#付録-e-milesight-csv-フォーマット仕様) 参照）:

```
時間,温度,湿度,バッテリー
"2025-12-01 00:02:19"," -21.6 ℃","72 %","96 %",
```

- BOM 付き UTF-8（先頭に `﻿`）
- ヘッダ: `時間,温度,湿度,バッテリー`（温湿度センサー）
- 値に **単位文字**（`℃` / `%`）と **前後の空白**が含まれる → パーサ側でトリム + 単位除去
- 行末にトレイリングカンマあり
- **DevEUI / シリアル / モデル等のメタ情報は CSV に含まれない** → ファイル選択時にセンサーを指定する UI が必須

### 8.D 重複排除

- `sensor_readings` に `(sensor_id, measured_at)` のユニーク制約
- 既存行があれば skip（CSV 再インポート時の二重登録を防ぐ）
- 取り込み結果を「N 件追加 / K 件 skip」と表示

### 8.E データソース判定

| 条件 | 由来 |
|---|---|
| `sensor_readings.source_inbox_id IS NOT NULL` | Webhook 経由（`webhook_inbox` から正規化された）|
| `sensor_readings.source_inbox_id IS NULL` | CSV 経由（admin の移行用インポート）|

グラフは `measured_at` 順で連続表示するので、由来が混在しても問題なし。
監査が必要なケースでは別途 `audit_logs` の `action` 列で区別する。

---

## 9. フロントエンド改修

### 9.1 既存資産の流用

Phase 1〜9 で作った React コンポーネント・型定義は**ほぼそのまま流用**できる：

- `DeviceStore`, `SensorStore`, `Dashboard`, `Widget` 型
- ダッシュボード・タイル・グラフ・マップ・逸脱ピックアップウィジェット
- アラート設定・通知グループ
- 確認チェックイン・運用メモ
- レポート出力

### 9.2 データレイヤの差し替え

現状は `src/lib/storage.ts` に集約された **テナントスコープ付き localStorage**
（キー: `miterude:tenant:<orgId>:state:v4`）で動作している。Phase A-1 でこの分離は完了済み。
本フェーズでは、ここを Supabase 経由に切り替える：

```ts
// 既存: src/lib/storage.ts （テナントスコープ付き localStorage）
loadState(orgId) / saveState(orgId, state)
   ↓ 置換
// 新規: src/lib/supabaseClient.ts + 各 store の fetch/upsert
- Supabase クライアント初期化（Clerk JWT を渡す）
- 各テーブルへの fetch/insert/update（RLS が org_id を担保）
- Realtime 購読 (subscribe)
```

### 9.3 Realtime 購読

```ts
// sensor_readings の INSERT を購読してウィジェットを即時更新
supabase
  .channel('sensor-readings')
  .on('postgres_changes',
    { event: 'INSERT', schema: 'public', table: 'sensor_readings',
      filter: `organization_id=eq.${orgId}` },
    (payload) => {
      // React state を更新 → 各ウィジェットが即時再レンダリング
    }
  )
  .subscribe()

// alert_logs の INSERT も購読してアラート一覧／バッジを更新
supabase
  .channel('alert-logs')
  .on('postgres_changes',
    { event: 'INSERT', schema: 'public', table: 'alert_logs',
      filter: `organization_id=eq.${orgId}` },
    (payload) => { /* … */ }
  )
  .subscribe()
```

### 9.4 「未登録 DevEUI」UI（Admin 専用）

> **方針変更**: 顧客側の「未割り当てセンサー」UI は廃止
> （顧客はマスタを操作できない設計に統一したため）。
> 代わりに **Admin Console** に未登録 DevEUI のキューを置く。

#### Admin Console サイドバーバッジ

```
┌────────────────────────────┐
│ 📁 テナント                 │
│ 👥 スタッフ                 │
│ 🕐 監査ログ                 │
│ ⚠️ 未登録デバイス  3 件      │ ← クリックで全テナント横断リストへ
└────────────────────────────┘
```

クエリは `webhook_inbox WHERE parse_status='unmatched'` の集計（DevEUI で GROUP BY）。

#### テナント詳細 > センサータブ内の未登録 DevEUI セクション

そのテナントに紐付く未登録 DevEUI（Webhook URL の `org_id` パスから判別）を一覧表示:

```
⚠️ このテナントで未登録の DevEUI が観測されています
   ┌──────────────────────────────────────────────┐
   │ 24E124710D123456 ・ 直近 2 分前 ・ 12 件      │
   │  [このテナントに登録]  [無視（誤送信）]       │
   ├──────────────────────────────────────────────┤
   │ 24E124710D654321 ・ 直近 5 分前 ・ 8 件       │
   │  [このテナントに登録]  [無視]                 │
   └──────────────────────────────────────────────┘
```

- `[このテナントに登録]` → 名前 / モデル / GW を入力するモーダル → `sensors` に INSERT
  → 過去 unmatched 行が `pending` に戻り、即時バッチで `sensor_readings` に流れる
- `[無視（誤送信）]` → `parse_status='ignored'` で残す（再表示しない）

#### 「今すぐ更新」ボタン

センサータブの上部に常時配置。`process_webhook_inbox` を即時 invoke し、
`{ processed: 12, unmatched: 3 }` を toast で返す。検証 / デバッグ / 登録直後の即時確認に使う。

---

## 10. 実装ステップ

> **位置づけ**: 全体フェーズ計画 A〜G は `database-schema.md` の「7. 実装フェーズ」を参照。
> 本セクションは Phase F（Webhook 受信）〜 Phase G（アラート判定 / 通知配信）の **詳細手順** を扱う。
> マルチテナント（Phase A）/ 設定移行（Phase B〜D）/ ダッシュボード（Phase E）はここでは前提とする。

### Phase F-1: バックエンド基盤（Supabase + Vercel 接続）

**目的**: Supabase + Vercel の土台を作り、Clerk と接続する。

**作業項目**:
1. Supabase プロジェクト作成（dev / production の2環境）
2. `database-schema.md` の DDL を順次適用（tenancy → settings → devices → dashboards → public sharing → data/logs の順）
3. RLS ポリシー作成（`database-schema.md` の「4. RLS 方針」参照）
4. Clerk-Supabase JWT 連携設定
   - Clerk Dashboard で Supabase JWT Template を作成
   - Supabase の Auth 設定で Clerk の JWKS URL を登録
5. Vercel プロジェクト作成
6. ミテルデの React コードを Vercel デプロイ（既存資産そのまま）
7. 環境変数設定（後述「環境変数」参照）
8. `app/api/webhooks/milesight/[org_id]/route.ts` の枠組みを作る（中身はまだダミー）

**完了条件**:
- Supabase ダッシュボードで全テーブルが見える
- Vercel に React がデプロイされ、URL でアクセスできる
- フロントから Supabase に test クエリが通る（自テナントのデータのみ見える）

**リスク**:
- Clerk の org 機能はプランによって制限あり → 事前に確認

---

### Phase F-2: Webhook 受信エンドポイント（探索フェーズ）

**目的**: ペイロード構造を把握する前に、生ペイロードを保管できる状態にする。

**作業項目**:
1. `POST /api/webhooks/milesight/[org_id]` を実装
   - Header `X-Webhook-Secret` を `manufacturer_integrations.webhook_secret`
     （該当 org × `manufacturer='Milesight'` の行）と照合
   - body から `idempotency_key` を生成
   - `webhook_inbox` に INSERT（ON CONFLICT DO NOTHING、`parse_status='pending'`）
   - 200 OK 即返却
2. `WEBHOOK_TEST` を判別してログに「テスト成功」を出力
3. ミテルデ管理画面の「設定 → デバイス連携 → Milesight」を実機能化
   - Webhook URL を実際の値で表示（コピー可能）
   - Secret を生成・再発行できる（`manufacturer_integrations.webhook_secret` を更新）
   - 過去の生イベントログをタイル表示（`webhook_inbox` 直近 50 件）
4. **テスト実行**:
   - 自社 Milesight Demo App から Test 送信
   - 実センサー 1〜2 台を 24 時間稼働
5. `webhook_inbox.payload_raw` を眺めて構造をリバースエンジニアリング

**完了条件**:
- 24 時間稼働させて `webhook_inbox` に 50+ 行ある
- WEBHOOK_TEST / DEVICE_DATA / PROPERTY / EVENT / ONLINE / OFFLINE の構造把握
- 同じ event_id が再送されても重複が入らない

**リスク**:
- Milesight ペイロードの公式スキーマが存在しないため、想定外のフィールドが将来追加される可能性
  → `webhook_inbox` で生保管しているので後追いで対応可能

---

### Phase F-3: 仕分けバッチと永続化

**目的**: `webhook_inbox` に積まれた生 payload を、5 分ごとのバッチで
`sensor_readings` / `gateway_status_events` に正規化する。
未登録 DevEUI は **自動登録せず**、`unmatched` として inbox に残し
admin が後追いで claim する運用にする。

**設計の前提（合意事項）**:

- **マスタは admin が事前に手動登録**する（顧客は登録不可）
- **Webhook 受信** は `webhook_inbox` に書き込むだけ（マスタ照合しない）
- **仕分け（マスタ照合 + sensor_readings 化）は 5 分 cron でまとめて**実行
  - 1 件ごとの SELECT を避け、バルク照合で DB 負荷を最小化
  - 5 分の遅延は温湿度モニタリングでは無視可能（センサー送信間隔 30 分が標準）
- **未登録 DevEUI** は `parse_status='unmatched'` で inbox に残す
- **登録されたら過去ぶんも遡及反映** する（unmatched → processed）

**作業項目**:

1. **Edge Function `process_webhook_inbox`** を作成
   - **pg_cron で 5 分おき自動実行**
   - Admin Console から「今すぐ更新」ボタンで手動 invoke も可
   - `parse_status='pending'` の行を最大 N 件取得して処理

2. **バッチ仕分けロジック（バルク照合）**:
   ```sql
   -- Step 1: pending を取得（最大 N 件）
   WITH batch AS (
     SELECT id, organization_id, payload_raw
     FROM webhook_inbox
     WHERE parse_status = 'pending'
     ORDER BY received_at
     LIMIT 1000
     FOR UPDATE SKIP LOCKED
   )
   -- Step 2: payload から DevEUI を抜き出し、sensors とまとめて JOIN
   -- Step 3: マッチ → sensor_readings に INSERT、parse_status='processed'
   --        マッチしない → parse_status='unmatched'（後で admin が claim）
   ```

3. **イベント別パーサ**:
   - `WEBHOOK_TEST` → `parse_status='processed'` で即スキップ
   - `DEVICE_DATA / PROPERTY` → DevEUI から sensors を解決
     - **見つかった**: `sensor_readings` に INSERT。`source_inbox_id` に元の `webhook_inbox.id` を保持
     - **見つからない**: `parse_status='unmatched'` で残す（自動登録しない）
   - `DEVICE_DATA / EVENT` → 必要に応じ `alert_logs` に直接 INSERT
   - `ONLINE / OFFLINE` → `gateways.online_status` 更新 + `gateway_status_events` に履歴 INSERT

4. **未登録 DevEUI の admin 通知**:
   - 仕分けバッチで `parse_status='unmatched'` の件数を集計するビューを用意
   - Admin Console のサイドバーに「未登録デバイス N 件」バッジを表示
   - テナント詳細画面 > センサータブに以下を表示:
     ```
     ⚠️ このテナントで未登録の DevEUI が観測されています
       ┌──────────────────────────────────────────────┐
       │ 24E124710D123456 ・ 直近 2 分前 ・ 12 件      │
       │ [このテナントに登録]  [無視（誤送信）]        │
       └──────────────────────────────────────────────┘
     ```
   - `[このテナントに登録]` クリック → 名前 / モデル / ゲートウェイを入力するモーダル
     → sensors に INSERT → 過去の `unmatched` 行を `pending` に戻して即時バッチ実行

5. **遡及反映フック**:
   - `sensors` に新規 INSERT が起きたとき、同 organization_id × 同 serial_number の
     `webhook_inbox.parse_status='unmatched'` を `'pending'` に戻す
   - 次回バッチ（または「今すぐ更新」ボタン）で `sensor_readings` に流れる
   - これにより **「登録忘れ期間中のデータも全部見える」** 運用が成立

6. **手動「今すぐ更新」ボタン**:
   - Admin Console > 各テナント詳細 > センサータブ
   - 押下で `process_webhook_inbox` を直接 invoke
   - レスポンス: `{ processed: 12, unmatched: 3 }` を toast で表示
   - 検証 / デバッグ / 登録直後の即時確認に使う

**完了条件**:
- 実センサー 2 台（事前に admin が登録済）のデータが `sensor_readings` に正規化されている
- 未登録 DevEUI で来たデータは `webhook_inbox` に `parse_status='unmatched'` として残る
- Admin Console のテナント詳細で未登録 DevEUI が一覧表示される
- 登録ボタンを押すと sensors に追加され、unmatched 分が `sensor_readings` に流れる
- 「今すぐ更新」ボタンで即時バッチが回る

**リスク**:
- パーサのバグでデータが歪む → `webhook_inbox` から再処理可能な設計を死守
  （`parse_status='pending'` に戻せば `process_webhook_inbox` が再実行する）
- バッチ実行中の重複起動 → `FOR UPDATE SKIP LOCKED` で防ぐ
- 未登録のまま長期間気付かない → サイドバーバッジで常時表示。
  運用回し始めて頻発するようなら後付けで日次サマリーメールを追加検討

---

### Phase F-4: フロントエンドの Supabase 接続

**目的**: 現在テナントスコープ付き localStorage で動いているフロントを Supabase に切り替える。

**作業項目**:
1. **`src/lib/supabaseClient.ts` 新規作成**: クライアント初期化、認証、CRUD ヘルパ
2. **`src/lib/storage.ts` の `loadState/saveState` を Supabase 経由に置換**
   - 各 store（sensors, gateways, dashboards, widgets, notification_groups …）を Supabase テーブルから fetch
   - 変更時は upsert（RLS が `organization_id` を担保）
3. **Supabase Realtime 購読**:
   - `sensor_readings` の INSERT を購読 → 該当センサーの最新値を更新
   - `sensors`, `alert_logs`, `gateway_status_events` の変更も購読
4. **CSV インポートを Supabase 直接書き込みに変更**
   - フロントから `sensor_readings` に bulk insert
   - 既存の sensor が無ければ自動生成、`source_inbox_id=NULL` のまま（CSV 由来の印）
5. **過去 CSV + Webhook の連続グラフ確認**（`measured_at` で並べるだけで自動的に統合される）

**完了条件**:
- ブラウザのリロードで状態が消えない（Supabase に保存されている）
- 別タブで開くと同じテナントの状態が共有される
- センサーのデータが Webhook で更新されると、ダッシュボードが自動再描画される

**リスク**:
- Realtime 購読の数が多すぎるとブラウザ側の負荷増 → ウィジェット単位ではなくダッシュボード単位で集約購読

---

### Phase G-1: アラート評価と通知配信

**目的**: 2 軸（連続逸脱判定 + 通知タイミング）の判定・配信ロジックを実装。

**作業項目**:
1. **アラート評価関数**（Edge Function、`sensor_readings` INSERT 後 or 1 分 cron）
   - 直近 N 件の `sensor_readings` を SELECT して連続逸脱をカウント
   - 連続カウンタ ≥ `sensor.alert_settings.deviationConsecutiveCount` かつ
     直近に未解消の同種 `alert_logs` がない → `alert_logs` に INSERT
     （`kind='deviation-alert'` または `'deviation-warn'`、`notification_status='pending'`）
   - オフライン判定（cron 別系統）: `sensors.last_seen_at` 超過 → `alert_logs` に `kind='offline'`
   - バッテリー判定（reading 到着時）: `sensor_readings.battery` < 閾値 → `alert_logs` に `kind='battery'`
2. **通知ディスパッチャ**（cron 1 分おき Edge Function）
   - `alert_logs` で `notification_status='pending'` の行を集約
   - 通知グループの `timing` で `scheduled_for` を決定
   - `scheduled_for <= now()` のものをメール（Resend）/ Slack / Webhook に集約送信
   - `notification_dispatches` に履歴 INSERT（`alert_log_ids[]` でスナップショット保持）
   - 対応する `alert_logs.notification_status='sent'`, `notified_at=now()` に更新
3. **設定 UI の整合**:
   - センサーのアラート設定に「N 回連続で逸脱したらアラート発動」を明示（既存 `alert_settings` から）
   - 通知グループ側に「タイミング」を明示（既存）
4. **テスト**: 閾値を超える reading を流して、設定回数連続で発火することを確認

**完了条件**:
- テスト用閾値で `deviationConsecutiveCount=3` に設定 → 3 回連続で逸脱した瞬間に `alert_logs` 行が増える
- 通知グループの timing が `batch-1h` なら次の正時に `notification_dispatches` 行が増えメールが届く
- 解消時の扱いは 7.2 注記の方針に従う（`deviation-resolved` 追加 or 自動解消運用）

**リスク**:
- 通知重複（同じアラートに対して複数通知）→ `notification_dispatches.alert_log_ids[]` で送信済みを判定

---

### Phase G-2: 運用堅牢化とスケール準備

**目的**: 1 万台規模で動くように、運用品質を上げる。

**作業項目**:
1. **Webhook 受信のスケーリング**:
   - Vercel API Route を Edge Runtime に
   - レート制限（IP 単位 + テナント単位）
2. **Postgres チューニング**:
   - `sensor_readings` のパーティション化（`PARTITION BY RANGE (measured_at)`、月単位）
   - 必要なら TimescaleDB extension に切り替え（hypertable + 自動圧縮）
   - データ保持ポリシー（`webhook_inbox` 90 日、`sensor_readings` 無期限 or 集計後アーカイブ）
3. **障害対策**:
   - パース失敗 → `webhook_inbox.parse_status='failed'`, `parse_error` に記録、Slack に通知
   - 死活監視ダッシュボード（Webhook 成功率、パース成功率、未送信通知数）
4. **シークレット再発行**: Phase F-2 で UI を作った再発行ボタンを実機能化
5. **ロギング**: Vercel Logs / Supabase Logs / Sentry など
6. **バックアップ**: Supabase の Point-in-Time Recovery 有効化

**完了条件**:
- 1 万件/分の負荷テストでエラーが発生しない
- 監視ダッシュボードで成功率を可視化できる

---

## 11. テスト戦略

### 11.1 各 Phase での動作確認

| Phase | 確認方法 |
|---|---|
| F-1 | ローカルで Supabase クライアントから自テナント行の select が通る（RLS 確認） |
| F-2 | curl で偽の WEBHOOK_TEST を送り、`webhook_inbox` に `parse_status='pending'` で行が入る |
| F-2 | 同じ idempotency_key で連続送信、行が増えない |
| F-3 | 事前登録済センサーから 1 時間データを流し、`sensor_readings` に正しく入る（`source_inbox_id` あり） |
| F-3 | 未登録 DevEUI を擬似送信 → `webhook_inbox` に `parse_status='unmatched'` で残る（`sensors` に自動追加されない） |
| F-3 | Admin Console のテナント詳細で未登録 DevEUI が一覧表示される |
| F-3 | 「このテナントに登録」ボタン → `sensors` に追加 + 過去 unmatched が `sensor_readings` に流れる |
| F-3 | 「今すぐ更新」ボタンで即時バッチが回る |
| F-4 | 別ブラウザで同じテナントを開き、Webhook 着信時に両方で更新される（Realtime 確認） |
| G-1 | 閾値超え reading を 3 回連続で送信、`alert_logs` に `kind='deviation-alert'` 行が増える |
| G-1 | 通知グループ `timing='batch-1h'` で発火、次の正時に `notification_dispatches` が増えメール到達 |
| G-2 | 1 万件/分の負荷を JMeter / k6 で流し、エラー率 0 を確認 |

### 11.2 自動テスト

- **単体**: パーサ関数（payload → sensor_readings）の Vitest
- **統合**: Webhook 受信 → `sensor_readings` 反映までの E2E（Supabase test instance）
- **回帰**: 過去 `webhook_inbox` を `parse_status='pending'` にリセットして再処理しても、
  同じ `sensor_readings` が生成されることを保証（idempotent な再処理）

---

## 12. 残課題・次の決定事項

実装に入る前に、以下を決める必要があります：

| 項目 | 選択肢 |
|---|---|
| **ビルド構成** | (a) Vite + Vercel API Routes（既存資産流用、軽量） / (b) Next.js に移行（フルスタック標準だが移行工数大） |
| **メール送信** | (a) Resend（モダン、TypeScript SDK 良） / (b) SendGrid / (c) AWS SES |
| **Slack 連携** | (a) Incoming Webhook（簡単） / (b) Bolt SDK（高機能） |
| **Sentry / 監視** | 入れるか / 入れるならどのプラン |
| **CI/CD** | GitHub Actions + Vercel Preview デプロイ |
| **環境分離** | dev / staging / production の運用方針 |
| **ドメイン** | `app.miterude.example.com` などの本番ドメインを決める |

私の推奨：
- **ビルド構成: Vite + Vercel API Routes**（移行コスト最小、既存資産そのまま）
- **メール: Resend**（DX が良い、Vercel と相性◎）
- **Slack: Incoming Webhook**（要件として十分）
- **監視: Sentry の Free プラン**（フロント・バックエンドの例外捕捉）

---

## 付録 A: 環境変数

開発・本番で必要な環境変数：

```env
# ----- Supabase -----
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...   # サーバー側のみ。Webhook 受信処理で使用

# ----- Clerk -----
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_...
CLERK_SECRET_KEY=sk_...
CLERK_JWT_SIGNING_KEY=...           # Supabase JWT 検証用

# ----- メール (Resend) -----
RESEND_API_KEY=re_...
RESEND_FROM_EMAIL=alerts@miterude.example.com

# ----- Webhook 受信 -----
WEBHOOK_LOG_LEVEL=info
WEBHOOK_RATE_LIMIT_PER_MINUTE=600
```

---

## 付録 B: 用語集

| 用語 | 意味 |
|---|---|
| **MDP** | Milesight Development Platform。センサー・ゲートウェイの管理 PaaS |
| **DevEUI** | Milesight デバイスの一意ID（24E124... のような16桁HEX）。`sensors.serial_number` に格納 |
| **EM320-TH** | Milesight 製の温湿度センサー（冷蔵庫・冷凍庫向け） |
| **UG65 / UG63** | Milesight 製のメインゲートウェイ / 中継パケットフォワーダー |
| **Webhook** | MDP がイベント発生時にミテルデに HTTP POST を送る仕組み |
| **テナント** | 1 顧客組織 = 1 `organizations` 行 = 1 Clerk Organization = 1 Milesight Application |
| **未登録 DevEUI** | Webhook で観測されたが `sensors` マスタにまだ登録されていない DevEUI。`webhook_inbox.parse_status='unmatched'` で残り、admin が「このテナントに登録」を押すまで `sensor_readings` には流れない |
| **逸脱判定** | reading が閾値を超えること。連続回数で `alert_logs` に昇格 |
| **アラート** | `alert_logs` の単一行（kind=deviation-alert / deviation-warn / offline / battery）。状態は別テーブルを持たず動的算出 |
| **通知ディスパッチ** | `alert_logs` を集約して通知グループ経由で外部（メール等）に送る処理。履歴は `notification_dispatches` |
| **冪等性** | 同じ操作を何度繰り返しても結果が同じになる性質。Webhook 再送対策（`webhook_inbox` の重複排除キー） |
| **RLS** | Row Level Security。Postgres のテナント分離機能（`organization_id` でフィルタ） |

---

## 付録 C: 参考リンク

- [Milesight Development Platform](https://sg-cloud.milesight.com/)
- [Supabase Docs](https://supabase.com/docs)
- [Supabase TimescaleDB extension](https://supabase.com/docs/guides/database/extensions/timescaledb)
- [Vercel Edge Functions](https://vercel.com/docs/functions/edge-functions)
- [Clerk + Supabase Integration](https://clerk.com/docs/integrations/databases/supabase)
- [Resend](https://resend.com/)

---

## 付録 D: チェックリスト（着手前）

実装に入る前に、以下が決まっていることを確認：

- [ ] Supabase プロジェクトのアカウント・プラン確定
- [ ] Vercel アカウント・プラン確定
- [ ] Clerk のプラン（org 機能を使うため Pro 以上が必要な可能性）
- [ ] Milesight Developer Account を持っている（テスト用）
- [ ] 本番ドメイン（`app.miterude.example.com` 等）の取得
- [ ] DNS の設定権限
- [ ] HTTPS 証明書（Vercel が自動発行）
- [ ] 自社が管理するテスト用センサー（EM320-TH × 1〜2 台、UG65 × 1 台）
- [ ] 監視サービス（Sentry など）のアカウント
- [ ] メール送信サービス（Resend など）のアカウントと送信元ドメイン認証

---

## 付録 E: Milesight CSV フォーマット仕様

既存 Milesight 純正クラウドからのエクスポート CSV（温湿度センサーの場合）。
Section 8.B（移行用 CSV）と 8.A（テナント単発 CSV）両方で同じパーサが使える。

### 概要

```csv
時間,温度,湿度,バッテリー
"2025-12-01 00:02:19"," -21.6 ℃","72 %","96 %",
"2025-12-01 00:32:20"," -14.4 ℃","79 %","96 %",
"2025-12-01 01:02:20"," -20.5 ℃","71 %","96 %",
...
```

### パーサ実装上の注意点

| 項目 | 仕様 | パーサ対応 |
|---|---|---|
| **エンコーディング** | UTF-8 + BOM | 先頭 3 バイト `﻿` を除去 |
| **ヘッダ** | `時間,温度,湿度,バッテリー`（固定）| ヘッダ検証（不一致なら明示エラー） |
| **トレイリングカンマ** | 各データ行の末尾に `,` あり（5 列扱いになる） | 5 列目は無視 |
| **値の前後空白** | `" -21.6 ℃"` のように前後にスペースあり | trim |
| **単位文字** | 温度: `℃` / 湿度: `%` / バッテリー: `%` | 末尾の単位を正規表現で除去（`/\s*(℃|%)$/`）|
| **温度の符号** | マイナス値あり（`-21.6`） | parseFloat で取れる |
| **時刻フォーマット** | `YYYY-MM-DD HH:MM:SS`（タイムゾーン情報なし）| ローカルタイム (Asia/Tokyo) として解釈 |
| **小数点** | 任意（`-24 ℃` も `-24.7 ℃` もあり）| parseFloat |
| **欠損値** | 観測ごとにメトリックが揃う前提（実物では確認） | 欠損列があったら null 扱い |

### **CSV にメタ情報がない問題**

Milesight 純正の出力には **DevEUI / シリアル番号 / モデル / メーカーが一切含まれない**。
ファイル名（例: `CK26：卵冷蔵庫.csv`）がセンサー識別の唯一の手がかり。

**対応**:
- 8.A（テナント単発 CSV）: センサー詳細画面からの取り込みなのでセンサー ID は確定済
- 8.B（移行用 CSV）: admin が UI 上でファイル → センサー の対応を明示的に割り当てる
- どちらも「ファイル名 → センサー名の自動マッチング候補」をサジェストすると admin の手間が減る
  （ファイル名先頭の `CK26` 等を `sensors.deviceNumber` と照合）

### センサー種別による違い

このフォーマットは **温湿度センサー (`temperature-humidity`)** の出力。
温度のみのセンサー (`temperature-only`) は `湿度` 列が含まれない可能性あり（実物の確認が必要）。
パーサはセンサーの `kind` を見て、想定するヘッダを切り替える。

---

## 付録 F: Milesight Webhook ペイロード仕様

実物の MDP（Milesight Development Platform）から飛んできた Webhook サンプルから判明した仕様。

### イベントの基本構造

Webhook の body は **JSON 配列**（複数イベントが 1 リクエストで届く）。各要素の形:

```json
{
  "eventId": "4960c0de-1c93-424b-b983-46f78d9aedd6",
  "eventType": "DEVICE_DATA",
  "eventVersion": "1.0",
  "eventCreatedTime": 1778234280,        // epoch sec（MDP 受信時刻）
  "data": {
    "type": "PROPERTY",                  // ← 後述
    "ts": 1778234280282,                 // epoch ms（測定時刻 / MDP 受信時刻）
    "tslId": "historical_data",          // 一部の type のみ
    "payload": { ... },                  // type ごとに違う形
    "deviceProfile": {
      "sn": "6785D19065740023",          // 製造シリアル
      "name": "CBO-039",                  // ユーザ命名
      "model": "EM320-TH-MAGNET",
      "devEUI": "24E124785D190657",      // ★ LoRaWAN 識別子（マスタ照合キー）
      "deviceId": 1840409303215063042    // Milesight 内部 ID（参考）
    }
  }
}
```

### 重要: `sn` と `devEUI` は別物

| | 役割 | フォーマット | 用途 |
|---|---|---|---|
| **sn** | 製造シリアル番号 | 16 字英数字 (例 `6785D19065740023`) | 物理デバイスの識別、ラベル印字 |
| **devEUI** | LoRaWAN 識別子 | 16 字 HEX (例 `24E124785D190657`) | **Webhook 受信時のマスタ照合キー** |

→ ミテルデの `sensors` / `gateways` テーブルには **両方** を持つ:
- `serialNumber` ← Milesight `sn`
- `devEUI` ← Milesight `devEUI`

Phase F-3 の仕分けバッチは `devEUI` で `sensors` を JOIN する（`sn` は補助情報）。

### `data.type` の種別

| type | tslId | 意味 | 我々の処理 |
|---|---|---|---|
| `ONLINE` | — | デバイスのハートビート（**`data.ts` も `payload` も無し**。`eventCreatedTime` のみ） | `sensors`/`gateways` の `online_status='online'` 更新 + `gateway_status_events`（status='online'）|
| `OFFLINE` | — | デバイスがオフライン化 | 同上（status='offline'）|
| `EVENT` | `historical_data` | センサーの **過去測定値**を追送（payload 内に `timestamp` がある） | `sensor_readings` に INSERT。`measured_at` には `payload.timestamp * 1000` を使う |
| `PROPERTY` | — | センサー / ゲートウェイの **現在値スナップショット または メタデータ**。payload のキーで処理を分岐（後述） | 後述「PROPERTY の payload 分類」参照 |
| `SERVICE` | `reboot` 等 | 運用イベント（再起動等） | 監査ログ（`audit_logs` or `device_service_logs`）|

### PROPERTY の payload 分類（重要）

PROPERTY は **payload のキー集合で 5 系統に分岐** する。仕分けバッチはこの分類に従って
更新先テーブル / フィールドを決める。

| payload のキー | 系統 | 我々の処理 |
|---|---|---|
| `temperature` / `humidity` | **環境計測** | `sensor_readings` に INSERT（`measured_at = data.ts`） |
| `battery` | **バッテリー残量** | `sensors.battery` を更新（同時に `sensor_readings.battery` に残しても良い） |
| `firmware_version` / `hardware_version` / `lorawan_class` | **デバイスメタ** | `sensors.firmware_version` 等のメタ列を更新（無ければ無視 or `sensors.metadata JSONB` に保存） |
| `sensor_enable` | **機能宣言**（例: `{humidity: true, temperature: true}`） | `sensors.capabilities` 等で保持。UI のセンサー詳細で「対応指標」表示に使える |
| `ipso_version` / `device_info` / `network_info` / `ups_info` 等 | **その他メタ** | 必要に応じて `gateways`/`sensors.metadata` に保存。読み取れない場合は素通し |

→ 仕分けロジックは `Object.keys(payload)` で判定。**未知のキーは黙って無視せず、
`webhook_inbox.parse_status='processed'` のまま `payload_raw` を保管しておく**
（後で再処理できるよう）。

### payload の例

#### センサー: `EVENT / historical_data`
```json
// type 1: 標準
{
  "humidity": 41.5,
  "temperature": 7.5,
  "timestamp": 1778233058     // epoch sec（センサー側の測定時刻）
}

// type 2: status フィールド付き（EM300-TH 等。Milesight Webhook Simulation で確認）
{
  "humidity": 37.5,
  "temperature": 16.3,
  "timestamp": 1773203105,    // epoch sec
  "status": false             // 真偽値。逸脱フラグの内蔵判定？
}
```
→ `sensor_readings` に `(devEUI, payload.timestamp * 1000, temperature, humidity)` を INSERT。
**注意**: `payload.timestamp` は **秒単位**（`data.ts` は ms 単位）。`* 1000` してから保存する。

#### センサー: `ONLINE`（実例: AM102 初回登録時）
```json
// data 構造: ts も payload も無し
{
  "type": "ONLINE",
  "deviceProfile": { "sn": "...", "name": "AM102", "model": "AM102", "devEUI": "...", ... }
}
```
→ `sensors.online_status='online'` 更新 + `gateway_status_events` 相当のログに「`eventCreatedTime`」をタイムスタンプとして INSERT。
**注意**: `data.ts` が無いので、ON/OFF 判定の時刻は `eventCreatedTime * 1000`（ms）を使う。

#### センサー: `PROPERTY` — メタ系の payload（実例: AM102 初回登録時）
```json
// IPSO バージョン
{ "ipso_version": 1 }

// 機能宣言（AM102 が温度・湿度センサーを持っていることを宣言）
{ "sensor_enable": { "humidity": true, "temperature": true } }

// バージョン情報 + LoRaWAN クラス
{
  "lorawan_class": "0",          // 文字列 "0" = Class A、"1" = Class B、"2" = Class C と推定
  "firmware_version": "v1.3",
  "hardware_version": "v1.2"
}
```
→ いずれも `sensor_readings` には INSERT しない。`sensors.metadata`（JSONB）等に
スナップショットを保管しておけば、サポート時に「このセンサーの FW バージョンは？」
を即答できる。`sensor_enable` は UI 側で「この機種は温度・湿度を扱う」を
表示する際の根拠データに使える。

#### センサー: `PROPERTY` — **環境/バッテリーは複数イベントに分割される**
```json
// 環境データ (eventId A, ts=1778254051673)
{ "humidity": 50.5, "temperature": 22.3 }

// バッテリー (eventId B, ts=1778254051673)  ★ 別イベント、同 ts
{ "battery": 86 }
```
**重要な発見**: PROPERTY は **指標ごとに 1 イベント** に分かれて届く。同じ瞬間（`ts` 同値）でも
`eventId` は別、payload のキーも別（環境用 / バッテリー用）。
→ 仕分けバッチでは `payload` のキー集合を見て、どの列を更新するか判断する:
- `temperature` / `humidity` を持つ → `sensor_readings` に INSERT
- `battery` を持つ → `sensors.battery` を更新（同時に `sensor_readings.battery` にも残してよい）
- 両方持たない（PIR など別種別）→ 該当 sensor_kind の専用テーブルに INSERT

「同じ ts でも 2 件来るので、どれを 1 行にまとめる？」を悩む必要はない。
**それぞれ別レコードとして扱い、UI 側で結合表示する** のが素直。

#### ゲートウェイ: `PROPERTY`（メタデータ）
```json
{
  "device_info": { "model": "UG65-L00J-915M-EA", "region": "AS923-1", ... },
  "network_info": { "wan_ip": "192.168.0.150", "cellular_status": "1", ... },
  "ups_info": { ... }
}
```
→ `gateways` のメタ列を更新（`gateways.online_status='online'`、IP・モデル詳細など）。
   `sensor_readings` は触らない（センサーじゃないので）。

### 冪等性キー

各イベントには `eventId` (UUID) が付くので、`webhook_inbox` に `(organization_id, event_id)` の
ユニーク制約を貼って **再送による重複取込を防止** する。仕分けバッチ側でも `eventId` を参照する。

**404 / 5xx 応答での再送挙動（実機検証済）**:
受信エンドポイントが **2xx 以外** を返すと Milesight は **同一ペイロードを連続再送** する。
Webhook Simulation で 3 回連続して同じ array が届いた事例を確認済み。
- 認証失敗（401）でも再送される → secret ローテーション中の取りこぼしを防ぐため、
  受信ハンドラは「**書き込みに成功したら 200 OK**」を貫く（401 は本当に侵害が疑わしいときだけ）。
- DB 書き込みに失敗したら 500 を返してわざと再送させる（冪等キーで重複は弾かれる）。

### 配列で複数件来る挙動

実例で観測されたパターン:
- 1 リクエストに **2 件**（同センサーの環境データ + バッテリー、同 `ts`）
- 1 リクエストに **16 件**（PROPERTY × 8 と EVENT/historical_data × 8、`ts` は様々）
  - センサーが復帰したときに、過去 N 分ぶんを PROPERTY と historical_data の **両方** で送ってくる
  - PROPERTY は古い `ts`（測定時刻）、historical_data は新しい `ts`（MDP の処理時刻）+ `payload.timestamp`（測定時刻 sec）
  - **同じ測定値が二重に届くこと** は前提として設計する。`measured_at` で UNIQUE INDEX を貼って
    最新を勝たせる or 最初を勝たせる（運用方針で決める）。
- 1 リクエストに 4 件（ONLINE + EVENT + ONLINE + PROPERTY）
- 1 リクエストに 1 件（SERVICE/reboot 単発）

#### 初回登録時のシーケンス（機種比較）

新規デバイスを MDP に追加して初回 Webhook 受信したときの観測。
**シーケンス全体の骨格は同じだが、POST 2 の中身に機種差** がある。

| ステップ | AM102 | EM320-TH-MAGNET |
|---|---|---|
| POST 1（0s） | `ONLINE` + `PROPERTY{ipso_version}` | `ONLINE` + `PROPERTY{ipso_version}` |
| POST 2（+19〜20s） | `PROPERTY{sensor_enable}` + `PROPERTY{lorawan_class, fw, hw}` | `PROPERTY{lorawan_class, fw, hw}` のみ |
| POST 3（+35〜39s） | `PROPERTY{humidity, temperature}` + `PROPERTY{battery}` | `PROPERTY{humidity, temperature}` + `PROPERTY{battery}` |
| 全体時間 | 約 35 秒 | 約 39 秒 |

→ admin 側 UX の含意:
- 「未登録 DevEUI として観測されたら **約 40 秒 待つ**」運用が現実的
- 最初に届くのが ONLINE / メタだけなので、温湿度を要求するロジックでは
  「PROPERTY/環境の最初の到着を待つ」を区別する必要がある

##### 機種差の注意点

- **`sensor_enable` は機種により省略される** — AM102 は宣言する（`{humidity: true, temperature: true}`）が、EM320-TH-MAGNET は宣言しない。`sensor_enable` を機能フラグとして UI で使うときは、無いときに `model` から推定するフォールバックが必須
- **`deviceProfile.model` は既に "結合済み" で届く** — 例: `"EM320-TH-MAGNET"`（納品 CSV では `model="EM320-TH"` + `realPn="Magnet"` を別フィールドで持っていて `buildEffectiveModel()` で結合していたが、**Webhook はそのまま結合済みで送ってくる**）。納品 CSV パーサの effectiveModel 算出ロジックは Webhook 受信形と一致することを実機確認済み
- **`deviceProfile.name` は常に MDP 登録者の手入力** — プラットフォームの自動補完は **無い**。
  - 例: EM320-TH → "1 原料冷蔵庫"（業務名を意図的に入力）
  - 例: AM102 → "AM102"（運用者がモデル名をそのまま入力。便宜的なプレースホルダー）
  - 「モデル名と一致しているからシステムが補完した値」という解釈はできない（運用者の選択次第）
  - **マスタ照合キーには使わない**（MDP 上で書き換え可能、業務名 ↔ モデル名の揺れもあり得る）
  - 初回登録時のサジェスト値としては使えるが、ミテルデ側でも **書き換え自由 / 別名管理** にしておくのが安全

Webhook 受信エンドポイントは配列の各要素を **1 行ずつ `webhook_inbox` に INSERT** する。
配列単位のトランザクションにすると 1 件壊れた時に全件失敗するので、要素単位で扱う。

### 観測された測定値の重複パターン

CBO-026 復帰時の payload 抜粋（同一リクエスト内）:

| 種別 | data.ts | payload.timestamp | temperature | humidity |
|---|---|---|---|---|
| PROPERTY | 1773192305000 ms | — | 16.9 | 36.0 |
| EVENT/historical_data | 1778254010521 ms | 1773192305 sec | 16.9 | 36.0 |

→ 同じ測定値（temp 16.9, hum 36.0）が `data.ts` 違いで 2 回入る。
- PROPERTY 側の `data.ts` は **測定時刻**（過去）
- historical_data 側の `data.ts` は **MDP 処理時刻**（現在）。`payload.timestamp` が測定時刻
- **どちらを採用するか**: `payload.timestamp` があればそれ、なければ `data.ts` を `measured_at` に使うのが安全。
  両方を別行として保存すると重複データになる → 仕分けバッチで「同じ devEUI × `measured_at`」は
  1 行に統合する規則にする。

### `deviceProfile.name` について

`deviceProfile.name` は **MDP 登録時に運用者が手で入れた値** で、プラットフォームの自動補完は無い。
入力する内容はテナントの運用ポリシー次第で、観測例:

- 業務名: `"1 原料冷蔵庫"`, `"CBO-039"`, `"CBO-040"`, `"CBO-026"` など
- モデル名そのまま: `"AM102"`, `"EM320-TH"`（命名する手間を省いて型番を入れたケース）

**マスタ照合キーとしては使わない** 方針:
- 名前は MDP 上で書き換え可能 → 照合の安定性が損なわれる
- ミテルデ側で別の命名（フロア名など）を付けたい場合に上書きされると困る
- 「モデル名と一致しているから自動入力された値」とは断定できない（運用者の選択次第）

→ 初回登録時の **サジェスト値** としてだけ使う。マスタ確定後はミテルデ側の `name` / `deviceNumber` を正とする。

---

## 変更履歴

| 日付 | 内容 |
|---|---|
| 2026-05-05 | 初版作成（Phase 1〜9 完了後の設計合意） |
| 2026-05-08 | `database-schema.md` との整合性を取り、テーブル名・概念を統一。<br>主な変更: `raw_events` → `webhook_inbox` / `readings` → `sensor_readings` / `milesight_applications` → `manufacturer_integrations` / `alert_states + alerts` → `alert_logs`（フラット化）/ `device_eui` → `serial_number` / `sensor_status` enum → `name IS NULL` 規約。Phase 番号も A〜G 体系（F-1〜G-2）に再編。 |
| 2026-05-08 | **マスタ運用方針を全面変更**: 顧客は自由にデバイス追加できない設計に統一。<br>1. 顧客側「未割り当てセンサー」UI を廃止 → admin の事前手動登録に一本化<br>2. Webhook 受信は `webhook_inbox` に積むだけ（マスタ照合は **5 分 cron バッチ** でまとめて）<br>3. 未登録 DevEUI は自動登録せず `parse_status='unmatched'` で残す → admin が「未登録 DevEUI キュー」から claim、過去ぶんも遡及反映<br>4. 「今すぐ更新」手動ボタンで即時バッチ起動（テスト・デバッグ用）<br>5. CSV インポートを 3 ルートに整理: (8.A) テナント単発 / (8.B) 移行用 admin / (8.C) モック開発用<br>6. 付録 E に Milesight 純正クラウド出力 CSV のフォーマット仕様（BOM・単位文字・メタ情報なし問題）を追記 |
| 2026-05-08 | **CSV インポートを admin 専用に一本化**。<br>1. 顧客側 (テナント単発 CSV) UI は廃止（admin が impersonation で対応する運用に倒す）<br>2. 移行用 CSV は **複数ファイル一括 + 自動マッチング + プレビュー → 確定** の 4 ステップフローに具体化<br>3. ファイル名 `CK01:...csv` 等から `sensors.deviceNumber` を推定して紐付けサジェスト、admin が手動上書き可能<br>4. センサー一覧グリッドは読み取り専用のまま（行ごとの CSV アイコンは置かない）<br>5. 監査ログは `migration_started` / `csv_import_by_admin` / `migration_finished` の 3 種類 |
| 2026-05-08 | **`sn` と `devEUI` を別フィールドに分離**。実 Webhook ペイロードを確認した結果、Milesight は `sn`（製造シリアル）と `devEUI`（LoRaWAN 識別子）を別々で持っているため、`sensors.serialNumber` (sn) と `sensors.devEUI` を両方持たせる。Webhook 受信時の sensors マスタ照合キーは `devEUI`。csvMigration の自動マッチング順位も deviceNumber → devEUI → serialNumber → name に拡張。Gateway も同様に両フィールド保持。 |
| 2026-05-08 | **付録 F: Milesight Webhook ペイロード仕様** を追加。`eventType=DEVICE_DATA` 配下の `data.type` 種別（ONLINE / OFFLINE / EVENT(historical_data) / PROPERTY / SERVICE）と各 payload 形式、`eventId` を冪等性キーに使う方針を明文化。 |
| 2026-05-08 | Admin Console > テナント詳細 > センサータブ / ゲートウェイタブに **追加メニュー** を実装（mock）。<br>- 「1 件追加」: 単発フォーム<br>- 「一括追加」: TSV/CSV 貼付 + プレビュー + 衝突検知 + 確定<br>- 「移行モードを開始」: 既存システム CSV 一括取り込み（センサータブのみ）<br>常時表示の idle 移行パネルは廃止し、kebab メニューに集約。 |
| 2026-05-08 | **センサーのゲートウェイ指定を任意化**。Milesight は近隣の GW が自動で受信する仕様のため、センサー登録時の GW 紐付けは必須にしない。指定された場合のみ存在チェック。 |
| 2026-05-08 | **「Milesight 納品 CSV を取り込む」** 機能を追加（mock）。発注時に Milesight から納品される 33 列の SN リスト CSV をそのまま投入できる。<br>- 複数行レコード対応の RFC 4180 風 CSV 状態機械パーサ（`milesightDeliveryCsv.ts`）<br>- モデル列から `sensor` / `gateway` を自動分類（UG65 / UG63V2 → GW、EM320-TH / FT101 → センサー）<br>- realPn を組み合わせた effective model 算出（"EM320-TH" + "Magnet" → "EM320-TH-MAGNET"）<br>- 1 ファイルでセンサー + GW を同時にコミット。監査ログに `delivery_csv_imported_by_admin` を記録 |
| 2026-05-09 | **Phase F-3 mock: 未登録 DevEUI（unmatched）UI** を実装。<br>1. `webhookInbox.ts` に localStorage `miterude:admin:webhook_inbox` を構築（`pending` / `processed` / `unmatched` / `ignored` の 4 状態）<br>2. テナント詳細 > センサータブに「未登録 DevEUI が N 件あります」セクション。各行で「このテナントに登録」「無視（誤送信）」を選択可<br>3. 「このテナントに登録」は `CreateSensorDialog` を **DevEUI プリセット**（読み取り専用）で開き、登録後に同 DevEUI の unmatched を `pending` に戻して即時バッチ実行（遡及反映）<br>4. kebab メニューに「今すぐ仕分けバッチを実行」（pending → processed/unmatched）と「擬似 Webhook を 5 件投入」（モック検証用）を追加<br>5. Admin サイドバー「テナント」項目に **未登録件数バッジ**（赤）を追加。テナント横断の DevEUI ユニーク数を表示<br>6. 監査ログに `webhook_inbox_processed_manually` / `mock_webhooks_seeded` / `unmatched_dev_eui_ignored` を記録 |
| 2026-05-09 | **Phase F-2 mock: Milesight 連携設定タブ** を追加。テナント詳細に「Milesight 連携」タブを 1 つ増やし、以下を表示。<br>- テナント固有 Webhook URL（`/api/webhooks/milesight/{org_id}`、コピーボタン付き）<br>- `X-Webhook-Secret`（48 字 hex、表示 / 隠す / コピー / 再発行）<br>- 連携の有効 / 停止スイッチ（`manufacturer_integrations.enabled`）<br>- 直近 50 件の Webhook イベント（受信時刻 / DevEUI / イベント / 状態ピル）<br>localStorage `miterude:admin:manufacturer_integrations` に `{orgId}::Milesight` をキーで保存。監査ログに `milesight_secret_regenerated` / `milesight_integration_enabled` / `_disabled` を記録 |
| 2026-05-09 | **MDP Webhook Simulation の実データ確認に基づき付録 F を更新**。<br>1. **PROPERTY は指標ごとに分割**: 環境データ `{humidity, temperature}` とバッテリー `{battery}` は **別 eventId** で 1 リクエスト内に並んで届く（同 `ts`）。仕分けバッチは payload のキー集合で更新先を判断する<br>2. **historical_data の重複データ**: センサー復帰時、過去 N 分ぶんが PROPERTY（古い `data.ts`）と EVENT/historical_data（新しい `data.ts` + `payload.timestamp` sec）の両方で送信される。`measured_at` は `payload.timestamp * 1000` を優先し、(devEUI, measured_at) で UNIQUE INDEX を貼って重複を統合<br>3. **404/401/5xx はリトライされる**: 受信ハンドラは「書き込みに成功したら 200 OK」を貫く（実機でも 404 → 同一ペイロード 3 連送を確認）<br>4. **`payload.timestamp` は秒単位** で `data.ts`（ms）と単位が違う点を強調<br>5. **`deviceProfile.name`** はマスタ照合キーには使わない（MDP 上で変更可）。初回登録のサジェスト値だけに留める<br>6. モックの `seedMockWebhooks` も実構造に合わせ、PROPERTY を環境用 + バッテリー用の 2 件に分割（30% で historical_data も 1 件追加）|
| 2026-05-09 | **アラート除外時間帯（exclusion windows）を実装**。<br>背景: (1) 飲食店の営業時間外で冷蔵庫の電源を切るため毎晩温度逸脱、(2) 食品工場の夜間扉閉めで電波が通らずオフライン誤報、といった「予期される逸脱」で本物のアラートが埋もれる課題。<br>1. `AlertExclusionWindow` 型を追加（`startTime` / `endTime` "HH:MM" + `daysOfWeek[]` + 抑制対象 `targets[]`）。日跨ぎは `startTime > endTime` で表現し、曜日判定は **窓の開始日基準**<br>2. `src/lib/alertExclusion.ts` に `isInExclusionWindow` / `isAlertSuppressed` を実装<br>3. `judgeReadingForAlerts` / `judgeBatteryForAlerts` / `judgeOfflineTransitionAlert` の冒頭で除外時間判定を呼び、該当時はアラート生成自体をスキップ<br>4. センサー詳細 > アラート設定パネルに「アラートを止める時間帯」セクションを追加。複数窓登録可、各窓で「毎日 / 平日のみ / 土日のみ / 個別曜日」「逸脱 / オフライン / バッテリー」を独立に選べる<br>5. 既定値: 22:00 → 08:00 / 毎日 / 逸脱 + オフライン抑制（MVP として無難なテンプレ）|
| 2026-05-09 | **連続逸脱の "今" インジケータを追加**。アラート発生条件パネル内、「何回連続で発動するか」設定の真下に、直近 readings から導出した現状をリアルタイム表示。<br>1. `computeCurrentDeviationStreak(sensor, readings)` ヘルパを `alertLog.ts` に追加（直近サンプルから遡って連続逸脱回数 / レベル / 起点 / 除外時間該当を返す純関数）<br>2. UI: 4 状態を色分け表示<br>　- データなし → グレーで「計測データがないため判定できません」<br>　- 正常 → 緑で「✓ 直近のサンプルは正常範囲内」<br>　- 積算中 → 黄/赤で「▲ 現在 N 回連続で逸脱中。あと M 回でアラートが発動します」<br>　- 発動中 → 赤で「● 現在 N 回連続で逸脱しています。基準を満たしているためアラートが発動しています」<br>3. 除外時間中は併記で「（除外時間中のためこの連続はアラートを発動しません）」を出す。除外設定が効いている事を顧客自身が確認できる<br>4. 副次修正: `sensorRegistration.commitSensorDrafts` の `alertSettings` が必須フィールドを欠いていたバグを `defaultAlertSettings()` 呼び出しに修正（pre-existing AlertSettings type error の解消） |
| 2026-05-09 | **除外日設定 + センサー設定テンプレートの拡張**。<br>背景: (1) 年末年始や故障修理など特定日付の抑制が必要、(2) アラート設定項目が増えたため一括適用したい。<br>1. **除外日 (`AlertExclusionDate`)** を `AlertSettings.exclusionDates` に追加。`startDate` / `endDate` （"YYYY-MM-DD"、両端含む）+ `targets[]`。`isAlertSuppressed` が時間帯と日付の両方を OR で評価<br>2. **`ThresholdTemplate` を `SensorSettingsTemplate` へ拡張**（後方互換用に旧名はエイリアス）。`scope` フィールドで 4 項目（閾値判定 / アラート発生条件 / 除外時間・日 / 通知設定）を選択的に含められる<br>3. ストレージ load 時に `migrateTemplate()` で旧テンプレ（scope なし）→ scope = { thresholds: true } に自動マイグレーション<br>4. テンプレ編集ダイアログを 4 スコープ対応に刷新（チェックで ON/OFF できる折り畳みセクション）<br>5. 一括適用ダイアログのモード名を「閾値一括変更」→「テンプレート適用」に変更。テンプレ選択時に「適用対象: ○○」の説明を出す<br>6. `applyTemplateToSensor(sensor, template)` ヘルパを追加。scope に応じて in-scope の項目だけ上書きし、それ以外はセンサーの既存値を維持<br>7. Admin の CreateSensorDialog にテンプレート選択を追加。新規追加と同時にテンプレ適用が可能<br>8. 除外時間・除外日のエディタは `AlertExclusionEditors.tsx` に切り出し、SensorAlertSettings とテンプレ編集ダイアログの両方から再利用 |
| 2026-05-09 | **センサー詳細画面のレイアウト圧縮**。アラート設定が増えて画面が縦長になっていた問題に対する集約整理。<br>1. **タブ分割**: センサー詳細を「基本情報（センサー情報＋分類）」と「アラート設定（テンプレ読み込み＋逸脱判定＋発生条件＋除外＋通知）」の 2 つに分割<br>2. **テンプレート読み込みをセンサーレベルに昇格**: 旧 `SensorThresholdSettings` の中にあった「テンプレートから読み込み」ボタンを、アラート設定タブ最上部の独立カードへ移動。スコープ拡張に合わせて、選択時にすべての in-scope 項目を一括適用するように変更（`hideTemplatePicker` prop で旧位置のボタンは非表示化）<br>3. **除外時間 / 除外日エディタをコンパクト化**: 各カードはデフォルト折り畳み・1 行表示。ヘッダ内に「有効化チェック・名称インライン入力・サマリ・抑制対象ピル・展開・削除」を横並び。展開時は時間帯と曜日を 1 行に集約。新規追加した項目だけ自動展開<br>4. **逸脱判定を 2 カラム化**: 温度・湿度を縦区切り線つきで横並び表示。画面幅が狭いときは CSS で自動的に縦積みに戻る<br>結果: 除外日が 5 件あっても画面内に収まり、追加されても折り畳み 1 行ぶんしか伸びない |
| 2026-05-09 | **AM102 実 Webhook データ確認に基づき付録 F を更新**。新規デバイス初回接続時のシーケンスから判明した内容を反映。<br>1. **`ONLINE` イベントの実物**: `data.ts` も `payload` も無く、`eventCreatedTime` のみが時刻情報。判定時刻は `eventCreatedTime * 1000`（ms 換算）を使う<br>2. **PROPERTY の 5 系統分類**: payload キーで分岐 — 環境計測（`temperature`/`humidity`）/ バッテリー（`battery`）/ デバイスメタ（`firmware_version`/`hardware_version`/`lorawan_class`）/ 機能宣言（`sensor_enable: {humidity, temperature}`）/ その他メタ（`ipso_version`/`device_info` 等）<br>3. **初回登録シーケンス**: ONLINE → ipso_version → sensor_enable → versions → 環境 → battery が **約 35 秒に渡って 3 回の POST に分散** して届く。admin UX の「未登録 DevEUI 待機」運用に直結<br>4. **`sensor_enable`** は UI 側で機能フラグとして使える（その機種が温度・湿度を扱うかを宣言）<br>5. `firmware_version`/`hardware_version` は `sensors.metadata` JSONB に保存しておくと、サポート時に即答できる |
| 2026-05-09 | **EM320-TH-MAGNET の Webhook も実機確認**。AM102 との比較で機種差を明示。<br>1. **基本シーケンスは同じ** だが POST 2 の中身が機種で違う: AM102 は `sensor_enable` を宣言、EM320-TH-MAGNET は省略<br>2. **`deviceProfile.model` は結合済み形式で届く**: 例 `"EM320-TH-MAGNET"`。納品 CSV では `model="EM320-TH"` + `realPn="Magnet"` を別カラムで持って `buildEffectiveModel()` で結合する設計だったが、**Webhook はそのまま結合済みで送ってくる**ことを確認 → 既存ロジックが正しいと裏取り<br>3. **`deviceProfile.name` は常に MDP 登録者の手入力** で、プラットフォームの自動補完は無いことを実機確認。業務名（"1 原料冷蔵庫"）でもモデル名（"AM102"）でも入れられるため、「モデル名と一致しているから自動入力された値」とは断定できない。マスタ照合キーには使わない方針が正解。初回登録時のサジェスト値としてだけ使う<br>4. 全体時間は機種差あり（AM102: 35s, EM320-TH: 39s）。admin UX「未登録 DevEUI 観測後は約 40 秒待つ」が実用基準 |
| 2026-05-09 | **生 Webhook payload の保管 + 表示を実装（モック）**。実バックエンドの `webhook_inbox.payload_raw JSONB` 相当を、モック側でも持てるように対応。<br>1. **`MilesightRawEvent` 型を追加** — 実機観測の Milesight 形式（`{ data:{ts,type,payload,deviceProfile}, eventId, eventType, eventVersion, eventCreatedTime }`）<br>2. **`WebhookInboxItem.payloadRaw`** に 1 イベントぶんの生 JSON を保持。実 Supabase 移行時に `payload_raw JSONB` カラムへそのままマップ可能<br>3. **`buildRawEvent()` ヘルパ** で seeder が実機通りの JSON を生成 — `seedFirstConnectSequence` は ONLINE（`ts` なし）/ ipso_version / sensor_enable / versions / 環境 / battery を完全な形で投入。`seedMockWebhooks` は環境 + バッテリー（同 `ts`/別 `eventId`）+ historical_data（`payload.timestamp` 秒）<br>4. **Milesight 連携タブのイベント表に「詳細」列を追加** — クリックで `<dialog>` が開き、ダーク背景の `<pre>` で生 JSON を整形表示。受信時刻 / eventId / 状態 / マッチ先 sensor_id をメタとして併記。「JSON をコピー」ボタンも提供<br>5. これにより、実バックエンド着手前の段階で「Webhook で何が届いたか」を完全な形で見返せるため、パース失敗時の調査・現場でのトラブル切り分けの UX を mock で先取りできる |
| 2026-05-09 | **テナント側「連携設定」を運営側専用に整理**。連携の有効化や受信シークレットの設定は admin 専用にして、テナント側は **連携状況の閲覧と対応機種一覧** に絞り込む方針へ変更。<br>1. **タブ統合**: 旧「連携設定」+「対応デバイス」を **「連携状況・対応機種」 1 タブ** に統合。タブ数を 4 → 3 に削減<br>2. **編集 UI を全削除**: `ManufacturerIntegrationDialog` 呼び出しと `onUpdateIntegration` props / `handleUpdateIntegration` を撤去。シークレット表示・ON/OFF トグル・取扱種別編集はテナント側からは完全に消える<br>3. **メーカー単位の状況可視化**: メーカーセクションごとに「対応中 / 対応予定」（機種マスタ）+「連携中 / 停止中」（テナント単位の `manufacturer_integrations.enabled`）の 2 種バッジを並べて表示<br>4. **対応機種カードに登録台数を追加**: `Sensor.model` / `Gateway.model` を SUPPORTED_DEVICES と prefix 一致で照合（EM320-TH-MAGNET も EM320-TH のカウントに合算）。「3 台が登録中」or「未登録」を機種カード下部に表示。対応予定機種ではカウント非表示<br>5. **CSV インポートボタンを連携カードから除去**（センサー一覧側に既にあるため重複していた）<br>6. テナント側の不要 props（`devices` / `onDevicesChange` / `onUpdateIntegration`）と未使用ヘルパ（`upsertIntegration`）を削除 |
| 2026-05-09 | **MDP の Application 設定を再確認した結果、付録 5 を更新**。<br>1. **Webhook URL はテナントごとパスパラメータ方式（`/api/webhooks/milesight/{org_id}`）を採用** することを明示。Vercel/Next.js の動的ルートで追加実装ゼロ。共通 URL + UUID 仕分け案との比較表を追加<br>2. **Webhook UUID の扱い** を文書化: コールバック URI とは独立した補助識別子。`manufacturer_integrations.webhook_uuid` に保存し、受信時の三段目の検証 + Admin 監査表示に使う<br>3. **Open API（Authentication 設定）の存在を Section 5.4 に追記**: Webhook と反対方向の通信路。デバイス一覧同期 / リモート設定変更 / 再起動指令 / 過去データ pull 等で将来活用可。**MVP には不要**で Phase G-2 で検討<br>4. **Request Restriction（IP allowlist）の対応方針**: Vercel Functions の egress IP が不安定なため、Open API を使うフェーズで Static IP / NAT Gateway 経由を検討する旨を明記 |
| 2026-05-09 | **Admin の連携設定タブを再構成**。MDP 仕様に合わせた手入力フローへ。<br>1. **タブ並び替え**: 契約情報 → **連携設定** → センサー → ゲートウェイ → メンバー / サポート → 監査ログ。「Milesight 連携」を「連携設定」に改称し、契約情報の直後に配置<br>2. **メーカー単位の sub-tabs**: 連携設定タブ内に「Milesight」「IoT Mobile」のインナータブを追加。今後対応メーカー増加時はタブを追加するだけで対応可能<br>3. **Milesight タブを UUID + Secret 手入力式に変更**: ミテルデ側でシークレット自動生成する旧設計を廃止し、MDP 上で発行された UUID と Secret を admin が貼り付けて保存する形に。`ManufacturerIntegration.webhookUuid` カラムを追加。`updateMilesightCredentials(orgId, {uuid, secret})` ヘルパで部分更新<br>4. **IoT Mobile タブはプレースホルダ**: 「今後対応予定」のメッセージのみ<br>5. **受信ログにページネーション + 期間フィルタ**: 期間（From/To 日付）で絞り込み + 25/50/100 件/ページ + 前後・先頭末尾ページャ。「1-25 件 / 全 99 件」のサマリ表示<br>6. 監査ログ action: `milesight_credentials_updated` を追加（旧 `milesight_secret_regenerated` は廃止） |
| 2026-05-09 | **連携の「停止 / 有効化」トグルを撤去**。「Secret が保存されていれば連携中、空なら停止中」の単純化。<br>1. `ManufacturerIntegration.enabled` フィールドを型から削除<br>2. `setMilesightEnabled` / `handleToggleEnabled` を削除。Admin UI のトグルボタンも撤去<br>3. テナント側 `SettingsView` の「連携中 / 停止中」バッジは `webhookSecret` の有無で判定するように変更<br>4. `buildDefaultIntegrations` から `enabled` フィールドを除去。旧データの enabled は storage 読み込み時に静かに drop（マイグレーション）<br>5. 不要になった `ManufacturerIntegrationDialog` コンポーネントを削除<br>判断根拠: ライセンス期限切れ等で連携を一時停止したい運用シーンが想定しにくく、「再開時に過去データも追加で入っていてくれた方が嬉しい」という要件のもと、受信は常時 ON のままにする方針。停止が本当に必要なときは Secret を一時退避すれば代替可能 |
| 2026-05-09 | **CreateSensorDialog（センサー 1 件追加）を「対応マスタ駆動」に再設計**。<br>**ユーザが触れる項目を 3 つに絞る**: ID（デバイス番号）/ 表示名 / テンプレート。<br>1. **メーカー / モデルを選択式（cascade）に**: 自由入力を廃止。`SUPPORTED_DEVICES` の `supported=true && category='sensor'` のみ。メーカー → モデルの順で連動セレクト。`supportedManufacturers()` / `supportedSensorModelsByManufacturer(key)` ヘルパを追加<br>2. **種別 (kind) はモデルから自動決定**: 編集不可の表示専用に。`SupportedDevice.kind` を新設し、`inferSensorKindFromModel(model)` で引く<br>3. **ゲートウェイ項目を削除**: Milesight MDP に対応設定が無いため、UI から完全撤去。`SensorDraft.gatewayId` は内部で常に空文字を渡す<br>4. **未登録 DevEUI からの登録（preset あり）はさらに固定**: シリアル / DevEUI / モデル / メーカー / 種別の 5 つすべてが read-only ラベル表示に。値は `payloadRaw.data.deviceProfile` から自動で引く<br>5. `UnmatchedSummary` に `sn` / `manufacturer` を追加。`onRegister(devEUI)` から `onRegister(summary)` へ拡張<br>6. `CreateSensorPreset` 型を新設（`{ devEUI, serialNumber?, model?, manufacturer? }`）。旧 `presetDevEUI: string` API を置換 |
