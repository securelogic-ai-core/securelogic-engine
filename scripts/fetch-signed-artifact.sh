#!/usr/bin/env bash
set -e

if [ -z "$CUSTOMER_ID" ]; then
  echo "CUSTOMER_ID not set"
  exit 1
fi

if [ -z "$LICENSE_TIER" ]; then
  echo "LICENSE_TIER not set"
  exit 1
fi

if [ -z "$RUN_ID" ]; then
  echo "RUN_ID not set"
  exit 1
fi

API=http://localhost:5050

FILENAME=$(curl -s \
  -H "x-customer-id: $CUSTOMER_ID" \
  -H "x-license-tier: $LICENSE_TIER" \
  $API/runs/$RUN_ID/artifacts \
| jq -r '.[0].filename')

curl -s -X POST \
  -H "x-customer-id: $CUSTOMER_ID" \
  -H "x-license-tier: $LICENSE_TIER" \
  $API/artifacts/$FILENAME/signed \
| jq -r '.url' \
| xargs -I {} curl -O "$API{}"

echo "Downloaded: $FILENAME"
