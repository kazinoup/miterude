#!/usr/bin/env bash
# parse-inbox Edge Function を手動キックするスクリプト。
#
# 使い方:
#   ./scripts/parse-inbox.sh                # 全 pending を捌く（最大 500）
#   ./scripts/parse-inbox.sh 100            # 上限 100 件
#
# Supabase 側で pg_cron が 10 分おきに自動実行しているので、通常は不要。
# Webhook を大量に流したあとに即パースしたい時や、debug で詰まりを解消する時に使う。
#
# 認証は VITE_SUPABASE_ANON_KEY を利用（.env.local から読む）。

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${PROJECT_DIR}/.env.local"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Error: ${ENV_FILE} が見つかりません。" >&2
  exit 1
fi

# .env.local を読み込む（VITE_ 系のみ）
# shellcheck disable=SC2046
export $(grep -E '^VITE_SUPABASE_(URL|ANON_KEY)=' "${ENV_FILE}" | xargs)

if [[ -z "${VITE_SUPABASE_URL:-}" || -z "${VITE_SUPABASE_ANON_KEY:-}" ]]; then
  echo "Error: VITE_SUPABASE_URL または VITE_SUPABASE_ANON_KEY が未設定です。" >&2
  exit 1
fi

LIMIT="${1:-500}"

echo "Invoking parse-inbox (limit=${LIMIT}) ..."
curl -sS -X POST \
  "${VITE_SUPABASE_URL}/functions/v1/parse-inbox?limit=${LIMIT}" \
  -H "Authorization: Bearer ${VITE_SUPABASE_ANON_KEY}" \
  -H "Content-Type: application/json" \
  --max-time 120 | jq . 2>/dev/null || cat
echo
