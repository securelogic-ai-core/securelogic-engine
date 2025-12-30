#!/usr/bin/env bash
set -e

if [ -z "$CUSTOMER_ID" ] || [ -z "$LICENSE_TIER" ]; then
  echo "Set CUSTOMER_ID and LICENSE_TIER"
  exit 1
fi

API=http://localhost:5050

echo "Submitting intake..."
RUN_ID=$(curl -s -X POST \
  -H "x-customer-id: $CUSTOMER_ID" \
  -H "x-license-tier: $LICENSE_TIER" \
  -F "evidence=@sample-evidence.pdf" \
  $API/intake \
| jq -r '.runId')

echo "Run created: $RUN_ID"

echo "Generating signed artifact..."
URL=$(curl -s -X POST \
  -H "x-customer-id: $CUSTOMER_ID" \
  -H "x-license-tier: $LICENSE_TIER" \
  $API/runs/$RUN_ID/artifacts \
| jq -r '.[0].filename' \
| xargs -I {} curl -s -X POST \
    -H "x-customer-id: $CUSTOMER_ID" \
    -H "x-license-tier: $LICENSE_TIER" \
    $API/artifacts/{}/signed \
| jq -r '.url')

echo "Downloading report..."
curl -O "$API$URL"

echo "AI AUDIT SPRINT COMPLETE"
