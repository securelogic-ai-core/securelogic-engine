#!/usr/bin/env bash
set -euo pipefail

cd /workspaces/securelogic-engine

set -a
source .env.local
set +a

ADMIN_KEY="${SECURELOGIC_ADMIN_KEY:-}"
ORG_ID="82c9bbc4-27b7-4c39-9ad4-791f7583b5e9"
BASE_URL="http://localhost:4000"

if [[ -z "$ADMIN_KEY" ]]; then
  echo "SECURELOGIC_ADMIN_KEY is not set"
  exit 1
fi

echo "== Health check =="
curl -s "$BASE_URL/health"
echo
echo

echo "== Create draft issue =="
CREATE_RESPONSE="$(curl -s \
  -X POST \
  -H "Content-Type: application/json" \
  -H "X-Admin-Key: $ADMIN_KEY" \
  -d "{
    \"organizationId\":\"$ORG_ID\",
    \"title\":\"SecureLogic Cyber Risk Intelligence Brief\",
    \"contentHtml\":\"<h1>SecureLogic Cyber Risk Intelligence Brief</h1><p>Automated end-to-end test issue.</p>\",
    \"status\":\"draft\"
  }" \
  "$BASE_URL/admin/newsletter-issues")"

echo "$CREATE_RESPONSE" | python3 -m json.tool
ISSUE_ID="$(echo "$CREATE_RESPONSE" | python3 -c 'import sys,json; print(json.load(sys.stdin)["issue"]["id"])')"
echo "Created issue: $ISSUE_ID"
echo

echo "== Promote draft to queued =="
curl -s \
  -X POST \
  -H "X-Admin-Key: $ADMIN_KEY" \
  "$BASE_URL/admin/newsletter-issues/$ISSUE_ID/promote" \
  | python3 -m json.tool
echo

echo "== Run intelligence worker =="
npx tsx services/intelligence-worker/src/runner.ts
echo

echo "== Verify queued deliveries =="
npx tsx -e "(async () => {
  const { pg } = await import('./src/api/infra/postgres.ts');
  const r = await pg.query(\"SELECT issue_id, subscriber_email, status FROM newsletter_deliveries WHERE issue_id = '$ISSUE_ID' ORDER BY created_at ASC\");
  console.log(r.rows);
  process.exit();
})()"
echo

echo "== Run delivery worker =="
npx tsx services/delivery-worker/src/runner.ts
echo

echo "== Verify issue state =="
curl -s \
  -H "X-Admin-Key: $ADMIN_KEY" \
  "$BASE_URL/admin/newsletter-issues" \
  | python3 -m json.tool
echo

echo "== Verify delivery results for issue =="
npx tsx -e "(async () => {
  const { pg } = await import('./src/api/infra/postgres.ts');
  const r = await pg.query(\"SELECT subscriber_email, status, sent_at, provider_message_id FROM newsletter_deliveries WHERE issue_id = '$ISSUE_ID' ORDER BY created_at ASC\");
  console.log(r.rows);
  process.exit();
})()"
echo

echo "== Done =="
echo "Tested issue id: $ISSUE_ID"
