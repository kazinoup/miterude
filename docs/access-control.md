# アクセス制御マトリクス

Phase 1.5a で導入したモック認証期間中のアクセス制御。Clerk 統合（Phase 1.5b 以降）でも同じ役割定義をそのまま使う前提。

## 概念

ミテルデのユーザーは大きく **3 種類** に分かれる:

| 区分 | DB 上の表現 | 用途 |
|---|---|---|
| システム管理者 | `users.system_role = 'super_admin'` + `users.staff_category = 'system_admin'` | ミテルデ運営の管理者。Admin Console フルアクセス |
| サポート / 営業 | `users.system_role = 'support'` + `users.staff_category = 'support' \| 'sales'` | 顧客窓口担当。割当てテナントの管理・閲覧を行う |
| テナントユーザー | `users.system_role IS NULL` + `organization_members` に行あり | 顧客企業の社員。自社のダッシュボード等を使う |

スタッフ区分 (`staff_category`) は 3 値: `'system_admin' \| 'support' \| 'sales'`。

## ログイン

- **URL**: `/login`（実装: `src/components/views/LoginView.tsx`）
- **Edge Function**: `mock-login`（`supabase/functions/mock-login/index.ts`）
- パスワード:
  - 内部スタッフ（system_admin / support / sales）: 固定共有 **`Canbright0987`**
    - SHA-256 ハッシュを `users.password_hash` に保存
    - Edge Function 内で比較、ハッシュは絶対にクライアントに返さない
  - テナントユーザー: 何でも OK（モック期間中）
- デモログイン: `editor-demo@example.com` / `confirmer-demo@example.com` をワンクリック
- Clerk 統合時に LoginView を Clerk の `<SignIn />` に置き換え、`password_hash` カラム削除

## Admin Console アクセス権限

ログイン後 `system_role` に応じて Admin Console (`/admin/*`) でできることが変わる。

| 機能 | super_admin | support / sales | テナントユーザー |
|---|---|---|---|
| Admin Console アクセス | ✓ | ✓（限定） | ✗ |
| テナント一覧（`/admin/tenants`） | 全件 | **割当て済 staff_assignments のみ** | — |
| テナント作成・編集・無効化・削除 | ✓ | ✗（ボタン非表示） | — |
| テナント詳細閲覧（contract/members/sensors/gateways/audit/integration タブ） | ✓ | **読み取り専用**（入力グレー化） | — |
| impersonation（このテナントに入る） | 全件 | **割当て済のみ** | — |
| スタッフ一覧 / 詳細（`/admin/staff`） | ✓ | ✗（ナビ非表示、URL 直アクセスは tenants へ戻す） | — |
| スタッフ追加・編集 | ✓ | ✗ | — |
| 監査ログ（`/admin/audit`） | 全件 | **割当て済テナント分のみ** | — |
| マニュアル閲覧（`/admin/manual`） | ✓ | ✓ | ✓（テナント側 `/<slug>/manual`） |
| マニュアル編集（カテゴリ・ページ・本文） | ✓ | ✗（追加ボタン・保存ボタン非表示、エディタは閲覧モード） | ✗ |

「割当て済」の定義: `staff_assignments` で `staff_user_id = ログインユーザー && revoked_at IS NULL && (expires_at IS NULL OR expires_at > now)` の組織。

## テナント UI アクセス権限

`/<slug>/*` のテナント UI は **顧客向け**。

| 機能 | super_admin (impersonation 経由) | support / sales (impersonation 経由) | editor | dashboard_confirmer |
|---|---|---|---|---|
| ダッシュボード閲覧 | ✓ | ✓ | ✓ | ✓ |
| ダッシュボード作成・編集 | ✓ | ✓ | ✓ | ✗ |
| 確認チェックイン | ✓ | ✓ | ✓ | ✓ |
| センサー・ゲートウェイ管理 | ✓ | ✓ | ✓ | ✗ |
| 設定（連携・通知・テンプレート） | ✓ | ✓ | ✓ | ✗ |
| マニュアル閲覧 | ✓ | ✓ | ✓ | ✓ |

「impersonation 経由」= Admin Console から「このテナントに入る」を押した状態。`AuthSession.kind === 'impersonation'` で 1 時間有効。

## 公開ダッシュボード（認証なし）

`/share/dashboard/<token>` は完全に認証不要。トークン発行は super_admin / editor が編集モードから行う。

## DB スキーマと制約

### users
```sql
-- 既存（Phase A シリーズで作成済）
clerk_user_id text unique,
email text unique,
display_name text,
system_role text check (system_role in ('super_admin', 'support')),
staff_category text check (staff_category in ('system_admin', 'support', 'sales')),
-- Phase 1.5a で追加
password_hash text  -- SHA-256(hex)。Clerk 統合時に drop
```

### staff_assignments
```sql
staff_user_id uuid references users,
organization_id uuid references organizations,
granted_by_user_id uuid,
granted_at timestamptz,
expires_at timestamptz,
revoked_at timestamptz,
notes text
```

### organization_members
```sql
organization_id uuid,
user_id uuid,
role text check (role in ('editor', 'dashboard_confirmer'))
```

## コード上の判定ヘルパ

- `src/lib/permissions.ts`
  - `getEffectiveRole(): EffectiveRole`
  - `getAdminRole(): 'super_admin' | 'support' | null`
  - `canEdit(role): boolean`
  - `isConfirmer(role): boolean`
  - `isSuperAdminOnly(role): boolean`

- `src/admin/AdminApp.tsx`
  - ログイン直後に `loadUsers()[session.userId].systemRole` から `isSuper` を判定
  - 各子ビューに `isSuperAdmin` / `viewerUserId` を渡す

## Phase 1.5b (Clerk 統合) 移行時の置き換えポイント

1. **LoginView** → Clerk の `<SignIn />` に置換
2. **mock-login Edge Function** → 削除
3. **users.password_hash** カラム → drop
4. **users.clerk_user_id** カラム → Clerk 側 user.id を埋める
5. **権限判定** (`permissions.ts`) → Clerk JWT のクレームから `system_role` を読む形に
6. **AdminApp の `loadUsers()[session.userId]`** → Clerk session から取得

権限マトリクスとアクセス可否の定義自体は不変。
