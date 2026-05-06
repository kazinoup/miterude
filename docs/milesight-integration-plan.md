# ミテルデ × Milesight Webhook 連携 実装計画

> **対象**: ミテルデ (温湿度モニタリング SaaS) の Phase 10 以降の実装計画書
> **最終更新**: 2026-05-05
> **状態**: 設計フェーズ。実装着手前の合意ドキュメント。

---

## 0. このドキュメントの位置付け

ミテルデは現在、React + Vite + localStorage で動作する**フロントエンド完結のモック**です。
Phase 10 以降では、これを **Milesight Development Platform (MDP) からの Webhook を受信して、リアルタイムに温湿度を監視する本番アプリ**へと進化させます。

本ドキュメントは、その実装に着手する前に**設計と決定事項を文章として固める**ことを目的とします。
実装中はここを起点に作業を進めてください。

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
            │  - raw_events に INSERT のみ             │
            │  - **即 200 OK 返却**                    │
            └──────────────────┬───────────────────────┘
                               │
                               ▼
            ┌──────────────────────────────────────────┐
            │  Supabase Postgres                       │
            │  ┌────────────────┐                      │
            │  │ raw_events     │ ← 全 payload を生で  │
            │  │ (jsonb)        │   保管               │
            │  └────────┬───────┘                      │
            │           │ Edge Function (cron 1min)    │
            │           ▼                              │
            │  ┌──────────────────┐                    │
            │  │ readings (TS)    │ ← TimescaleDB     │
            │  │ sensors          │   hypertable      │
            │  │ alert_states     │                   │
            │  │ alerts           │                   │
            │  └────────┬─────────┘                   │
            │           │ Realtime Channel (WebSocket)│
            │           ▼                              │
            │  ┌──────────────────┐                    │
            │  │ Alert Evaluator  │                    │
            │  │ Notif Dispatcher │ → メール/Slack/    │
            │  │ (cron 1min)      │   Webhook          │
            │  └──────────────────┘                    │
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

## 4. データベーススキーマ

### 4.1 テーブル一覧

```
organizations           ─ テナント (Clerk org と1:1)
milesight_applications  ─ Milesight App との接続情報 (テナントと1:1)
sensors                 ─ センサー (status で未割当を区別)
gateways                ─ ゲートウェイ
raw_events              ─ Webhook 生 payload (冪等性キー付き)
readings                ─ 正規化された時系列計測 (TimescaleDB hypertable)
alert_states            ─ センサー別の連続カウンタ・現在のアラート
alerts                  ─ 個別のアラート (open/resolved 状態)
notification_dispatches ─ 通知のスケジュール (バッチ通知の集約)
notification_groups     ─ 通知グループ (Phase 7 既存)
dashboards              ─ ダッシュボード (Phase 9 既存)
checkins                ─ 確認チェックイン (Phase 8 既存)
sensor_notes            ─ センサー運用メモ (Phase 8 既存)
```

### 4.2 主要 DDL（提案）

```sql
-- =========== Tenant ===========
create table organizations (
  id uuid primary key default gen_random_uuid(),
  clerk_org_id text unique not null,
  name text not null,
  created_at timestamptz not null default now()
);

-- =========== Milesight Application Mapping ===========
create table milesight_applications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  app_name text not null,
  webhook_secret text not null,           -- ミテルデが生成、MDPの「Secret」に貼る
  -- 双方向連携(OpenAPI)用
  client_id text,
  client_secret text,
  server_address text,                    -- 例: https://sg-openapi.milesight.com
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id)                 -- 1:1
);

-- =========== Sensors ===========
create type sensor_status as enum ('unassigned', 'assigned', 'archived');

create table sensors (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  device_eui text not null,               -- Milesight DevEUI (24E124...)
  serial_number text,
  model text,                             -- 'EM320-TH', 'EM300-TH', etc.
  manufacturer text default 'Milesight',
  gateway_id uuid references gateways(id),
  display_name text,                      -- ユーザー命名 ('3F肉用冷蔵庫'). NULLなら未命名
  status sensor_status not null default 'unassigned',
  battery int,                            -- 0-100
  online boolean default false,
  last_seen_at timestamptz,
  registered_at timestamptz not null default now(),
  alert_settings jsonb not null default '{}'::jsonb,
  notification_group_id uuid references notification_groups(id),
  unique(organization_id, device_eui)
);
create index on sensors (organization_id, status);

-- =========== Raw Webhook Events (冪等性 + スキーマ探索) ===========
create table raw_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  source text not null default 'milesight',
  idempotency_key text not null,          -- payload内のevent_id等から算出
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  processing_error text,
  unique(organization_id, idempotency_key)
);
create index on raw_events (organization_id, received_at desc);
create index on raw_events (processed_at) where processed_at is null;

-- =========== Time-series Readings ===========
-- TimescaleDB hypertable (要 Supabase 上で extension 有効化)
create table readings (
  id uuid not null default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  sensor_id uuid not null references sensors(id) on delete cascade,
  measured_at timestamptz not null,       -- パーティションキー
  temperature numeric(6, 2),              -- ℃
  humidity numeric(5, 2),                 -- %RH
  battery int,
  raw_event_id uuid references raw_events(id),
  primary key (id, measured_at)           -- timescale 要件
);
select create_hypertable('readings', 'measured_at');
create index on readings (sensor_id, measured_at desc);

-- =========== Alert State Machine ===========
create type alert_metric as enum ('temperature', 'humidity', 'offline');
create type alert_status as enum ('open', 'resolved');

create table alert_states (
  sensor_id uuid not null references sensors(id) on delete cascade,
  metric alert_metric not null,
  consecutive_count int not null default 0,
  last_evaluated_at timestamptz,
  current_alert_id uuid,                  -- references alerts(id), nullable
  primary key (sensor_id, metric)
);

create table alerts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  sensor_id uuid not null references sensors(id) on delete cascade,
  metric alert_metric not null,
  direction text,                         -- 'above' | 'below'
  started_at timestamptz not null default now(),
  resolved_at timestamptz,
  status alert_status not null default 'open',
  trigger_value numeric,
  threshold_min numeric,
  threshold_max numeric,
  consecutive_count_at_trigger int,
  notification_group_id uuid references notification_groups(id)
);
create index on alerts (organization_id, status, started_at desc);

-- =========== Notification Dispatches (集約配信) ===========
create type dispatch_status as enum ('pending', 'sent', 'failed', 'cancelled');

create table notification_dispatches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  notification_group_id uuid not null references notification_groups(id),
  alert_ids uuid[] not null,
  scheduled_for timestamptz not null,
  sent_at timestamptz,
  status dispatch_status not null default 'pending',
  failure_reason text
);
create index on notification_dispatches (status, scheduled_for);
```

### 4.3 RLS（Row Level Security）方針

すべてのテーブルに以下のポリシーを基本適用：

```sql
-- 例: sensors テーブル
alter table sensors enable row level security;

create policy "tenant_isolation_select"
  on sensors for select
  using (
    organization_id in (
      select id from organizations
      where clerk_org_id = (auth.jwt() ->> 'org_id')
    )
  );
-- insert/update/delete も同様
```

**注意**: Webhook 受信 API は **service_role キー**で動作させ、RLS をバイパスする。テナント分離は API ルート側のロジックで担保（URL の `org_id` + secret 検証）。

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
- `X-Webhook-Secret`: テナントごとに発行されたシークレット。`milesight_applications.webhook_secret` と照合
- リクエストボディは Milesight が決める形式（実物の JSON 構造は探索フェーズで把握）

### 5.2 受信ハンドラの責務（最小化）

```
1. Header の secret 検証 → 不一致なら 401
2. body から idempotency_key を算出
   ┌ event_id があれば: hash(org_id, event_id)
   └ なければ:           hash(org_id, payload全体, received_minute)
3. raw_events に INSERT (重複なら ON CONFLICT DO NOTHING)
4. 200 OK を即返却
   ※パース・正規化・アラート評価は一切行わない
```

これにより応答時間は概ね**100ms以下**に抑える。Milesight 側のタイムアウトと再送ループを回避。

### 5.3 受信レスポンス

```
HTTP/1.1 200 OK
Content-Type: application/json

{ "ok": true }
```

400/401/500 を返すと Milesight 側がリトライしてくる。重複は冪等性で排除されるので問題なし。

---

## 6. マルチテナント運用フロー

### 6.1 想定される運用ステップ

ユーザー（自社）が新規組織を導入するときのフロー：

```
1. [自社] Clerk で組織を作成 → ミテルデにテナントが生まれる
2. [自社] MDP で Application を新規作成（テナント名と同じ名前）
3. [自社] MDP の "Devices" にセンサー（EM320-TH, UG65 等）を追加し、
          作成した Application に割り当て
4. [自社] ミテルデ管理画面の「設定 → デバイス連携 → Milesight」に行き、
          そのテナント用の **Webhook URL** と **Secret** を取得
5. [自社] MDP の Application Settings に
          - Callback URI を貼り付け
          - Secret を貼り付け（双方向に同じ値）
          - Webhook を Enable
          - 「Test」ボタンで疎通確認 (WEBHOOK_TEST が来る)
6. [自社] センサーの電源を入れて、ゲートウェイ経由で MDP に登録
7. [自動] MDP がセンサーデータを Webhook で送信開始
8. [自動] ミテルデが受信、未登録なので sensors に
          `status='unassigned'` で自動登録、readings に蓄積開始
9. [顧客] ミテルデの「未割り当てセンサー」一覧から、
          DevEUI を見て "3F 肉用冷蔵庫" などと命名
10. [顧客] 命名済センサーをダッシュボードに紐付けて運用開始
```

### 6.2 自社が管理するもの・顧客が管理するもの

| 管理者 | 担当範囲 |
|---|---|
| **自社（オペレーター）** | MDP のデバイス・アプリケーション登録、ハードウェア発送、ミテルデのテナント初期作成 |
| **顧客（テナント管理者）** | 未割当センサーの命名・ダッシュボード作成・通知設定・確認運用 |

これにより**顧客が自由にデバイスを追加できないが、運用に必要な操作は顧客側で完結**する設計になる。

---

## 7. アラート設計（2 軸）

### 7.1 設計の2軸

| 軸 | 設定の所在 | 役割 |
|---|---|---|
| **判定** | センサーの `alert_settings.deviationConsecutiveCount` | 連続 N 回の逸脱で初めてアラート確定 |
| **通知** | 通知グループの `timing` | 即時/1h/6h/12h/24h でまとめ送信 |

### 7.2 判定アルゴリズム

```
[新しい reading が到着]
        ↓
[逸脱判定]
   reading.value vs 閾値（区分=冷蔵/冷凍/室温で異なる）
        ↓
[alert_states の連続カウンタ更新]
   逸脱なら +1、正常なら 0 にリセット、last_evaluated_at 更新
        ↓
[アラート確定判定]
   if (consecutive_count >= sensor.deviationConsecutiveCount
       AND alert_states.current_alert_id IS NULL):
       → alerts に新規 INSERT (status='open')
       → alert_states.current_alert_id 更新
       → 通知ディスパッチをスケジュール

   if (逸脱が解消 AND alert_states.current_alert_id IS NOT NULL):
       → alerts.resolved_at, status='resolved'
       → alert_states.current_alert_id = NULL
       → 解消通知もスケジュール
```

### 7.3 通知ディスパッチ

```
[1分おきに動く cron ジョブ]
   pending な notification_dispatches で
   scheduled_for <= now() のものを処理
        ↓
   通知グループの送信先（メール/Slack/Webhook）に
   alert_ids にひも付くアラートを集約してまとめ送信
        ↓
   sent_at, status='sent' に更新
```

タイミングごとの動作：

| timing | scheduled_for の決め方 |
|---|---|
| `immediate` | アラート発生時刻 |
| `batch-1h` | 次の正時 (例: 14:23 → 15:00) |
| `batch-6h` | 0/6/12/18 時の次の到来時刻 |
| `batch-12h` | 0/12 時 |
| `batch-24h` | 翌 0 時 |

---

## 8. CSV インポートとの共存

### 8.1 統合方針

- CSV は**過去データの取り込み専用**として残す（移行用途）
- フロントから直接 Supabase の `readings` に書き込み
- センサーが既存なら `device_eui` をキーに紐付け、無ければ自動生成（CSV ファイル名 → display_name）

### 8.2 重複排除

- `(sensor_id, measured_at)` でユニーク制約
- 既存行があれば skip（CSV 再インポート時の二重登録を防ぐ）

### 8.3 データソース判定

各 reading に `source` 列を追加（`'csv'` / `'webhook'`）してもよい。
グラフは `measured_at` 順で連続表示するので、データソースが混在しても問題なし。

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

`localStorage` を Supabase の以下に置き換える：

```ts
// 既存: src/lib/storage.ts
loadState() / saveState()
   ↓ 置換
// 新規: src/lib/supabase.ts
- Supabase クライアント初期化
- 各テーブルへの fetch/insert/update
- Realtime 購読 (subscribe)
```

### 9.3 Realtime 購読

```ts
supabase
  .channel('readings-changes')
  .on('postgres_changes',
    { event: 'INSERT', schema: 'public', table: 'readings',
      filter: `organization_id=eq.${orgId}` },
    (payload) => {
      // React state を更新 → 各ウィジェットが即時再レンダリング
    }
  )
  .subscribe()
```

### 9.4 「未割り当てセンサー」UI

サイドバー左下に新バッジ：

```
┌────────────────────────────┐
│ 登録センサー  27   [+]     │
│ 未割り当て   3 件 ⚠       │ ← クリックで未割り当てリストへ
└────────────────────────────┘
```

センサー一覧画面に「未割り当て」フィルタを追加。各行に「**割り当てる**」ボタン → 名称入力 + ダッシュボード紐付けモーダル。

---

## 10. 実装ステップ

### Phase 10: バックエンド基盤（最優先）

**目的**: Supabase + Vercel の土台を作り、Clerk と接続する。

**作業項目**:
1. Supabase プロジェクト作成（dev / production の2環境）
2. TimescaleDB extension を有効化
3. 上記 4.2 の DDL を順次適用
4. RLS ポリシー作成
5. Clerk-Supabase JWT 連携設定
   - Clerk Dashboard で Supabase JWT Template を作成
   - Supabase の Auth 設定で Clerk の JWKS URL を登録
6. Vercel プロジェクト作成
7. ミテルデの React コードを Vercel デプロイ（既存資産そのまま）
8. 環境変数設定（後述「環境変数」参照）
9. `app/api/webhooks/milesight/[org_id]/route.ts` の枠組みを作る（中身はまだダミー）

**完了条件**:
- Supabase ダッシュボードで全テーブルが見える
- Vercel に React がデプロイされ、URL でアクセスできる
- フロントから Supabase に test クエリが通る

**リスク**:
- Clerk の org 機能はプランによって制限あり → 事前に確認

---

### Phase 11: Webhook 受信エンドポイント（探索フェーズ）

**目的**: スキーマを把握する前に、生ペイロードを保管できる状態にする。

**作業項目**:
1. `POST /api/webhooks/milesight/[org_id]` を実装
   - Header `X-Webhook-Secret` を `milesight_applications.webhook_secret` と照合
   - body から `idempotency_key` を生成
   - `raw_events` に INSERT（ON CONFLICT DO NOTHING）
   - 200 OK 即返却
2. `WEBHOOK_TEST` を判別してログに「テスト成功」を出力
3. ミテルデ管理画面の「設定 → デバイス連携 → Milesight」を実機能化
   - Webhook URL を実際の値で表示（コピー可能）
   - Secret を生成・再発行できる
   - 過去の生イベントログをタイル表示（直近 50 件）
4. **テスト実行**:
   - 自社 Milesight Demo App から Test 送信
   - 実センサー 1〜2 台を 24 時間稼働
5. `raw_events.payload` を眺めて構造をリバースエンジニアリング

**完了条件**:
- 24 時間稼働させて raw_events に 50+ 行ある
- WEBHOOK_TEST / DEVICE_DATA / PROPERTY / EVENT / ONLINE / OFFLINE の構造把握
- 同じ event_id が再送されても重複が入らない

**リスク**:
- Milesight ペイロードの公式スキーマが存在しないため、想定外のフィールドが将来追加される可能性
  → `raw_events` で生保管しているので後追いで対応可能

---

### Phase 12: パーサと永続化

**目的**: 実データを正規化テーブルに反映する。

**作業項目**:
1. **Edge Function `process_raw_events`** を作成
   - cron で 1 分おき実行（pg_cron）
   - `processed_at IS NULL` の行を最大 N 件取得して処理
2. **イベント別パーサ**:
   - `WEBHOOK_TEST` → `processed_at` だけ更新してスキップ
   - `DEVICE_DATA / PROPERTY` → `readings` に INSERT
     - `device_eui` でセンサー検索、無ければ自動登録
   - `DEVICE_DATA / EVENT` → アラーム情報を一旦保存
   - `ONLINE / OFFLINE` → `sensors.online`, `last_seen_at` 更新
3. **未登録センサーの自動登録**:
   ```sql
   insert into sensors (organization_id, device_eui, model, status)
   values ($org, $eui, $model, 'unassigned')
   on conflict (organization_id, device_eui) do update
     set last_seen_at = excluded.last_seen_at,
         online = true
   returning id;
   ```
4. **未割り当て一覧画面** をフロントに追加（センサー一覧画面のフィルタ）
   - 各行に「**割り当てる**」ボタン → 名称入力 + ダッシュボード紐付けモーダル

**完了条件**:
- 実センサー 2 台が流したデータが `readings` に正規化されている
- 未登録 EUI で来たセンサーが `sensors` に `status='unassigned'` で並ぶ
- フロントの「未割り当て」フィルタにそれが表示される
- 割り当て後、ダッシュボードで通常表示される

**リスク**:
- パーサのバグでデータが歪む → `raw_events` から再処理可能な設計を死守

---

### Phase 13: フロントエンドの Supabase 接続

**目的**: 現在 localStorage で動いているフロントを Supabase に切り替える。

**作業項目**:
1. **`src/lib/supabase.ts` 新規作成**: クライアント初期化、認証、CRUD ヘルパ
2. **`src/lib/storage.ts` の `loadState/saveState` を置換**
   - 各 store（devices, sensors, gateways, dashboards, etc.）を Supabase テーブルから fetch
   - 変更時は upsert
3. **Supabase Realtime 購読**:
   - `readings` の INSERT を購読 → 該当センサーの最新値を更新
   - `sensors`, `alert_states`, `alerts` の変更も購読
4. **CSV インポートを Supabase 直接書き込みに変更**
   - フロントから `readings` に bulk insert（既存の sensor が無ければ自動生成）
5. **過去 CSV + Webhook の連続グラフ確認**

**完了条件**:
- ブラウザのリロードで状態が消えない（Supabase に保存されている）
- 別タブで開くと同じテナントの状態が共有される
- センサーのデータが Webhook で更新されると、ダッシュボードが自動再描画される

**リスク**:
- Realtime 購読の数が多すぎるとブラウザ側の負荷増 → ウィジェット単位ではなくダッシュボード単位で集約購読

---

### Phase 14: アラート評価と通知配信

**目的**: 2 軸の判定・通知ロジックを実装。

**作業項目**:
1. **アラート評価関数**（DB トリガー or Edge Function）
   - readings INSERT 時に `alert_states` を更新
   - 連続カウンタ ≥ `deviationConsecutiveCount` で `alerts` を open
   - 解消時は resolved
2. **通知ディスパッチャ**（cron 1 分おき Edge Function）
   - `notification_dispatches.scheduled_for <= now() AND status='pending'` を処理
   - メール（Resend）/ Slack / Webhook に集約送信
   - sent_at, status='sent' に更新
3. **設定 UI の整合**:
   - センサーのアラート設定に「N 回連続で逸脱したらアラート発動」を明示
   - 通知グループ側に「タイミング」を明示（既存）
4. **テスト**: 閾値を超える reading を流して、設定回数連続で発火することを確認

**完了条件**:
- テスト用閾値で `deviationConsecutiveCount=3` に設定 → 3 回連続で逸脱した瞬間にアラート発火
- 通知グループの timing が `batch-1h` なら次の正時にまとめてメールが届く
- 解消時の通知も届く

**リスク**:
- 通知重複（同じアラートに対して複数通知）→ dispatch 単位で重複防止チェック

---

### Phase 15: 運用堅牢化とスケール準備

**目的**: 1 万台規模で動くように、運用品質を上げる。

**作業項目**:
1. **Webhook 受信のスケーリング**:
   - Vercel API Route を Edge Runtime に
   - レート制限（IP 単位 + テナント単位）
2. **Supabase Postgres チューニング**:
   - readings の hypertable パーティション
   - 古いデータの自動圧縮（TimescaleDB）
   - データ保持ポリシー（生イベント 90 日、集計データ無期限）
3. **障害対策**:
   - パース失敗 → `raw_events.processing_error` に記録、Slack に通知
   - 死活監視ダッシュボード（Webhook 成功率、パース成功率、未送信通知数）
4. **シークレット再発行**:
   - Phase 7 で UI は作った再発行ボタンを実機能化
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
| 10 | ローカルで Supabase クライアントから select 1 が通る |
| 11 | curl で偽の WEBHOOK_TEST を送り、raw_events に行が入る |
| 11 | 同じ idempotency_key で連続送信、行が増えない |
| 12 | 実センサーから 1 時間データを流し、readings に正しく入る |
| 12 | 未登録 EUI を擬似送信、sensors に unassigned が増える |
| 13 | 別ブラウザで同じテナントを開き、Webhook 着信時に両方で更新される |
| 14 | 閾値超え reading を 3 回連続で送信、alert が open になる |
| 14 | 通知設定を batch-1h にして発火、次の正時にメール |
| 15 | 1 万件/分の負荷を JMeter / k6 で流し、エラー率 0 を確認 |

### 11.2 自動テスト

- **単体**: パーサ関数（payload → reading）の Vitest
- **統合**: Webhook 受信 → readings 反映までの E2E（Supabase test instance）
- **回帰**: 過去 raw_events を再処理しても同じ readings が生成されることを保証

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
| **DevEUI** | Milesight デバイスの一意ID（24E124... のような16桁HEX） |
| **EM320-TH** | Milesight 製の温湿度センサー（冷蔵庫・冷凍庫向け） |
| **UG65 / UG63** | Milesight 製のメインゲートウェイ / 中継パケットフォワーダー |
| **Webhook** | MDP がイベント発生時にミテルデに HTTP POST を送る仕組み |
| **テナント** | 1 顧客組織 = 1 Clerk Organization = 1 Milesight Application |
| **未割り当て** | センサーが自動登録されたが、ユーザーが命名・ダッシュボード紐付けをしていない状態 |
| **逸脱判定** | reading が閾値を超えること。連続回数で「アラート」に昇格 |
| **アラート** | 確定した逸脱状態。open / resolved の状態を持つ |
| **通知ディスパッチ** | アラートを通知グループ経由で外部（メール等）に送る処理 |
| **冪等性** | 同じ操作を何度繰り返しても結果が同じになる性質。Webhook 再送対策 |
| **RLS** | Row Level Security。Postgres のテナント分離機能 |

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

## 変更履歴

| 日付 | 内容 |
|---|---|
| 2026-05-05 | 初版作成（Phase 1〜9 完了後の設計合意） |
