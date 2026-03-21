#!/usr/bin/env bash
set -euo pipefail

cd /workspaces/securelogic-engine

set -a
source .env.local
set +a

ADMIN_KEY="${SECURELOGIC_ADMIN_KEY}"
ORG_ID="82c9bbc4-27b7-4c39-9ad4-791f7583b5e9"
BASE_URL="http://localhost:4000"

echo "== Reset state =="
./scripts/reset-newsletter-state.sh
echo

echo "== Health check =="
curl -s "${BASE_URL}/health"
echo
echo

echo "== Create draft issue =="
CREATE_RESPONSE="$(curl -s \
  -X POST \
  -H "Content-Type: application/json" \
  -H "X-Admin-Key: ${ADMIN_KEY}" \
  -d "{
    \"organizationId\":\"${ORG_ID}\",
    \"title\":\"SecureLogic E2E Test $(date -u +%Y-%m-%dT%H:%M:%SZ)\",
    \"contentHtml\":\"<h1>SecureLogic E2E Test</h1><p>Automated enterprise validation.</p>\",
    \"status\":\"draft\"
  }" \
  "${BASE_URL}/admin/newsletter-issues")"

echo "$CREATE_RESPONSE" | python3 -m json.tool
ISSUE_ID="$(echo "$CREATE_RESPONSE" | python3 -c 'import sys,json; print(json.load(sys.stdin)["issue"]["id"])')"
echo "ISSUE_ID=${ISSUE_ID}"
echo

echo "== Promote issue =="
curl -s \
  -X POST \
  -H "X-Admin-Key: ${ADMIN_KEY}" \
  "${BASE_URL}/admin/newsletter-issues/${ISSUE_ID}/promote" \
  | python3 -m json.tool
echo

echo "== Run intelligence worker =="
npx tsx services/intelligence-worker/src/runner.ts
echo

echo "== Verify queued deliveries =="
ISSUE_ID="${ISSUE_ID}" npx tsx <<'TS'
import { pg } from "./src/api/infra/postgres.ts";

const issueId = process.env.ISSUE_ID;
if (!issueId) {
  throw new Error("ISSUE_ID is not set");
}

const r = await pg.query(
  "SELECT subscriber_email, status FROM newsletter_deliveries WHERE issue_id = $1 ORDER BY created_at ASC",
  [issueId]
);

console.log(r.rows);
process.exit(0);
TS
echo

echo "== Run delivery worker =="
npx tsx services/delivery-worker/src/runner.ts
echo

echo "== Verify sent deliveries =="
ISSUE_ID="${ISSUE_ID}" npx tsx <<'TS'
import { pg } from "./src/api/infra/postgres.ts";

const issueId = process.env.ISSUE_ID;
if (!issueId) {
  throw new Error("ISSUE_ID is not set");
}

const r = await pg.query(
  "SELECT subscriber_email, status, sent_at, provider_message_id FROM newsletter_deliveries WHERE issue_id = $1 ORDER BY created_at ASC",
  [issueId]
);

console.log(r.rows);
process.exit(0);
TS
echo

echo "== Verify final issue state =="
curl -s \
  -H "X-Admin-Key: ${ADMIN_KEY}" \
  "${BASE_URL}/admin/newsletter-issues" \
  | python3 -m json.tool
echo

echo "== Verify invalid lifecycle handling =="
curl -s \
  -X POST \
  -H "X-Admin-Key: ${ADMIN_KEY}" \
  "${BASE_URL}/admin/newsletter-issues/REAL_DRAFT_ID/cancel" \
  | python3 -m json.tool
echo

echo "== E2E flow complete for issue ${ISSUE_ID} =="
