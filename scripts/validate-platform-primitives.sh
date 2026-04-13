#!/usr/bin/env bash
# =============================================================
# validate-platform-primitives.sh
#
# Live validation harness for:
#   platform-foundation-findings-actions-posture
#
# Covers all done conditions that require a running API:
#   - POST/GET/PATCH /api/actions
#   - GET/PATCH /api/findings
#   - POST/GET/GET /api/posture/snapshot|latest|history
#   - entitlement gate (no key / wrong key)
#   - cross-org protection (WRONG_ORG_KEY)
#
# Usage:
#   TEST_API_KEY=sl_xxx SECURELOGIC_API_BASE=http://localhost:4000 \
#     bash scripts/validate-platform-primitives.sh
#
# Optional cross-org test:
#   WRONG_ORG_KEY=sl_yyy   (a key from a DIFFERENT org)
#
# =============================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# ------------------------------------------------------------------
# Load env
# ------------------------------------------------------------------
if [[ -f ".env.local" ]]; then
  set -a; source ".env.local"; set +a
elif [[ -f ".env" ]]; then
  set -a; source ".env"; set +a
fi

BASE="${SECURELOGIC_API_BASE:-http://127.0.0.1:4000}"
KEY="${TEST_API_KEY:?TEST_API_KEY is required}"
WRONG_KEY="${WRONG_ORG_KEY:-}"
TIMEOUT="${CURL_TIMEOUT:-10}"

# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------
PASS=0; FAIL=0

green() { printf "\033[32m✅ PASS: %s\033[0m\n" "$*"; }
red()   { printf "\033[31m❌ FAIL: %s\033[0m\n" "$*"; }
section() { printf "\n\033[33m=== %s ===\033[0m\n" "$*"; }

pass() { green "$*"; PASS=$((PASS+1)); }
fail() { red   "$*"; FAIL=$((FAIL+1)); }

# Returns HTTP status code only
http_code() {
  local method="$1" url="$2"; shift 2
  curl -s -o /dev/null -w "%{http_code}" --max-time "$TIMEOUT" -X "$method" "$url" "$@"
}

# Returns body (pretty-printed if jq available)
http_body() {
  local url="$1"; shift
  if command -v jq >/dev/null 2>&1; then
    curl -s --max-time "$TIMEOUT" "$url" "$@" | jq .
  else
    curl -s --max-time "$TIMEOUT" "$url" "$@"
  fi
}

# Returns body of a POST/PATCH
http_body_method() {
  local method="$1" url="$2"; shift 2
  if command -v jq >/dev/null 2>&1; then
    curl -s --max-time "$TIMEOUT" -X "$method" "$url" "$@" | jq .
  else
    curl -s --max-time "$TIMEOUT" -X "$method" "$url" "$@"
  fi
}

# Extract a JSON field value (requires jq)
jq_field() { echo "$1" | jq -r "$2" 2>/dev/null || echo ""; }

# ------------------------------------------------------------------
# 0. Health check (sanity gate)
# ------------------------------------------------------------------
section "0. Health check"
code="$(http_code GET "$BASE/health")"
if [[ "$code" == "200" ]]; then
  pass "/health returns 200"
else
  fail "/health expected 200 got $code — is the server running at $BASE?"
  echo "Cannot continue without a live server."
  exit 1
fi

# ------------------------------------------------------------------
# 1. Entitlement gate — no key
# ------------------------------------------------------------------
section "1. Entitlement gate — no API key"
code="$(http_code GET "$BASE/api/actions")"
if [[ "$code" == "401" ]]; then
  pass "GET /api/actions with no key returns 401"
else
  fail "GET /api/actions with no key expected 401 got $code"
fi

code="$(http_code GET "$BASE/api/findings")"
if [[ "$code" == "401" ]]; then
  pass "GET /api/findings with no key returns 401"
else
  fail "GET /api/findings with no key expected 401 got $code"
fi

code="$(http_code POST "$BASE/api/posture/snapshot" -H "Content-Type: application/json" -d '{}')"
if [[ "$code" == "401" ]]; then
  pass "POST /api/posture/snapshot with no key returns 401"
else
  fail "POST /api/posture/snapshot with no key expected 401 got $code"
fi

# ------------------------------------------------------------------
# 2. Entitlement gate — invalid key
# ------------------------------------------------------------------
section "2. Entitlement gate — invalid key"
code="$(http_code GET "$BASE/api/actions" -H "X-Api-Key: sl_invalid_key_$(date +%s)")"
if [[ "$code" == "401" || "$code" == "403" ]]; then
  pass "GET /api/actions with invalid key returns $code (blocked)"
else
  fail "GET /api/actions with invalid key expected 401/403 got $code"
fi

# ------------------------------------------------------------------
# 3. POST /api/actions
# ------------------------------------------------------------------
section "3. POST /api/actions"
ACTION_BODY="$(http_body_method POST "$BASE/api/actions" \
  -H "X-Api-Key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{"title":"Validate platform primitive harness","source_type":"manual","priority":"planned"}')"

ACTION_CODE="$(http_code POST "$BASE/api/actions" \
  -H "X-Api-Key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{"title":"Validate platform primitive harness 2","source_type":"manual","priority":"watch"}' )"

if command -v jq >/dev/null 2>&1; then
  ACTION_ID="$(jq_field "$ACTION_BODY" '.action.id')"
  ACTION_STATUS="$(jq_field "$ACTION_BODY" '.action.status')"
  ACTION_ORG="$(jq_field "$ACTION_BODY" '.action.organization_id')"
else
  ACTION_ID=""
fi

if [[ "$ACTION_CODE" == "201" ]]; then
  pass "POST /api/actions returns 201"
else
  fail "POST /api/actions expected 201 got $ACTION_CODE"
fi

if [[ -n "$ACTION_ID" && "$ACTION_ID" != "null" ]]; then
  pass "POST /api/actions returned action.id=$ACTION_ID"
else
  fail "POST /api/actions did not return a valid action.id (got: $ACTION_ID)"
fi

if [[ "$ACTION_STATUS" == "open" ]]; then
  pass "New action has status=open"
else
  fail "New action expected status=open got $ACTION_STATUS"
fi

# ------------------------------------------------------------------
# 4. GET /api/actions
# ------------------------------------------------------------------
section "4. GET /api/actions"
LIST_BODY="$(http_body "$BASE/api/actions" -H "X-Api-Key: $KEY")"
LIST_CODE="$(http_code GET "$BASE/api/actions" -H "X-Api-Key: $KEY")"

if [[ "$LIST_CODE" == "200" ]]; then
  pass "GET /api/actions returns 200"
else
  fail "GET /api/actions expected 200 got $LIST_CODE"
fi

if command -v jq >/dev/null 2>&1; then
  LIST_COUNT="$(jq_field "$LIST_BODY" '.count')"
  HAS_ORG_ID="$(jq_field "$LIST_BODY" '.organizationId')"
  if [[ -n "$LIST_COUNT" && "$LIST_COUNT" != "null" ]]; then
    pass "GET /api/actions response has count=$LIST_COUNT"
  else
    fail "GET /api/actions response missing count field"
  fi
  if [[ -n "$HAS_ORG_ID" && "$HAS_ORG_ID" != "null" ]]; then
    pass "GET /api/actions response has organizationId"
  else
    fail "GET /api/actions response missing organizationId"
  fi
fi

# Filter test
FILTER_CODE="$(http_code GET "$BASE/api/actions?status=open" -H "X-Api-Key: $KEY")"
if [[ "$FILTER_CODE" == "200" ]]; then
  pass "GET /api/actions?status=open returns 200"
else
  fail "GET /api/actions?status=open expected 200 got $FILTER_CODE"
fi

BAD_FILTER_CODE="$(http_code GET "$BASE/api/actions?status=invalid_status" -H "X-Api-Key: $KEY")"
if [[ "$BAD_FILTER_CODE" == "400" ]]; then
  pass "GET /api/actions?status=invalid rejects with 400"
else
  fail "GET /api/actions?status=invalid expected 400 got $BAD_FILTER_CODE"
fi

# ------------------------------------------------------------------
# 5. PATCH /api/actions/:id
# ------------------------------------------------------------------
section "5. PATCH /api/actions/:id"
if [[ -n "$ACTION_ID" && "$ACTION_ID" != "null" ]]; then
  PATCH_BODY="$(http_body_method PATCH "$BASE/api/actions/$ACTION_ID" \
    -H "X-Api-Key: $KEY" \
    -H "Content-Type: application/json" \
    -d '{"status":"in_progress","priority":"near_term"}')"
  PATCH_CODE="$(http_code PATCH "$BASE/api/actions/$ACTION_ID" \
    -H "X-Api-Key: $KEY" \
    -H "Content-Type: application/json" \
    -d '{"status":"in_progress"}')"

  if [[ "$PATCH_CODE" == "200" ]]; then
    pass "PATCH /api/actions/:id returns 200"
  else
    fail "PATCH /api/actions/:id expected 200 got $PATCH_CODE"
  fi

  if command -v jq >/dev/null 2>&1; then
    PATCHED_STATUS="$(jq_field "$PATCH_BODY" '.action.status')"
    if [[ "$PATCHED_STATUS" == "in_progress" ]]; then
      pass "PATCH /api/actions/:id updated status=in_progress"
    else
      fail "PATCH /api/actions/:id expected status=in_progress got $PATCHED_STATUS"
    fi
  fi

  # Patch non-existent ID → 404
  FAKE_CODE="$(http_code PATCH "$BASE/api/actions/00000000-0000-0000-0000-000000000000" \
    -H "X-Api-Key: $KEY" \
    -H "Content-Type: application/json" \
    -d '{"status":"closed"}')"
  if [[ "$FAKE_CODE" == "404" ]]; then
    pass "PATCH /api/actions/<unknown-id> returns 404"
  else
    fail "PATCH /api/actions/<unknown-id> expected 404 got $FAKE_CODE"
  fi
else
  fail "PATCH /api/actions/:id skipped — no action ID from step 3"
fi

# ------------------------------------------------------------------
# 6. GET /api/findings
# ------------------------------------------------------------------
section "6. GET /api/findings"
FINDINGS_BODY="$(http_body "$BASE/api/findings" -H "X-Api-Key: $KEY")"
FINDINGS_CODE="$(http_code GET "$BASE/api/findings" -H "X-Api-Key: $KEY")"

if [[ "$FINDINGS_CODE" == "200" ]]; then
  pass "GET /api/findings returns 200"
else
  fail "GET /api/findings expected 200 got $FINDINGS_CODE"
fi

FINDING_ID=""
if command -v jq >/dev/null 2>&1; then
  FINDINGS_COUNT="$(jq_field "$FINDINGS_BODY" '.count')"
  pass "GET /api/findings returned count=$FINDINGS_COUNT"

  FINDING_ID="$(echo "$FINDINGS_BODY" | jq -r '.findings[0].id // ""' 2>/dev/null || echo "")"
  SOURCE_TYPE="$(echo "$FINDINGS_BODY" | jq -r '.findings[0].source_type // ""' 2>/dev/null || echo "")"

  if [[ -n "$FINDING_ID" && "$FINDING_ID" != "null" ]]; then
    pass "GET /api/findings returned finding.id=$FINDING_ID"
    if [[ -n "$SOURCE_TYPE" && "$SOURCE_TYPE" != "null" ]]; then
      pass "Finding has source_type=$SOURCE_TYPE (platform field present)"
    else
      fail "Finding missing source_type field (migration may not be applied)"
    fi
  else
    echo "  ⚠️  No findings exist yet — PATCH /api/findings/:id test will be skipped."
    echo "     Run POST /api/assess first to create findings, then re-run this script."
  fi
fi

# source_id filter
SRCID_CODE="$(http_code GET "$BASE/api/findings?source_id=00000000-0000-0000-0000-000000000000" -H "X-Api-Key: $KEY")"
if [[ "$SRCID_CODE" == "200" ]]; then
  pass "GET /api/findings?source_id=<uuid> returns 200 (empty list is fine)"
else
  fail "GET /api/findings?source_id=<uuid> expected 200 got $SRCID_CODE"
fi

BAD_SRCID_CODE="$(http_code GET "$BASE/api/findings?source_id=not-a-uuid" -H "X-Api-Key: $KEY")"
if [[ "$BAD_SRCID_CODE" == "400" ]]; then
  pass "GET /api/findings?source_id=not-a-uuid rejects with 400"
else
  fail "GET /api/findings?source_id=not-a-uuid expected 400 got $BAD_SRCID_CODE"
fi

# ------------------------------------------------------------------
# 7. PATCH /api/findings/:id
# ------------------------------------------------------------------
section "7. PATCH /api/findings/:id"
if [[ -n "$FINDING_ID" && "$FINDING_ID" != "null" ]]; then
  FPATCH_BODY="$(http_body_method PATCH "$BASE/api/findings/$FINDING_ID" \
    -H "X-Api-Key: $KEY" \
    -H "Content-Type: application/json" \
    -d '{"status":"in_progress","priority":"near_term"}')"
  FPATCH_CODE="$(http_code PATCH "$BASE/api/findings/$FINDING_ID" \
    -H "X-Api-Key: $KEY" \
    -H "Content-Type: application/json" \
    -d '{"status":"in_progress"}')"

  if [[ "$FPATCH_CODE" == "200" ]]; then
    pass "PATCH /api/findings/:id returns 200"
  else
    fail "PATCH /api/findings/:id expected 200 got $FPATCH_CODE"
  fi

  if command -v jq >/dev/null 2>&1; then
    FPATCHED_STATUS="$(jq_field "$FPATCH_BODY" '.finding.status')"
    if [[ "$FPATCHED_STATUS" == "in_progress" ]]; then
      pass "PATCH /api/findings/:id updated status=in_progress"
    else
      fail "PATCH /api/findings/:id expected status=in_progress got $FPATCHED_STATUS"
    fi
  fi

  FFAKE_CODE="$(http_code PATCH "$BASE/api/findings/00000000-0000-0000-0000-000000000000" \
    -H "X-Api-Key: $KEY" \
    -H "Content-Type: application/json" \
    -d '{"status":"closed"}')"
  if [[ "$FFAKE_CODE" == "404" ]]; then
    pass "PATCH /api/findings/<unknown-id> returns 404"
  else
    fail "PATCH /api/findings/<unknown-id> expected 404 got $FFAKE_CODE"
  fi
else
  echo "  ⚠️  PATCH /api/findings/:id skipped — no findings exist for this org yet."
fi

# ------------------------------------------------------------------
# 8. POST /api/posture/snapshot
# ------------------------------------------------------------------
section "8. POST /api/posture/snapshot"
SNAP_BODY="$(http_body_method POST "$BASE/api/posture/snapshot" \
  -H "X-Api-Key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{}')"
SNAP_CODE="$(http_code POST "$BASE/api/posture/snapshot" \
  -H "X-Api-Key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{}')"

if [[ "$SNAP_CODE" == "201" ]]; then
  pass "POST /api/posture/snapshot returns 201"
else
  fail "POST /api/posture/snapshot expected 201 got $SNAP_CODE"
fi

SNAP_ID=""
if command -v jq >/dev/null 2>&1; then
  SNAP_ID="$(jq_field "$SNAP_BODY" '.snapshotId')"
  SNAP_SCORE="$(jq_field "$SNAP_BODY" '.overallScore')"
  SNAP_SEVERITY="$(jq_field "$SNAP_BODY" '.overallSeverity')"
  SNAP_DATE="$(jq_field "$SNAP_BODY" '.snapshotDate')"

  if [[ -n "$SNAP_ID" && "$SNAP_ID" != "null" ]]; then
    pass "POST /api/posture/snapshot returned snapshotId=$SNAP_ID"
  else
    fail "POST /api/posture/snapshot missing snapshotId"
  fi
  if [[ -n "$SNAP_SCORE" && "$SNAP_SCORE" != "null" ]]; then
    pass "POST /api/posture/snapshot returned overallScore=$SNAP_SCORE severity=$SNAP_SEVERITY"
  else
    fail "POST /api/posture/snapshot missing overallScore"
  fi
  if [[ -n "$SNAP_DATE" && "$SNAP_DATE" != "null" ]]; then
    pass "POST /api/posture/snapshot returned snapshotDate=$SNAP_DATE"
  else
    fail "POST /api/posture/snapshot missing snapshotDate"
  fi
fi

# Idempotency — second call on same day should also 201 (upsert)
SNAP2_CODE="$(http_code POST "$BASE/api/posture/snapshot" \
  -H "X-Api-Key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{}')"
if [[ "$SNAP2_CODE" == "201" ]]; then
  pass "POST /api/posture/snapshot is idempotent (second call same day returns 201)"
else
  fail "POST /api/posture/snapshot idempotency expected 201 got $SNAP2_CODE"
fi

# ------------------------------------------------------------------
# 9. GET /api/posture/latest
# ------------------------------------------------------------------
section "9. GET /api/posture/latest"
LATEST_BODY="$(http_body "$BASE/api/posture/latest" -H "X-Api-Key: $KEY")"
LATEST_CODE="$(http_code GET "$BASE/api/posture/latest" -H "X-Api-Key: $KEY")"

if [[ "$LATEST_CODE" == "200" ]]; then
  pass "GET /api/posture/latest returns 200"
else
  fail "GET /api/posture/latest expected 200 got $LATEST_CODE"
fi

if command -v jq >/dev/null 2>&1 && [[ -n "$SNAP_ID" && "$SNAP_ID" != "null" ]]; then
  LATEST_ID="$(jq_field "$LATEST_BODY" '.snapshot.id')"
  if [[ "$LATEST_ID" == "$SNAP_ID" ]]; then
    pass "GET /api/posture/latest id matches snapshot from step 8"
  else
    fail "GET /api/posture/latest id=$LATEST_ID does not match snapshot=$SNAP_ID"
  fi
fi

# ------------------------------------------------------------------
# 10. GET /api/posture/history
# ------------------------------------------------------------------
section "10. GET /api/posture/history"
HIST_CODE="$(http_code GET "$BASE/api/posture/history" -H "X-Api-Key: $KEY")"
if [[ "$HIST_CODE" == "200" ]]; then
  pass "GET /api/posture/history returns 200"
else
  fail "GET /api/posture/history expected 200 got $HIST_CODE"
fi

HIST_CODE30="$(http_code GET "$BASE/api/posture/history?days=30" -H "X-Api-Key: $KEY")"
if [[ "$HIST_CODE30" == "200" ]]; then
  pass "GET /api/posture/history?days=30 returns 200"
else
  fail "GET /api/posture/history?days=30 expected 200 got $HIST_CODE30"
fi

# ------------------------------------------------------------------
# 11. Cross-org protection
# ------------------------------------------------------------------
section "11. Cross-org protection"
if [[ -z "$WRONG_KEY" ]]; then
  echo "  ⚠️  WRONG_ORG_KEY not set — cross-org tests skipped."
  echo "     Set WRONG_ORG_KEY=<api-key-from-different-org> to enable."
else
  if [[ -n "$ACTION_ID" && "$ACTION_ID" != "null" ]]; then
    XORG_ACTION_CODE="$(http_code PATCH "$BASE/api/actions/$ACTION_ID" \
      -H "X-Api-Key: $WRONG_KEY" \
      -H "Content-Type: application/json" \
      -d '{"status":"closed"}')"
    if [[ "$XORG_ACTION_CODE" == "404" ]]; then
      pass "Cross-org PATCH /api/actions/:id returns 404 (org isolation confirmed)"
    else
      fail "Cross-org PATCH /api/actions/:id expected 404 got $XORG_ACTION_CODE (ISOLATION BREACH)"
    fi
  fi

  if [[ -n "$FINDING_ID" && "$FINDING_ID" != "null" ]]; then
    XORG_FINDING_CODE="$(http_code PATCH "$BASE/api/findings/$FINDING_ID" \
      -H "X-Api-Key: $WRONG_KEY" \
      -H "Content-Type: application/json" \
      -d '{"status":"closed"}')"
    if [[ "$XORG_FINDING_CODE" == "404" ]]; then
      pass "Cross-org PATCH /api/findings/:id returns 404 (org isolation confirmed)"
    else
      fail "Cross-org PATCH /api/findings/:id expected 404 got $XORG_FINDING_CODE (ISOLATION BREACH)"
    fi
  fi

  XORG_ACTIONS_LIST="$(http_code GET "$BASE/api/actions" -H "X-Api-Key: $WRONG_KEY")"
  if [[ "$XORG_ACTIONS_LIST" == "200" ]]; then
    # List returns 200 but must not contain this org's action
    if command -v jq >/dev/null 2>&1 && [[ -n "$ACTION_ID" ]]; then
      WRONG_ORG_CONTAINS="$(http_body "$BASE/api/actions" -H "X-Api-Key: $WRONG_KEY" \
        | jq --arg id "$ACTION_ID" '[.actions[].id] | contains([$id])')"
      if [[ "$WRONG_ORG_CONTAINS" == "false" ]]; then
        pass "GET /api/actions from wrong-org key does not expose this org's actions"
      else
        fail "GET /api/actions from wrong-org key LEAKS this org's action (ISOLATION BREACH)"
      fi
    fi
  fi
fi

# ------------------------------------------------------------------
# Summary
# ------------------------------------------------------------------
section "Summary"
echo "PASS=$PASS  FAIL=$FAIL"
echo ""

if [[ "$FAIL" -gt 0 ]]; then
  red "VALIDATION FAILED — $FAIL check(s) did not pass"
  exit 1
else
  green "ALL CHECKS PASSED ($PASS passed, $FAIL failed)"
  exit 0
fi
