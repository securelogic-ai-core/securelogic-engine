#!/usr/bin/env bash
set -euo pipefail

# =========================================================
# SecureLogic — Enterprise Publish Script
# - Fail fast on missing env vars / bad inputs
# - Refuse placeholder keys
# - Validate file exists + is valid JSON
# - Clear, consistent error output
# =========================================================

usage() {
  cat <<'USAGE'
Usage:
  ./scripts/publish-issue.sh <signed-issue.json>

Required env:
  SECURELOGIC_ADMIN_KEY   Admin key for /admin routes

Optional env:
  SECURELOGIC_API_BASE    Base URL (default: http://127.0.0.1:4000)
  CURL_TIMEOUT_SECONDS    Total request timeout (default: 20)
  CURL_CONNECT_TIMEOUT    Connect timeout (default: 5)

Examples:
  export SECURELOGIC_ADMIN_KEY="sl_admin_..."
  export SECURELOGIC_API_BASE="http://127.0.0.1:4000"
  ./scripts/publish-issue.sh /tmp/signed_issue_2.json
USAGE
}

die() {
  echo "❌ $*" >&2
  exit 1
}

# -------- args --------
FILE="${1:-}"
[[ -n "$FILE" ]] || { usage; exit 1; }

# -------- env guards --------
: "${SECURELOGIC_ADMIN_KEY:?SECURELOGIC_ADMIN_KEY is not set}"
: "${SECURELOGIC_API_BASE:=http://127.0.0.1:4000}"
: "${CURL_TIMEOUT_SECONDS:=20}"
: "${CURL_CONNECT_TIMEOUT:=5}"

if [[ "${SECURELOGIC_ADMIN_KEY}" == "your_admin_key_here" ]]; then
  die "SECURELOGIC_ADMIN_KEY is still the placeholder. Export the real key."
fi

# basic sanity checks (don’t overfit)
if [[ "${#SECURELOGIC_ADMIN_KEY}" -lt 16 ]]; then
  die "SECURELOGIC_ADMIN_KEY looks too short. Refusing to run."
fi

# -------- file checks --------
[[ -f "$FILE" ]] || die "File not found: $FILE"
[[ -r "$FILE" ]] || die "File not readable: $FILE"
[[ -s "$FILE" ]] || die "File is empty: $FILE"

# -------- dependency checks --------
command -v curl >/dev/null 2>&1 || die "curl is required"
if command -v jq >/dev/null 2>&1; then
  if ! jq -e . "$FILE" >/dev/null 2>&1; then
    die "Input is not valid JSON (jq failed): $FILE"
  fi
else
  # minimal JSON sanity fallback (not a full validator)
  python - <<PY >/dev/null 2>&1 || die "Input is not valid JSON (python json parse failed): $FILE"
import json, sys
with open("$FILE","r",encoding="utf-8") as f:
    json.load(f)
PY
fi

# -------- request --------
URL="${SECURELOGIC_API_BASE%/}/admin/issues/publish"
TMP_BODY="$(mktemp)"
TMP_HEADERS="$(mktemp)"
cleanup() { rm -f "$TMP_BODY" "$TMP_HEADERS"; }
trap cleanup EXIT

HTTP_CODE="$(
  curl -4 -sS \
    --connect-timeout "${CURL_CONNECT_TIMEOUT}" \
    --max-time "${CURL_TIMEOUT_SECONDS}" \
    -D "$TMP_HEADERS" \
    -o "$TMP_BODY" \
    -w "%{http_code}" \
    -X POST "$URL" \
    -H "X-Admin-Key: ${SECURELOGIC_ADMIN_KEY}" \
    -H "Content-Type: application/json" \
    --data-binary "@${FILE}" \
  || true
)"

# If curl itself failed, HTTP_CODE may be empty or non-numeric
if ! [[ "$HTTP_CODE" =~ ^[0-9]{3}$ ]]; then
  echo "---- response headers ----" >&2
  cat "$TMP_HEADERS" >&2 || true
  echo "---- response body ----" >&2
  cat "$TMP_BODY" >&2 || true
  die "Request failed (no valid HTTP status). Check SECURELOGIC_API_BASE and server logs."
fi

# Pretty print JSON if possible
print_body() {
  if command -v jq >/dev/null 2>&1; then
    if jq -e . "$TMP_BODY" >/dev/null 2>&1; then
      jq . "$TMP_BODY"
      return
    fi
  fi
  cat "$TMP_BODY"
}

if [[ "$HTTP_CODE" -ge 200 && "$HTTP_CODE" -lt 300 ]]; then
  print_body
  exit 0
fi

# Non-2xx: show useful context and fail
echo "---- publish failed ----" >&2
echo "URL: $URL" >&2
echo "HTTP: $HTTP_CODE" >&2
REQ_ID="$(grep -i '^x-request-id:' "$TMP_HEADERS" | head -n1 | cut -d' ' -f2- | tr -d '\r' || true)"
[[ -n "$REQ_ID" ]] && echo "x-request-id: $REQ_ID" >&2

echo "---- response body ----" >&2
print_body >&2
exit 1