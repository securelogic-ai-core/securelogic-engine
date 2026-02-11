#!/usr/bin/env bash
set -euo pipefail

echo "== SecureLogic Dev Smoke Test =="

# Always run from repo root
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# ---------------------------------------------------------
# 0) Load local dev env
# ---------------------------------------------------------
if [[ -f ".env.local" ]]; then
  echo "-> Loading .env.local"
  set -a
  # shellcheck disable=SC1091
  source ".env.local"
  set +a
else
  echo "❌ .env.local missing"
  exit 1
fi

: "${SECURELOGIC_ADMIN_KEY:?SECURELOGIC_ADMIN_KEY is not set}"
: "${SECURELOGIC_SIGNING_SECRET:?SECURELOGIC_SIGNING_SECRET is not set}"

SECURELOGIC_API_BASE="${SECURELOGIC_API_BASE:-http://127.0.0.1:4000}"
TEST_API_KEY="${TEST_API_KEY:-sl_1234567890abcdef}"

echo "-> Using API base: $SECURELOGIC_API_BASE"

# ---------------------------------------------------------
# 1) Health check
# ---------------------------------------------------------
echo "-> Checking /health"
curl -4 -sS "${SECURELOGIC_API_BASE}/health" | jq -e '.status == "ok"' >/dev/null
echo "✅ /health OK"

# ---------------------------------------------------------
# 2) Admin auth check
# ---------------------------------------------------------
echo "-> Checking admin auth (/admin/entitlements)"
curl -4 -sS "${SECURELOGIC_API_BASE}/admin/entitlements/${TEST_API_KEY}" \
  -H "X-Admin-Key: ${SECURELOGIC_ADMIN_KEY}" \
  | jq -e '.entitlement.tier' >/dev/null
echo "✅ Admin auth OK"

# ---------------------------------------------------------
# 3) Public issues check
# ---------------------------------------------------------
echo "-> Checking issues (/issues/latest)"
curl -4 -sS "${SECURELOGIC_API_BASE}/issues/latest" \
  -H "X-Api-Key: ${TEST_API_KEY}" \
  | jq -e '.issueNumber' >/dev/null
echo "✅ /issues/latest OK"

echo ""
echo "🎉 ALL SMOKE TESTS PASSED"
