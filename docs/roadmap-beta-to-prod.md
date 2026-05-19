# Miterude β版 → 本番リリース ロードマップ

最終更新: 2026-05-19  
ステータス: β-0/β-3/β-4 完了。リファクタ第1/2弾完了・dev/stg 反映済。
**β-2 全クローズ**（auth フロント `e7ecccf` + 0038-0043 + dev 展開 +
mock-login Edge Function を stg/dev 両環境で削除確認）。
次は **β-1（RLS 全テーブル一般化）**。

### β-1 設計方針（β-2 で確立した claim 基盤を全テーブルへ展開）

- スコープ判定: `public.current_org_id() = coalesce(impersonating_org_id,
  org_id)`（0042 で導入済）。impersonation 中の staff は自然に target org を見る
- staff バイパス: `public.is_staff()` = `app_role in ('super_admin','support')`。
  Admin Console が cross-tenant 読みするテーブル（organizations /
  organization_members / users / staff_* / manual_* / webhook_inbox /
  notification_groups）に追加
- service_role: bypassrls で自動バイパス（Edge Function は無影響）
- 公開共有: `share-dashboard` EF が service_role 利用のため anon 直 SELECT 不要

### β-1 実施フェーズ（小さく刻んで stg 先行検証）

- [x] **A. helpers + alert_logs**: `0044_rls_helpers.sql`（`is_staff()`/
  `is_super_admin()`）+ `0045_rls_alert_logs.sql`（demo_*/admin_full 撤去 →
  claim_*）。stg/dev 適用済・両環境で `alert_logs` の policy が
  `claim_*` 4 本のみに（2026-05-19）
- [x] **B. 設定系テナント表**: `0046_rls_phase_b_settings.sql`。
  `sensor_categories` / `sensor_groups` / `manufacturer_integrations` /
  `report_schedules` をテナント claim 限定、`notification_groups` は
  Admin Console cross-tenant 操作のため `is_staff()` バイパス併設。
  stg/dev 適用済・両環境で `claim_*` 4 本のみを確認（2026-05-19）。
  `report_delivery_links` は公開 token 設計のため Phase E に回した
- [ ] **C. コアデータ**: `devices` / `sensor_props` / `gateway_props` /
  `sensor_readings` / `dashboards` を claim ベースへ。webhook-milesight
  は service_role で無影響、公開共有も EF 経由で無影響を実機確認
- [ ] **D. 横断系**: `organizations` (id=current OR is_staff) /
  `organization_members` / `users` / `staff_assignments` /
  `staff_audit_logs` を `is_staff()` バイパス込みで設計
- [ ] **E. グローバル + 暫定撤去**: `manual_categories` /
  `manual_pages`（全テナント read、`is_super_admin()` のみ write）+
  `webhook_inbox` 暫定 `*_tmp` policy 全廃
- [ ] **F. 負テスト**: stg で 3 ユーザー × 別組織不可視を全テーブル抜き打ち検証 →
  通れば dev へ展開 → β-1 完了

### ▶ 次に再開するとき（中断ポイント: 2026-05-19）

**次の一手 = β-1（RLS 全テーブル一般化）Phase A（helpers + alert_logs）。**

旧 β-2f メモは下記履歴。β-2f は完了済み（mock-login 削除確認 / 0043
適用済 / dev 展開済 / 3 ブランチ同期済）。

β-2f の状態と残り:
- ✅ コード側レガシー撤去（`loadAuthSession`/`saveAuthSession`/
  `AuthSession` 型を削除、typecheck/build グリーン）— 本コミットで完了
- ⏳ 残（いずれも確認要）:
  1. **dev Supabase 展開**: `0038`/`0039`/`0041`/`0042` を dev
     （`kktwzllydtlsoahvdhzl`）に適用 + dev 検証ユーザー投入
     （auth.users の token 列は `''`）+ Custom Access Token Hook を
     dev で有効化（Supabase ダッシュボード操作）
  2. **ブランチ同期**: `origin/main` push → `dev` へ merge（Vercel 自動デプロイ）
  3. **破壊的撤去（最後）**: `mock-login` Edge Function 削除（dev/stg）+
     `users.password_hash` カラム DROP（migration 化、dev/stg 適用）
- 完了後 → β-1（RLS 全テーブルを claim ベースへ一般化）

#### β-2d 進捗・確定事項（user 承認済み）

- **方式**: dev も supabase 化（mock 分岐コードは書かない、supabase.auth 一本）。
  stg 先行検証 → β-2f で dev へ β-2a/b/c 適用 + main/dev/stg 同期 +
  mock-login/password_hash 撤去。デモログインチップは検証ユーザー
  （editor@stg.miterude.cloud / confirmer@stg.miterude.cloud）で残す
- ✅ **β-2d-1**: `0041_auth_rpcs.sql`（start/end_impersonation /
  set_active_organization、SECURITY DEFINER、auth.uid()→users.auth_user_id
  本人確認 + 監査）stg 適用済
- ✅ **β-2d-2**: `src/lib/authClaims.ts`（JWT app_metadata を access_token
  自前デコードで読む）/ `src/lib/authSession.ts`（getResolvedAuth /
  onAuthChange / refreshClaims / signOut、旧 kind 互換を claim から再現）/
  `supabase.ts` を persistSession:true・autoRefreshToken:true に
- ✅ **β-2d-3（完了 2026-05-18、コミット `e7ecccf`）**:
  正攻法 = AuthProvider（React Context）+ onAuthStateChange。
  13 ファイル（新規 AuthProvider.tsx + permissions/tenantResolver/
  impersonation/ImpersonationBanner/AdminTenantDetail/AdminStaffDetail/
  ContextSelect/UserMenu/LoginView/App/AdminApp/main）。App は
  ディスパッチャ + TenantWorkspace に分割（Hooks 順序を担保）。
  AdminApp は ResolvedAuth props 化。typecheck/build グリーン。
  旧設計メモは下記履歴参照。**壊れた中間状態を main に出さない方針を維持**

  ファイル別変更（実装はこの順を推奨）:
  1. **新規 `src/lib/AuthProvider.tsx`**: Context + `useAuth():
     ResolvedAuth`。マウント時 `getResolvedAuth()` + `onAuthChange()` 購読、
     解決まで loading スピナー表示、解決後 children に Context 提供
  2. **`src/lib/permissions.ts`**: 同期グローバル `getEffectiveRole()`
     廃止 → `effectiveRoleFromClaims(claims)` 純関数 +
     `canEdit/isConfirmer/getAdminRole/isSuperAdminOnly` を role 引数化
     （呼び出し元は App.tsx のみ）
  3. **`src/lib/tenantResolver.ts`**: `readSessionOrgId()`（localStorage
     直読み）廃止 → `resolveActiveOrgFromUrl(opts?: {sessionOrgId?})` に
     し、claim の org_id/impersonating_org_id を呼び出し側から渡す
  4. **`src/main.tsx`**: L67 の同期 `else if (!loadAuthSession())` 削除。
     通常ブートは `<AuthProvider><App/></AuthProvider>` を render。
     resolveActiveOrgFromUrl は AuthProvider 解決後（App 内 useEffect、
     claim の activeOrg を渡す）。loadAuthSession import 削除
  5. **`src/App.tsx`**: `useMemo(loadAuthSession)` 廃止 → `useAuth()`。
     `!auth.authed` → `/login` redirect。kind 分岐は `auth.kind`、
     org は `auth.activeOrgId`（`activeTenantIdFrom` 廃止）。
     `MOCK_SESSION.effectiveRole` は `auth.appRole`、userName/email は
     `auth.appUserId` で users 引き。urlIsAdmin && super_admin 特例は
     `auth.appRole==='super_admin'` で判定
  6. **`src/admin/lib/impersonation.ts`**: localStorage 退避全廃 →
     `start`: `supabase.rpc('start_impersonation',{p_target_org,p_reason,
     p_duration_minutes})` → `refreshClaims()` → `location.assign(redirect)`。
     `end`: `rpc('end_impersonation')` → `refreshClaims()` → reload。
     logStaffAction は RPC 内で記録するので削除（重複回避）
  7. **`src/components/views/LoginView.tsx`**: `callMockLogin` →
     `supabase.auth.signInWithPassword({email,password})`。成功後
     `getResolvedAuth()` の kind で redirect（admin→/admin/dashboard、
     tenant→/）。デモチップ = `editor@stg.miterude.cloud` /
     `confirmer@stg.miterude.cloud` + `StgTest2026!` で signInWithPassword。
     saveAuthSession import 削除
  8. **`src/components/ContextSelectView.tsx`**: `saveAuthSession(s)` →
     `rpc('set_active_organization',{p_org})` → `refreshClaims()` →
     reload。`loadAuthSession()` → `useAuth()`
  9. **`src/components/UserMenu.tsx`**: `handleLogout`:
     `saveAuthSession(null)` → `signOut()` → `/login`。
     `loadAuthSession()`（L151/174 の role ラベル/テナント情報）→
     `useAuth()` claim ベース
  10. **`src/admin/AdminApp.tsx`**: `loadAuthSession()`(L490) と
      session prop を `useAuth()`/ResolvedAuth ベースに
  - 呼び出し追従: `AdminTenantDetailView`(L551) /
    `AdminStaffDetailView`(L147) / `ImpersonationBanner`(L75) の
    startImpersonation/endImpersonation シグネチャ変更に追従
  - 旧 `AuthSession` 型（types.ts）と adminStorage の load/saveAuthSession
    は β-2f まで残置（mock-login と一緒に撤去）。新コードは ResolvedAuth
  - 検証用パスワード `StgTest2026!`、検証ユーザー:
    inoue@canbright.co.jp(super_admin) / editor@ / confirmer@stg.miterude.cloud

> 参考: 実 DB スキーマは `docs/database-schema.md`（実態反映済み）。

#### ✅ デプロイ整合 完了（2026-05-16）

リファクタ第1弾(f2b927c)＋第2弾(f4db2c1) を dev/stg に行き渡らせ済み:
- migration 0040（C1 RPC）: dev/stg 適用済
- Edge Function 第1/2弾: dev/stg デプロイ済・sha 一致確認
  （webhook-milesight verify_jwt=false 維持）
- フロント: **採用した同期方針 = 案A「dev/stg を main 追従」**。
  `git checkout dev && git merge main --no-edit && git push`（stg も同様）
  で Vercel 自動デプロイ。バンドルに C1 RPC 反映を実機確認済み
- 以後の運用: main を正とし、配布時に dev/stg へ merge。β顧客が stg を
  使い出したら本来の dev→stg→main 昇進フローへ移行

> Access Token は使用後 revoke すること（CLI デプロイ都度発行 → 即 revoke）。

---

旧メモ（残タスク 2 系統 — 第2弾は完了済みに繰り上げ）:

1. ~~リファクタ第2弾（パフォーマンス truncation）~~ ✅ 完了 f4db2c1
   - **C1** `src/lib/supabaseQueries.ts:141` `fetchLatestReadings`:
     PostgREST 1000件制限で 100台超のテナントはダッシュボード最新値が恒常欠落。
     対処は `DISTINCT ON (sensor_id)` の RPC（or マテビュー）新設で 1 クエリ化
   - **C2** `webhook-milesight` upsert `.select()` が1000件切れ→大量ペイロードで
     取り込み漏れ。戻り依存をやめ pending を range ページング処理
   - **H1** `detect-status-alerts` の devices 全件が1000件切れ→1000台超で
     オフライン検知が沈黙故障。devices を `fetchAllPaged` 化＋processSensor 並列
   - 補足: dev/stg はデータ僅少で未顕在。β顧客で大規模テナントが来ると顕在化。
     β リリース前に潰す価値が高い。CSP(report-only 設計)/バンドル分割/Recharts
     間引き/Realtime filter も Medium で残（リファクタ backlog 3章参照）
2. **β-2d（フロント改修）→ β-2e/f → β-1 RLS** — 認証本線（設計は 3章下の β-2 参照）

**推奨順: 1（C1 → C2 → H1）を先に潰してから 2（β-2d）。**
理由: C1/H1 は監視 SaaS の根幹（最新値表示・オフライン検知）の沈黙故障で、
β顧客に出す前に必須。β-2d は規模が大きく独立しているので後で集中して取れる。

参考（β-2d 着手時の設計細部 4 点 — 後述ブロックは下に残置）:
**次の一手 = β-2d（フロント改修）から着手する。**

β-2a/b/c は stg で完了済み（スキーマ / Custom Access Token Hook / 検証ユーザー）。
Hook が `app_role` / `org_id` / `impersonating_org_id` / `app_user_id` を JWT の
app_metadata に注入することを SQL レベルで実証済み。

**β-2d 実装着手前に詰めるべき設計細部:**
1. `AuthSession` 型（localStorage JSON）をどう置き換えるか
   — `supabase.auth.getSession()` + JWT claim（app_metadata）から導出する形へ。
   既存の kind: tenant/admin/impersonation を claim ベースで再現
2. claim 読み取りユーティリティの設計（app_role / org_id / impersonating_org_id を
   一元的に読むヘルパ。`getEffectiveRole()` / `activeTenantIdFrom()` の置換）
3. impersonation の書き込み経路: `impersonation_sessions` への insert/update を
   RPC（security definer 関数）にするか Edge Function（service_role）にするか
   — RLS でフロント直書き不可にしてあるため経路が必要。RPC 推奨（軽量）
4. テナント切替: `users.active_organization_id` 更新 RPC + `refreshSession()`

**stg 検証ユーザー（β-2e で使用、パスワードは stg 検証専用・別管理）:**
- `inoue@canbright.co.jp` … super_admin
- `editor@stg.miterude.cloud` … テナント editor（demo-canbright 所属）
- `confirmer@stg.miterude.cloud` … テナント dashboard_confirmer（同上）

**鉄則:** stg 先行・dev は mock-login 温存（退避路）。β-2e で stg 全フロー検証
（+1〜2 テーブルで JWT ベース RLS 試験）まで通ったら β-2f で dev/main 展開、
最後に mock-login / password_hash 撤去。その後 β-1（RLS 全置換）。

---

## 1. 全体方針

### 環境構成（3 プロジェクト分離方式 — β-4 で確定）

| 環境 | Vercel プロジェクト | git ブランチ | ドメイン | Supabase | 状態 |
|------|--------------------|-------------|---------|----------|------|
| dev  | `miterude-dev`  | `dev`  | dev.miterude.cloud | `kktwzllydtlsoahvdhzl` (miterude-dev) | ✅ 稼働 |
| stg  | `miterude-stg`  | `stg`  | stg.miterude.cloud | `bejgwwhxntnxzwehsryx` (miterude-stg) | ✅ 稼働 |
| prod | `miterude-prod` | `main` | miterude.cloud     | prod（未作成）                         | β顧客契約後 |

- **3 プロジェクト完全分離**を採用（当初の「1 プロジェクト + ブランチ env 切替」案から変更）。
  理由: env vars がプロジェクト単位で独立し、**環境取り違え事故が構造的に起きない**。
  Vercel はプロジェクト数で課金しないため追加コストなし。dev/stg の JS バンドルに
  正しい Supabase ref が埋まることを実機確認済み。
- **ブランチ昇格フロー**: `dev`（日常開発）→ `stg`（β検証）→ `main`（本番リリース）
- GitHub リポジトリは `kazinoup/miterude`（旧 `miterude-demo` からリネーム済み）
- DNS は **Vercel DNS**（お名前.com から NS 委任済み: `ns1/ns2.vercel-dns.com`）
- **「β = 機能フラグ / UI バッジ」**。データの住所は最初から prod に固定し、移行をゼロに保つ
- ステージング命名は `stg`（ツクルデと揃える）

### 認証方針

- Supabase Auth（マジックリンク + パスワード）を採用
- ツクルデとの SSO は当面なし。データ連携は **API キー方式の REST API** で対応
- 将来 Clerk 統合に切替可能な構造で実装

### ツクルデ連携の経路（β1 では API キーのみ）

```
[ツクルデ] --(X-Api-Key)--> [ミテルデ Edge Function /api/v1/*] --> Supabase
```

---

## 2. β リリース必須タスク（β-0 〜 β-9）

### β-0: stg 環境構築 ✅ 完了（2026-05-16）

- [x] `miterude-stg` Supabase 作成（Tokyo / Pro org `bejgwwhxntnxzwehsryx`）
- [x] migrations **36 件**（0001〜0037、0028 欠番）を stg に適用
  - dev に MCP 直接適用されてファイル化されていなかった 27 件を
    `schema_migrations.statements` から復元して `supabase/migrations/` に保存（da2ebd3）
- [x] Edge Functions **10 個**を stg にデプロイ
  - webhook-milesight / parse-inbox / send-notification / dispatch-notifications
  - send-notification-test / dispatch-report-schedules / detect-status-alerts
  - backfill-alerts / mock-login / share-dashboard
- [x] pg_cron **4 ジョブ**は migration（0014/0032/0035/0037）でスケジュール済
  - URL/JWT は stg 用にスワップして適用（dev のハードコード値を置換）
- [x] Resend secrets（RESEND_API_KEY / RESEND_FROM / APP_URL）を stg Secrets に設定
- [x] smoke test 済: webhook-milesight health-check 200 / pg_cron 4 ジョブ succeeded /
  send-notification-test で inoue@canbright.co.jp にメール到達確認

### β-1: RLS 厳格化 🔴 ※実施順は β-2 の後（JWT の org_id claim が前提）

- [ ] **設計**: `organization_id` ベースの policy 雛形を作成
- [ ] **全テーブル**の policy を `using (organization_id = (auth.jwt() ->> 'org_id')::uuid)` に置換
  - organizations / users / organization_members
  - devices / sensor_props / gateway_props / sensor_categories / sensor_groups
  - sensor_readings / sensor_notes / alert_logs / dashboard_checkins
  - notification_groups / notification_deliveries
  - report_schedules / report_delivery_links
  - manufacturer_integrations / webhook_inbox
  - manual_categories / manual_pages
- [ ] 暫定 policy（`webhook_inbox select tmp` 等）を全廃
- [ ] super_admin / staff 用の特例 policy（service_role bypass）
- [ ] stg でテナント横断アクセス検証（負のテスト）

### β-2: Supabase Auth 統合 🔴 ◀ 次に着手（β-1 の前提）

**確定設計（user 承認済み 2026-05-16）**

- 認証: Supabase Auth（email + password）
- 紐付け: **`users.auth_user_id` カラム方式**（`users.id` は不変・FK 無傷、
  RLS は `auth.uid() = users.auth_user_id` で評価）。id 統一は FK カスケード地獄のため不採用
- マルチテナント: **B1 アクティブ org 再発行**（`users.active_organization_id` +
  切替時 `refreshSession()`）
- impersonation: **A custom claim 方式**（`impersonation_sessions` テーブル +
  Custom Access Token Hook が有効レコードを見て `impersonating_org_id` claim 注入）
- 移行: **stg 先行・dev は mock-login 温存**（退避路確保）

**JWT claim（Custom Access Token Hook で注入）**
- `app_role`: super_admin / support / editor / dashboard_confirmer
- `org_id`: tenant の active_organization_id（なければ所属先頭）
- `impersonating_org_id`: 有効な impersonation_sessions があれば target org
- RLS は β-1 で `organization_id = coalesce(impersonating_org_id, org_id)` 系に置換

**実装タスク分解**

- [x] **β-2a** migration: `users.auth_user_id` / `users.active_organization_id` /
  `impersonation_sessions` テーブル（stg 適用済 / `0038_*.sql`）
- [x] **β-2b** Custom Access Token Hook（`0039_*.sql`、security definer）+
  Supabase Auth 設定（Hook 有効化・Email provider Enabled）（stg）
- [x] **β-2c** stg 検証ユーザー 3 名を SQL 直接投入（auth.users/identities +
  public.users + organization_members）。Hook が claim を注入することを SQL 実証。
  ※本番ユーザー移行は β-2f/本番時に招待フローで別途。検証シードは migration 化しない
  - ⚠️ **既知の落とし穴（2026-05-19 stg で顕在）**: `auth.users` を SQL 直接
    投入すると `confirmation_token` / `recovery_token` /
    `email_change_token_new` / `email_change`（+ `email_change_token_current`
    / `phone_change` / `phone_change_token` / `reauthentication_token`）が
    NULL のままになり、GoTrue がログイン時に
    `Scan error ... converting NULL to string is unsupported` → 500
    （"Database error querying schema"）で全ユーザー認証不可になる。
    **シード時にこれらを `''`（空文字）で投入すること**。stg は事後 UPDATE
    で修復済。β-2f の dev シードでは最初から `''` を入れる
- [x] **β-2d** フロント改修（main、コミット `e7ecccf`）
  - `supabase.ts`: `persistSession:true, autoRefreshToken:true`（β-2d-2）
  - `LoginView`: `supabase.auth.signInWithPassword()`
  - `App`/`AdminApp`: AuthProvider/`useAuth()`、kind 判定を JWT claim ベースに
  - `impersonation.ts`: RPC（start/end_impersonation）+ `refreshClaims()`
  - テナント切替: `set_active_organization` RPC + `refreshClaims()`
  - ログアウト: `supabase.auth.signOut()`
- [x] **β-2e** stg 全フロー検証（完了 2026-05-19）
  - `0042_rls_jwt_trial.sql` stg 適用済（admin_full も 2 表で撤去）+
    stg ブランチ push 済
  - auth.users NULL トークン問題（β-2c の落とし穴）を stg で修復
  - β-2e 検証用テストデータ投入済（demo: sensor 3 + readings 72 +
    notes 2 + checkin 1 / 別組織 canbright: sensor 1 + readings 24 +
    note 1 + checkin 1）。固定 UUID（device `1111…d1/d2/d3`・
    `2222…e1` / note `3333…` / checkin `4444…`）。migration 化しない
  - 実機で 3 ユーザーの全フロー（ログイン/コンテキスト/切替/
    impersonation/logout/RLS 負テスト）検証 OK（inoue 確認）
- [ ] **β-2f** dev 展開 + レガシー撤去
  - [x] コード側撤去（`loadAuthSession`/`saveAuthSession`/`AuthSession`
    型を削除。typecheck/build グリーン。コミット `e808898`）
  - [x] dev に `0038/0039/0041/0042` 適用済（`kktwzllydtlsoahvdhzl`）
  - [x] dev 検証ユーザー 3 名作成・紐付け済（pw `StgTest2026!`、
    auth.users token 列は `''`）。Hook 関数が claim を正しく注入
    することを dev で実証（editor→org_id+editor /
    inoue→super_admin / confirmer→dashboard_confirmer）
    - 紐付け: inoue@canbright.co.jp→users `…a001`(super_admin) /
      editor@stg.miterude.cloud→`…a002`(demo028 editor) /
      confirmer@stg.miterude.cloud→`…a003`(demo028 dashboard_confirmer)。
      dev demo org = `…d001`(slug demo028)、別組織 demo086 が負テスト用
  - [x] `origin/main` push（`392b8d4`、本番デプロイなし）→ `dev` へ
    merge & push（`97d89a3`）。miterude-dev が dev.miterude.cloud を
    自動デプロイ（新 Supabase Auth フロー反映）
  - [x] dev Supabase で Custom Access Token Hook 有効化済 +
    dev.miterude.cloud で `editor@stg.miterude.cloud` →
    CBO-028(demo028) テナントログイン成功（2026-05-19）
  - [x] `0043_drop_mock_password_hash.sql` 作成・stg/dev 適用済
    （`staff_category` は温存確認）。dev の hash 値は
    `password_hash_backup_dev_2026-05-19.sql.local`（gitignore）に保全
  - [x] mock-login Edge Function のローカルソース撤去
    （`supabase/functions/mock-login/` 削除）
  - [ ] ⚠️ **要手動**: stg/dev にデプロイ済の `mock-login` 関数を
    Supabase 側から削除（CLI: `npx supabase functions delete mock-login
    --project-ref <ref>` で stg(`bejgwwhxntnxzwehsryx`) と
    dev(`kktwzllydtlsoahvdhzl`) の両方、または各プロジェクトの
    ダッシュボード Functions タブから Delete）。トークン使用後は revoke。
    完了で β-2 全クローズ → β-1 へ

### β-3: Resend 独自ドメイン認証 ✅ 完了（2026-05-16）

- [x] Resend に `miterude.cloud` 追加（Tokyo ap-northeast-1）
- [x] DNS レコードを **Vercel DNS** に投入（`vercel dns add`）
  - MX `send` / TXT `send`(SPF) / TXT `resend._domainkey`(DKIM) / TXT `_dmarc`
- [x] Resend Domain Verification 完了（DKIM / SPF Verified）
- [x] `RESEND_FROM` を `ミテルデ <noreply@miterude.cloud>` に切替（dev / stg 両方）
- [x] テスト送信で差出人が新ドメインになっていることを確認

### β-4: Vercel カスタムドメイン + 3 プロジェクト構成 ✅ 完了（2026-05-16）

- [x] お名前.com → Vercel に NS 委任（`ns1/ns2.vercel-dns.com`、反映確認済み）
- [x] GitHub リポジトリを `kazinoup/miterude` にリネーム + ローカル remote 更新
- [x] 3 プロジェクト分離を採用（方式 B。env 取り違え事故を構造的に防止）
  - `miterude-dev`（既存 miterude-demo をリネーム / Production Branch=`dev`）
  - `miterude-stg`（新規 / Production Branch=`stg`）
  - `miterude-prod` は β顧客契約後に作成
- [x] env vars をプロジェクト単位で投入（dev は既存流用、stg は stg Supabase 値）
- [x] `dev.miterude.cloud` → miterude-dev / `stg.miterude.cloud` → miterude-stg 割当
- [x] dev/stg 再デプロイ → JS バンドルに正しい Supabase ref が埋まることを実機検証
- [ ] **残**: `miterude.cloud` apex は現在 miterude-dev に仮紐付け。
  prod 作成時（β顧客契約後）に miterude-prod へ付け替える

### β-5: β UI / 規約

- [ ] `VITE_BETA_MODE=true` で右上「β」バッジ表示
- [ ] β 利用規約画面（β期間中につき無償・SLA なし）
- [ ] β顧客限定の利用上注意 banner

### β-6: β顧客セットアップ手順書

- [ ] `docs/customer-onboarding.md`: テナント作成 → Milesight 連携 → 通知設定の完全手順
- [ ] MDP 側の Application 作成ガイド（スクショ込み）
- [ ] よくある質問 / トラブルシュート

### β-7: テストデータ環境

- [ ] **β-7a**: シードジェネレータ Edge Function
  - normal / with-deviations / with-offline / battery-low の 4 シナリオ
- [ ] **β-7b**: 合成 webhook ストリーム（pg_cron で 30 分おきに stg / demo へ投入）
- [ ] **β-7c**: 物理センサー設置（任意・社内テスト用）
- [ ] **β-7d**: Webhook 転送機能（Admin Console から prod → stg/demo へリアルタイム転送）
  - `webhook_forwarding_rules` テーブル + HMAC 再署名ロジック
  - Admin UI（連携設定タブ内）
- [ ] **β-7e**: テストデータタブ UI
  - シナリオ投入ボタン
  - sensor_readings CSV import
  - テナント設定 ZIP export / import
  - webhook_inbox JSON export / replay
  - データクリアボタン（prod では無効化）

### β-8: メンバー招待フロー

- [ ] `invitations` テーブル（token / expires_at / tenant_role / accepted_at）
- [ ] 招待メール送信（Resend）
- [ ] 招待リンク受け入れ画面（既存ログイン or 新規アカウント作成）
- [ ] Admin Console / テナント側「メンバー管理」画面に「招待」ボタン
- [ ] 期限切れ・無効化処理

### β-9: ツクルデ連携 API（後追い可）

- [ ] `api_keys` テーブル（organization_id / key_hash / scopes / last_used_at / expires_at）
- [ ] Admin Console > 連携設定タブで API キー発行 UI
- [ ] Edge Function `miterude-api` で `X-Api-Key` 検証
- [ ] REST エンドポイント:
  - `GET /v1/sensors` / `GET /v1/sensors/:id/readings`
  - `GET /v1/alerts` / `GET /v1/devices/:id`
- [ ] ドキュメント（ツクルデ開発者向け README）
- [ ] レート制限 / 監査ログ

### β-10: 電話通知（Twilio Programmable Voice + 組込 TTS）

お客様要望対応。逸脱・オフライン等のクリティカル通知を電話で読み上げる
（こちらからの一方的読み上げのみ。応答受付・IVR はスコープ外）。

採用構成: **Twilio Programmable Voice + AWS Polly Neural（`Mizuki` / `Takumi`）**
- 双方向エージェント不要のため ElevenLabs / Conversational AI は使わない
- TwiML を inline で渡し、`<Say language="ja-JP" voice="Polly.Mizuki-Neural">…</Say>` で
  その場で日本語ニューラル音声合成 → 切断
- LLM 学習量が多くバイブコーディングと最も相性が良い構成

#### β-10a: 事前準備（user 側作業）

- [ ] Twilio アカウント開設・本人確認（KDDI Web Communications 経由）
- [ ] 発信元番号取得（日本 0ABJ または海外番号 + 国際発信）
- [ ] 月額予算・1 通知あたり同時発信数の上限を決める

#### β-10b: バックエンド実装

- [ ] Edge Function Secrets 登録
  - `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM_NUMBER`
- [ ] DB migrations
  - `notification_groups` に voice チャネル種別を追加（既存 email/slack/webhook と並列）
  - `users` または連絡先テーブルに `phone_e164` カラム（E.164 形式、例: `+819012345678`）
- [ ] `send-notification` Edge Function を voice 対応に拡張
  - Twilio REST API `POST /Accounts/{sid}/Calls.json` を呼ぶ
  - TwiML を inline 渡し（外部 URL ホスティング不要）
  - 失敗時の HTTP ステータス・SID を `notification_deliveries` に記録
- [ ] TwiML 文面テンプレート（センサー名 / 値 / しきい値 / 時刻を埋め込み）
  - 単位の読みを最適化（`℃` → 「ど」、`-` → 「マイナス」）
  - SSML `<break time="500ms"/>` で間を取って聞き取りやすく
- [ ] 通話料金の概算ログ（1 通知あたり試算値を delivery に記録）

#### β-10c: フロントエンド実装

- [ ] 通知グループ設定 UI に「電話」チャネル追加
- [ ] 連絡先入力に電話番号フィールド（国番号セレクタ + E.164 バリデーション）
- [ ] 通知タイミング設定に「電話のみ深夜帯抑制（22:00–07:00）」のトグル
- [ ] テスト送信タブに「電話発信テスト」追加（β-7e と合流）
- [ ] 配信履歴ビューで voice 種別を表示・通話状態（completed/busy/no-answer/failed）を表示

#### β-10d: 運用ガード

- [ ] レート制限: 1 アラートあたり最大 N 件の電話発信に制限
- [ ] 月間予算アラート（Twilio 残高 / 通話料金推定が閾値超過で Admin に通知）
- [ ] 利用規約に「通話料金は当社負担、ただしβ期間中は通知件数を月◯件まで」等の上限明記
- [ ] 障害時フォールバック: 電話発信失敗時は同じ宛先のメール通知を自動送信

---

## 3. リファクタリング backlog

### 🔒 セキュリティ

- [ ] **🔴 β必須** RLS 厳格化（β-1 と合流）
- [ ] **🔴 β必須** 暫定 policy 全廃（`*_tmp` 名のもの）
- [ ] **🔴 β必須** mock auth の password_hash カラム削除
- [ ] 🟡 webhook_secret のローテーション UI（Admin から再発行可能に）
- [ ] 🟡 API キーの scopes 厳格化（read-only / read-write の分離）
- [ ] 🟡 監査ログ（staff_audit_logs）の拡充
  - センサー作成・削除・通知設定変更を全部記録
  - tenant 側 admin の操作も対象に
- [x] 🟡 セキュリティヘッダ追加（vercel.json に X-Frame-Options:DENY /
  nosniff / HSTS / Referrer-Policy / Permissions-Policy）f2b927c。
  **CSP は外部接続の洗い出しが必要なため report-only で別途設計（残）**
- [ ] 🟡 service_role の使用を最小化（Edge Function 内のみ）
- [ ] 🟢 パスワードハッシュアルゴリズム見直し（Supabase Auth に任せれば自動的に bcrypt）
- [ ] 🟢 セッションタイムアウト / リフレッシュトークン期限調整
- [x] 🟢 SSRF 対策: `_shared/urlGuard.ts` で通知系3 Edge Function を
  https 強制 + private/メタデータ拒否、Slack は hooks.slack.com allowlist
  （f2b927c・dev/stg デプロイ済）
- [x] 追加対応（レビュー由来）: レポート公開リンク失効（expires_at 90日 +
  閲覧側検証）/ 共有トークンを `crypto.getRandomValues` 化（f2b927c）
- [ ] 🟢 個人情報の取扱規程 / 削除リクエスト対応

### ⚡ パフォーマンス

- [x] **🔴 β必須** `fetchAllPaged` 未適用箇所の発見と修正（f4db2c1）
  - 既存対応済: `sensor_readings` / `alert_logs` / `sensor_notes` /
    `dashboard_checkins` / `devices` / `gateways`
  - **C1** `fetchLatestReadings` → `get_latest_readings` RPC（DISTINCT ON /
    SECURITY INVOKER、migration 0040 dev/stg 適用済）
  - **C2** `webhook-milesight` の upsert+select を 500 件チャンク化
  - **H1** `detect-status-alerts` の devices を range ページング全件 +
    sensor_props を device_id チャンク + processSensor を 20 件バッチ並列
  - ⚠ 未反映: Edge Function(C2/H1) の dev/stg 再デプロイ + フロント(C1)の
    dev/stg ブランチ同期が残（下記「デプロイ整合」参照）
- [ ] 🟡 sensor_readings のインデックス見直し（`(sensor_id, measured_at DESC)` の複合 index）
- [ ] 🟡 古い sensor_readings のアーカイブ戦略（pg_partman でパーティション化、または別テーブルに月次集計）
- [ ] 🟡 React 不要な再レンダー削減
  - DashboardView / SensorsView の useMemo / React.memo 適用
  - 大量データの仮想スクロール（react-window 等）
- [ ] 🟡 Recharts のデータ間引き（30 分粒度を 1 時間に集約してプロット）
- [ ] 🟡 Realtime 購読範囲の最適化（dashboard 表示中のセンサーだけ subscribe）
- [ ] 🟢 Vite ビルドサイズ最適化（dynamic import / code splitting）
- [ ] 🟢 画像最適化（センサーカタログ画像を WebP 化）
- [ ] 🟢 Lighthouse スコアで Web Vitals 計測 → 改善
- [ ] 🟢 Supabase の DB 接続プーリング設定

### 🛠 メンテナンス

- [ ] **🔴 β必須** Sentry 統合（エラー監視）
- [ ] 🔴 β必須 環境変数管理ポリシー整備（どこに何の secret を置くか）
- [ ] 🟡 GitHub Actions CI/CD
  - PR で typecheck / lint / build 自動実行
  - stg ブランチ push で stg Supabase に migrations 自動適用 + Edge Function デプロイ
  - main ブランチ push で prod に同上
- [ ] 🟡 自動テスト
  - Vitest（lib ユニットテスト）
  - Playwright（E2E: ログイン → ダッシュボード → 設定保存）
  - Deno test（Edge Function ユニットテスト）
- [ ] 🟡 構造化ログ（`console.log` を logger 抽象化、Sentry 連動）
- [ ] 🟡 型定義の整理（`src/types.ts` が肥大化 → ドメイン別に分割）
- [ ] 🟡 古い localStorage コードの削除
  - notify.ts の buildDefaultIntegrations 等、Supabase 移行で不要になったコード
  - webhookInbox.ts の loadWebhookInbox / saveWebhookInbox 系（Supabase 直読みに切替済み）
- [ ] 🟡 依存パッケージ更新（npm-check-updates で定期確認）
- [ ] 🟡 ドキュメント整備
  - `docs/architecture.md`: 全体像 / データフロー / Edge Function 一覧
  - `docs/deploy.md`: stg / prod デプロイ手順
  - `docs/runbook.md`: 障害対応・ロールバック手順
  - `docs/customer-onboarding.md`: β顧客セットアップ（β-6 と合流）
- [ ] 🟢 命名統一（snake_case ↔ camelCase の境界明確化）
- [ ] 🟢 ESLint / Prettier 設定見直し
- [ ] 🟢 マイグレーション命名規約 README（連番管理ルール）
- [ ] 🟢 Slack / Teams 通知（CI 失敗 / デプロイ完了）

### 📊 運用 / 監視

- [ ] 🔴 β必須 Sentry エラー監視（前述）
- [ ] 🟡 運営ダッシュボード（/admin/dashboard）に運用指標を追加
  - 過去 24h の cron 実行履歴
  - Edge Function 実行回数 / 失敗率
  - Resend 配信率
  - Supabase Egress 使用量
- [ ] 🟡 顧客向けステータスページ（status.miterude.cloud）
- [ ] 🟢 ログ集約（Supabase Logs を BigQuery / Datadog に出力）
- [ ] 🟢 SLO / SLA の定義（β 後の正式版で）

---

## 4. 後追い候補（β リリース後）

### 機能

- Clerk 統合（ツクルデとの SSO）
- Stripe 課金（β → 有料への切替）
- マルチセンサー / マルチメーカー対応
  - Milesight 他モデル（扉開閉・漏水・占有率）
  - IoT Mobile 連携
  - 一般 LoRaWAN（Helium / TTN）
- HACCP 帳票テンプレート
- 異常検知（統計ベース or ML）
- グラフのアノテーション（運用メモの可視化）
- モバイルアプリ（PWA / Native）

### ビジネス

- セルフサーブ申込フォーム（4.2）
- 14 日無料トライアル
- リファラル / 紹介プログラム
- 多言語対応（英語）

### データ

- 古い readings の自動アーカイブ（パーティション・S3 出力）
- データエクスポートのフル機能化（全テナント設定 / 全期間 readings / 全アラート）

---

## 5. 関連メモ

### マイグレーション番号管理

- 連番は 0001 から開始、`{NNNN}_{snake_case_description}.sql`
- 複数開発者になる際は番号衝突を避けるため、新規作成前に Slack / Issue で番号宣言

### Edge Function 一覧（現在）

| 関数 | 役割 | トリガ |
|---|---|---|
| webhook-milesight | Milesight MDP からの webhook 受信 | MDP からの HTTP POST |
| parse-inbox | webhook_inbox の pending を一括処理 | 10 分おき pg_cron |
| send-notification | 単一 delivery を Email/Slack/Webhook/Voice に送信 | dispatch-notifications から |
| dispatch-notifications | pending deliveries を捌くワーカー | 1 分おき pg_cron |
| send-notification-test | テスト送信（履歴に残らない） | UI から手動 |
| dispatch-report-schedules | レポート定期配信 | （未実装、Phase 1.8 後継） |
| detect-status-alerts | オフライン検知 + 再アラート + 復帰 | 10 分おき pg_cron |

### Supabase MCP の使い方（運用時）

- Claude Code から各環境の project_id を指定して操作
- 主要コマンド: `apply_migration` / `deploy_edge_function` / `execute_sql` / `list_edge_functions`
- credentials は inoue のみが保有

---

## 6. タイムライン（目安）

```
Week 1   ✅ β-0: stg 構築（完了 2026-05-16）
         ✅ β-3: Resend ドメイン認証（完了 2026-05-16）
         ✅ β-4: Vercel 3 プロジェクト構成（完了 2026-05-16、apex 整理のみ prod 時へ）
         β-7d: Webhook 転送（検証データを stg に流す土台）
         β-7a/b: シードジェネレータ + 合成ストリーム

Week 2   ◀ 現在地（次の一手）
         β-2: Supabase Auth 統合（先に実施 — JWT org_id claim を作る）
         β-1: RLS 厳格化（β-2 完了後・最大ヤマ）

Week 3   β-5/6: β バッジ + 規約 + 手順書
         β-7e: テストデータタブ UI

Week 4   β-8: メンバー招待
         セキュリティ・パフォーマンス必須項目
         Sentry 統合
         CI/CD（GitHub Actions）

Week 5+  β-9 ツクルデ連携 API
         β-10 電話通知（Twilio + Polly Neural）
         miterude-prod 作成 + 移行
         β顧客への提供開始
```

ペース感: フルタイム作業で **4〜5 週間**、合間に他業務がある場合は **6〜8 週間**。
β-10 は事前準備（Twilio 開設・本人確認）の待ち時間が読めないため、上記タイムラインとは
並行進行するイメージ（user 側の手続きと並行して実装を進める）。

---

## 7. 進捗トラッキング

このドキュメントは生きた仕様書。**完了したタスクには `[x]` を入れる**運用で、いつでも残タスクが見える状態に保つ。

該当する PR / commit ハッシュをリンクで残すとさらに追跡しやすい。
