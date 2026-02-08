#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# Lemon Webhook Lifecycle Test
# Runs:
#   1) subscription_created   -> should set paid/true
#   2) subscription_cancelled -> should set free/false
#   3) subscription_resumed   -> should set paid/true
#
# Requires:
# - LEMON_WEBHOOK_SECRET
# - API_KEY_TO_ACTIVATE
# - ADMIN_KEY
#
# Optional:
# - BASE_URL (defaults to Render prod)
# ============================================================

BASE_URL="${BASE_URL:-https://securelogic-engine.onrender.com}"
LEMON_WEBHOOK_SECRET="${LEMON_WEBHOOK_SECRET:-}"
API_KEY_TO_ACTIVATE="${API_KEY_TO_ACTIVATE:-}"
ADMIN_KEY="${ADMIN_KEY:-}"

if [ -z "$LEMON_WEBHOOK_SECRET" ]; then
  echo "❌ Missing LEMON_WEBHOOK_SECRET"
  exit 1
fi

if [ -z "$API_KEY_TO_ACTIVATE" ]; then
  echo "❌ Missing API_KEY_TO_ACTIVATE"
  exit 1
fi

if [ -z "$ADMIN_KEY" ]; then
  echo "❌ Missing ADMIN_KEY"
  exit 1
fi

send_webhook () {
  local event_name="$1"

  local payload sig

  payload=$(cat <<EOF2
{
  "meta": {
    "event_name": "$event_name"
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
EOF2
)

  sig=$(printf "%s" "$payload" | openssl dgst -sha256 -hmac "$LEMON_WEBHOOK_SECRET" | awk '{print $2}')

  echo
  echo "=== Sending webhook: $event_name ==="
  echo "Signature=$sig"
  echo

  curl -s -i -X POST "$BASE_URL/webhooks/lemon" \
    -H "Content-Type: application/json" \
    -H "x-signature: $sig" \
    --data-binary "$payload" | sed 's/\r$//'
}

check_entitlement () {
  echo
  echo "=== Checking entitlement in Redis (admin endpoint) ==="
  echo

  curl -s "$BASE_URL/admin/entitlements/$API_KEY_TO_ACTIVATE" \
    -H "X-Admin-Key: $ADMIN_KEY" | jq
}

echo "=== Config ==="
echo "BASE_URL=$BASE_URL"
echo "API_KEY_TO_ACTIVATE=$API_KEY_TO_ACTIVATE"
echo "LEMON_WEBHOOK_SECRET=(set)"
echo "ADMIN_KEY=(set)"

# 1) subscription_created -> paid/true
send_webhook "subscription_created"
check_entitlement

# 2) subscription_cancelled -> free/false
send_webhook "subscription_cancelled"
check_entitlement

# 3) subscription_resumed -> paid/true
send_webhook "subscription_resumed"
check_entitlement

echo
echo "✅ Lifecycle test complete."
