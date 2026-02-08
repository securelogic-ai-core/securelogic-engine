#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# Test LemonSqueezy webhook locally against prod URL
# - Builds a fake webhook payload
# - Signs it using LEMON_WEBHOOK_SECRET
# - Sends it to /webhooks/lemon
#
# IMPORTANT:
# This assumes your backend webhook handler reads:
#   data.attributes.custom_data.apiKey
# and activates entitlement for THAT key.
# ============================================================

BASE_URL="${BASE_URL:-https://securelogic-engine.onrender.com}"
LEMON_WEBHOOK_SECRET="${LEMON_WEBHOOK_SECRET:-}"
API_KEY_TO_ACTIVATE="${API_KEY_TO_ACTIVATE:-}"
LEMON_EVENT_NAME="${LEMON_EVENT_NAME:-subscription_created}"

if [ -z "$LEMON_WEBHOOK_SECRET" ]; then
  echo "❌ Missing LEMON_WEBHOOK_SECRET"
  exit 1
fi

if [ -z "$API_KEY_TO_ACTIVATE" ]; then
  echo "❌ Missing API_KEY_TO_ACTIVATE"
  exit 1
fi

echo "=== Config ==="
echo "BASE_URL=$BASE_URL"
echo "API_KEY_TO_ACTIVATE=$API_KEY_TO_ACTIVATE"
echo "LEMON_EVENT_NAME=$LEMON_EVENT_NAME"
echo "LEMON_WEBHOOK_SECRET=(set)"

# ------------------------------------------------------------
# Fake Lemon payload
# NOTE:
# We only include fields we actually parse in our handler.
# ------------------------------------------------------------

PAYLOAD=$(cat <<EOF
{
  "meta": {
    "event_name": "$LEMON_EVENT_NAME"
  },
  "data": {
    "id": "sub_test_123",
    "attributes": {
      "status": "active",
      "custom_data": {
        "apiKey": "$API_KEY_TO_ACTIVATE"
      }
    }
  }
}
EOF
)

# ------------------------------------------------------------
# Create signature = HMAC SHA256 hex over raw JSON body
# ------------------------------------------------------------

SIG=$(printf "%s" "$PAYLOAD" | openssl dgst -sha256 -hmac "$LEMON_WEBHOOK_SECRET" | awk '{print $2}')

echo
echo "=== Sending webhook ==="
echo "Signature=$SIG"
echo

curl -i -X POST "$BASE_URL/webhooks/lemon" \
  -H "Content-Type: application/json" \
  -H "x-signature: $SIG" \
  --data-binary "$PAYLOAD"

echo
echo
echo "=== Done ==="
echo "Now check entitlement:"
echo
echo "curl -s \"$BASE_URL/admin/entitlements/$API_KEY_TO_ACTIVATE\" \\"
echo "  -H \"X-Admin-Key: \$ADMIN_KEY\" | jq"