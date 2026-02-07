#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# SecureLogic Engine - Production Smoke Test
# - Runs health + auth + admin publish + entitlement security
#   + gating + rate-limit
# - Prints PASS/FAIL
# - Exits non-zero on any failure
# ============================================================

BASE_URL="${BASE_URL:-https://securelogic-engine.onrender.com}"
FREE_KEY="${FREE_KEY:-test_key_123}"                         # free/test key
ADMIN_KEY="${ADMIN_KEY:-}"                                   # optional
ISSUE_JSON_PATH="${ISSUE_JSON_PATH:-./data/issues/issue-4.json}"
PAID_KEY="${PAID_KEY:-}"                                     # optional paid key

CURL_TIMEOUT="${CURL_TIMEOUT:-10}"
RATE_TEST_N="${RATE_TEST_N:-150}"                             # keep reasonable for smoke
RATE_LIMIT_WAIT_SECONDS="${RATE_LIMIT_WAIT_SECONDS:-60}"      # backoff if already limited

PASS=0
FAIL=0

red()   { printf "\033[31m%s\033[0m\n" "$*"; }
green() { printf "\033[32m%s\033[0m\n" "$*"; }
yellow(){ printf "\033[33m%s\033[0m\n" "$*"; }

fail() { red "FAIL: $*"; FAIL=$((FAIL+1)); }
pass() { green "PASS: $*"; PASS=$((PASS+1)); }

have_cmd() { command -v "$1" >/dev/null 2>&1; }

require_cmds() {
  local missing=0
  for c in curl; do
    if ! have_cmd "$c"; then
      red "Missing required command: $c"
      missing=1
    fi
  done
  if [ "$missing" -eq 1 ]; then
    exit 2
  fi
}

http_code() {
  local method="$1"; shift
  local url="$1"; shift
  curl -s -o /dev/null -w "%{http_code}" --max-time "$CURL_TIMEOUT" -X "$method" "$url" "$@"
}

json_get() {
  local url="$1"; shift
  if have_cmd jq; then
    curl -s --max-time "$CURL_TIMEOUT" "$url" "$@" | jq .
  else
    curl -s --max-time "$CURL_TIMEOUT" "$url" "$@"
  fi
}

section() { yellow "\n=== $* ==="; }

wait_if_rate_limited() {
  local code
  code="$(http_code GET "$BASE_URL/issues/latest" -H "Authorization: Bearer $FREE_KEY")"

  if [ "$code" = "429" ]; then
    yellow "Already rate-limited (429). Waiting ${RATE_LIMIT_WAIT_SECONDS}s..."
    sleep "$RATE_LIMIT_WAIT_SECONDS"
  fi
}

main() {
  require_cmds

  section "Config"
  echo "BASE_URL=$BASE_URL"
  echo "FREE_KEY=${FREE_KEY:0:4}…"
  echo "ADMIN_KEY=${ADMIN_KEY:+(set)}"
  echo "PAID_KEY=${PAID_KEY:+(set)}"
  echo "ISSUE_JSON_PATH=$ISSUE_JSON_PATH"
  echo "RATE_TEST_N=$RATE_TEST_N"

  section "Health"
  code="$(http_code GET "$BASE_URL/health")"
  if [ "$code" = "200" ]; then pass "/health returns 200"; else fail "/health expected 200 got $code"; fi

  section "Auth basics"
  code="$(http_code GET "$BASE_URL/issues/latest")"
  if [ "$code" = "401" ]; then pass "No key => /issues/latest returns 401"; else fail "No key expected 401 got $code"; fi

  code="$(http_code GET "$BASE_URL/issues/latest" -H "Authorization: Bearer wrong_key")"
  if [ "$code" = "403" ]; then pass "Wrong key => /issues/latest returns 403"; else fail "Wrong key expected 403 got $code"; fi

  # IMPORTANT:
  # If the user already triggered 429 earlier, wait now so functional tests are meaningful.
  wait_if_rate_limited

  section "Option 2 security: unknown key should 403 (no entitlement)"
  UNKNOWN_KEY="sl_unknown_$(date +%s)_$RANDOM"
  code="$(http_code GET "$BASE_URL/issues/latest" -H "Authorization: Bearer $UNKNOWN_KEY")"
  if [ "$code" = "403" ]; then
    pass "Unknown key blocked (403)"
  else
    fail "Unknown key expected 403 got $code"
    yellow "Response:"
    json_get "$BASE_URL/issues/latest" -H "Authorization: Bearer $UNKNOWN_KEY" || true
  fi

  section "Admin publish (optional but recommended)"
  if [ -z "$ADMIN_KEY" ]; then
    yellow "Skipping admin publish test (ADMIN_KEY not set)."
  else
    if [ ! -f "$ISSUE_JSON_PATH" ]; then
      fail "ISSUE_JSON_PATH not found: $ISSUE_JSON_PATH"
    else
      code="$(http_code POST "$BASE_URL/admin/issues/publish" \
        -H "X-Admin-Key: $ADMIN_KEY" \
        -H "Content-Type: application/json" \
        --data-binary @"$ISSUE_JSON_PATH")"
      if [ "$code" = "200" ]; then
        pass "Admin publish returns 200"
      else
        fail "Admin publish expected 200 got $code"
      fi
    fi
  fi

  # After publish, wait again if needed
  wait_if_rate_limited

  section "Free key: latest issue should be accessible"
  code="$(http_code GET "$BASE_URL/issues/latest" -H "Authorization: Bearer $FREE_KEY")"
  if [ "$code" = "200" ]; then
    pass "Free key => /issues/latest returns 200"
  else
    fail "Free key expected 200 got $code"
  fi

  section "Gating: /issues/:id should be paid-only"
  code="$(http_code GET "$BASE_URL/issues/4" -H "Authorization: Bearer $FREE_KEY")"
  if [ "$code" = "402" ]; then
    pass "Free key blocked from /issues/4 (402)"
  else
    fail "Expected 402 for free key on /issues/4 got $code"
  fi

  if [ -n "$PAID_KEY" ]; then
    code="$(http_code GET "$BASE_URL/issues/4" -H "Authorization: Bearer $PAID_KEY")"
    if [ "$code" = "200" ]; then
      pass "Paid key allowed on /issues/4 (200)"
    else
      fail "Paid key expected 200 on /issues/4 got $code"
      yellow "Response:"
      json_get "$BASE_URL/issues/4" -H "Authorization: Bearer $PAID_KEY" || true
    fi
  else
    yellow "Skipping paid key test (PAID_KEY not set)."
  fi

  section "Rate limit: confirm 429 eventually occurs"
  saw_429=0
  for i in $(seq 1 "$RATE_TEST_N"); do
    code="$(http_code GET "$BASE_URL/issues/latest" -H "Authorization: Bearer $FREE_KEY")"
    if [ "$code" = "429" ]; then
      saw_429=1
      break
    fi
  done

  if [ "$saw_429" -eq 1 ]; then
    pass "Rate limit triggered (saw 429 within $RATE_TEST_N requests)"
  else
    fail "Did not observe 429 within $RATE_TEST_N requests (rate limit may be too high or disabled)"
  fi

  section "Summary"
  echo "PASS=$PASS  FAIL=$FAIL"

  if [ "$FAIL" -gt 0 ]; then
    exit 1
  fi
  exit 0
}

main "$@"