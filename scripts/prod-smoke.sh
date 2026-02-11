#!/usr/bin/env bash
set -euo pipefail

echo "== SecureLogic PROD Smoke Test =="

# Always run from repo root
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# ---------------------------------------------------------
# 0) Required env vars (FAIL CLOSED)
# ---------------------------------------------------------
: "${SECURELOGIC_API_BASE:?SECURELOGIC_API_BASE is not set}"
: "${SECURELOGIC_ADMIN_KEY:?SECURELOGIC_ADMIN_KEY is not set}"
: "${TEST_API_KEY:?TEST_API_KEY is not set}"

# ---------------------------------------------------------
# 1) Display target
# ---------------------------------------------------------
echo "-> Target API base: $SECURELOGIC_API_BASE"

# ---------------------------------------------------------
# 2) Health check
# ---------------------------------------------------------
echo "-> Checking /health"
curl -4 -sS "${SECURELOGIC_API_BASE}/health" | jq -e '.status == "ok"' >/dev/null
echo "✅ /health OK"

# ---------------------------------------------------------
# 3) Version check
# ---------------------------------------------------------
echo "-> Checking /version"
curl -4 -sS "${SECURELOGIC_API_BASE}/version" | jq -e '.service == "securelogic-engine"' >/dev/null
echo "✅ /version OK"

# ---------------------------------------------------------
# 4) Admin auth check
# ---------------------------------------------------------
echo "-> Checking admin auth (/admin/entitlements)"
curl -4 -sS "${SECURELOGIC_API_BASE}/admin/entitlements/${TEST_API_KEY}" \
  -H "X-Admin-Key: ${SECURELOGIC_ADMIN_KEY}" \
  | jq -e '.entitlement.tier' >/dev/null
echo "✅ Admin auth OK"

# ---------------------------------------------------------
# 5) Issues access check
# ---------------------------------------------------------
echo "-> Checking issues (/issues/latest)"
curl -4 -sS "${SECURELOGIC_API_BASE}/issues/latest" \
  -H "X-Api-Key: ${TEST_API_KEY}" \
  | jq -e '.issueNumber' >/dev/null
echo "✅ /issues/latest OK"

echo ""
echo "🎉 PROD SMOKE TESTS PASSED"
