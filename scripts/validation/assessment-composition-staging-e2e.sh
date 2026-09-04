#!/usr/bin/env bash
# assessment-composition-staging-e2e.sh — Assessment Composition v1 +
# contact-based issuance sent from SecureLogic, end to end against a deployed
# engine (staging), through the public API as a customer would use it.
#
# Extends vendor-onboarding-2-staging-e2e.sh: creates a uniquely-named vendor
# on the validation tenant, a classified relationship (payments) and a nominal
# one (catering), composes both, inspects the composition record, issues to a
# DIRECTORY CONTACT with a composed message + due date, checks the delivery
# record, exercises the portal with the recovery link, re-issues, revokes,
# and archives the vendor at the end.
#
#   ENGINE_URL=https://securelogic-engine-staging.onrender.com \
#   E2E_EMAIL=... E2E_PASSWORD=... E2E_RECIPIENT=delivered@resend.dev \
#   bash scripts/validation/assessment-composition-staging-e2e.sh
set -u
ENGINE_URL="${ENGINE_URL:-https://securelogic-engine-staging.onrender.com}"
: "${E2E_EMAIL:?}"; : "${E2E_PASSWORD:?}"
RECIPIENT="${E2E_RECIPIENT:-delivered@resend.dev}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
PASS=0; FAIL=0; LEDGER=()
ok()   { PASS=$((PASS+1)); LEDGER+=("PASS  $1"); }
bad()  { FAIL=$((FAIL+1)); LEDGER+=("FAIL  $1 :: $2"); }
j()    { python3 -c "
import json,sys
try:
    d=json.load(sys.stdin); v=eval(sys.argv[1])
except Exception: v=None
print('' if v is None else v)" "$1" 2>/dev/null; }
api()  { curl -s --max-time 60 -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" "$@"; }

TOK=$(curl -s --max-time 60 -X POST -H "Content-Type: application/json" "$ENGINE_URL/api/auth/login" -d "{\"email\":\"$E2E_EMAIL\",\"password\":\"$E2E_PASSWORD\"}" | j "d['token']")
[ -n "$TOK" ] && ok "login" || { echo "FAIL login"; exit 2; }
for i in $(seq 1 20); do
  P=$(curl -s --max-time 30 -H "Authorization: Bearer $TOK" "$ENGINE_URL/api/vendor-engagements/00000000-0000-0000-0000-000000000000/composition")
  echo "$P" | grep -q '"path"' || break
  sleep 6
done

# ── 1. Vendor, relationships, contacts ──
V=$(api -X POST "$ENGINE_URL/api/vendors" -d "{\"name\":\"AC1 E2E Payments $STAMP\",\"category\":\"Payment Processing\",\"service_description\":\"Card acquiring\",\"data_sensitivity\":\"restricted\",\"access_level\":\"read_write\",\"website\":\"https://example.test\"}")
VID=$(echo "$V" | j "d['vendor']['id']")
[ -n "$VID" ] && ok "create vendor" || { bad "create vendor" "$V"; VID="00000000-0000-0000-0000-000000000000"; }
R1=$(api -X POST "$ENGINE_URL/api/vendors/$VID/relationships" -d '{"name":"Card processing","service_description":"Online card acquiring"}')
RID=$(echo "$R1" | j "d['relationship']['id']")
[ -n "$RID" ] && ok "create relationship" || bad "create relationship" "$R1"
C1=$(api -X POST "$ENGINE_URL/api/vendors/$VID/contacts" -d "{\"full_name\":\"Jane Security\",\"email\":\"$RECIPIENT\",\"title\":\"CISO\",\"contact_role\":\"security\",\"is_primary_contact\":true}")
CID=$(echo "$C1" | j "d['contact']['id']")
[ -n "$CID" ] && ok "create primary contact ($RECIPIENT)" || bad "create contact" "$C1"
C2=$(api -X POST "$ENGINE_URL/api/vendors/$VID/contacts" -d "{\"full_name\":\"Raj Privacy\",\"email\":\"raj-$STAMP@vendor.test\",\"contact_role\":\"privacy\"}")
CID2=$(echo "$C2" | j "d['contact']['id']")
[ -n "$CID2" ] && ok "create second contact" || bad "second contact" "$C2"

# ── 2. Intake → classification (owner scenario) ──
INTAKE='{"max_tolerable_disruption":"lt_24_hours","operational_dependency":"essential","business_reach":"enterprise_wide","substitutability":"replaceable_months","process_coupling":"in_critical_path","concentration":"moderate","data_sensitivity":"restricted","data_volume":"large","access_level":"read_write","regulatory_exposure":"high","regulatory_breach_notification":false,"ai_involvement":"none","ai_autonomy":"none","hosting_model":"saas","fourth_party_exposure":"moderate"}'
I1=$(api -X POST "$ENGINE_URL/api/vendors/$VID/relationships/$RID/intake" -d "$INTAKE")
[ "$(echo "$I1" | j "d['relationship']['assessment_tier']")" = "tier_1_critical" ] && ok "intake → Criticality Critical / IR High / tier_1" || bad "classification" "$(echo "$I1" | head -c 300)"

# ── 3. Engagement + composition ──
E=$(api -X POST "$ENGINE_URL/api/vendor-engagements" -d "{\"vendor_id\":\"$VID\",\"relationship_id\":\"$RID\",\"engagement_type\":\"initial\",\"title\":\"AC1 E2E $STAMP\"}")
EID=$(echo "$E" | j "d['id']")
[ -n "$EID" ] && ok "engagement opened from relationship" || { bad "engagement" "$E"; EID="00000000-0000-0000-0000-000000000000"; }
S=$(api -X POST "$ENGINE_URL/api/vendor-engagements/$EID/scope" -d '{}')
[ "$(echo "$S" | j "d['scope_rule_version']")" = "1.2.0" ] && ok "composed under scope-rule 1.2.0" || bad "scope rule version" "$(echo "$S" | head -c 300)"
SUM_APPL=$(echo "$S" | j "d['composition_snapshot']['summary']['core_applicable']")
SUM_NA=$(echo "$S" | j "d['composition_snapshot']['summary']['core_not_applicable']")
[ "$((SUM_APPL + SUM_NA))" = "16" ] && ok "all 16 Core Assurance objectives decided (applicable=$SUM_APPL, not applicable=$SUM_NA)" || bad "core decisions" "$(echo "$S" | j "d.get('composition_snapshot')")"
HASH1=$(echo "$S" | j "d['composition_snapshot']['hash']")
SCOPED=$(echo "$S" | j "d['scoped']")
[ "$SCOPED" -gt 0 ] 2>/dev/null && ok "questionnaire composed: $SCOPED items" || bad "scoped" "$S"
CMP=$(api "$ENGINE_URL/api/vendor-engagements/$EID/composition")
[ "$(echo "$CMP" | j "d['composition']['hash']")" = "$HASH1" ] && ok "GET /composition returns the snapshot" || bad "composition read" "$(echo "$CMP" | head -c 300)"
[ "$(echo "$CMP" | j "len(d['composition']['core_assurance']['objectives'])")" = "16" ] && ok "composition lists all 16 objectives with outcomes" || bad "objectives" "$CMP"
[ -n "$(echo "$CMP" | j "next((o['rationale'] for o in d['composition']['core_assurance']['objectives'] if o['outcome']=='asked'), '')")" ] && ok "asked objectives carry a customer-facing rationale" || bad "rationale" "$CMP"
[ "$(echo "$CMP" | j "d['composition']['coverage']['computed']")" = "True" ] && ok "S4 coverage dual-read recorded on the composition" || bad "coverage" "$CMP"
FW=$(api "$ENGINE_URL/api/frameworks")
[ -n "$(echo "$FW" | j "next((f['id'] for f in (d.get('frameworks') or d) if f.get('name')=='SecureLogic Core Assurance Set'), '')")" ] && ok "Core Assurance Set provisioned into the tenant library" || bad "provisioning" "$(echo "$FW" | head -c 200)"
S2=$(api -X POST "$ENGINE_URL/api/vendor-engagements/$EID/scope" -d '{}')
[ "$(echo "$S2" | j "d['composition_snapshot']['hash']")" = "$HASH1" ] && ok "re-composition from unchanged inputs reproduces the same hash" || bad "determinism" "$S2"
[ "$(api "$ENGINE_URL/api/vendor-engagements/$EID/composition" | j "d['history_count']")" = "2" ] && ok "composition history appended (2)" || bad "history" ""

# ── 4. Nominal relationship → no questionnaire ──
R2=$(api -X POST "$ENGINE_URL/api/vendors/$VID/relationships" -d '{"name":"Office catering"}')
RID2=$(echo "$R2" | j "d['relationship']['id']")
CAT='{"max_tolerable_disruption":"gt_1_month","operational_dependency":"incidental","business_reach":"single_team","substitutability":"interchangeable","process_coupling":"peripheral","concentration":"none","data_sensitivity":"none","data_volume":"minimal","access_level":"none","regulatory_exposure":"none","regulatory_breach_notification":false,"ai_involvement":"none","ai_autonomy":"none","hosting_model":"saas","fourth_party_exposure":"none"}'
api -X POST "$ENGINE_URL/api/vendors/$VID/relationships/$RID2/intake" -d "$CAT" >/dev/null
E2=$(api -X POST "$ENGINE_URL/api/vendor-engagements" -d "{\"vendor_id\":\"$VID\",\"relationship_id\":\"$RID2\",\"engagement_type\":\"initial\",\"title\":\"AC1 nominal $STAMP\"}")
EID2=$(echo "$E2" | j "d['id']")
SN=$(api -X POST "$ENGINE_URL/api/vendor-engagements/$EID2/scope" -d '{}')
[ "$(echo "$SN" | j "d['composition_snapshot']['summary']['no_questionnaire_required']")" = "True" ] && ok "nominal relationship: no formal questionnaire required (16 not applicable)" || bad "nominal" "$(echo "$SN" | head -c 300)"
NI=$(api -X POST "$ENGINE_URL/api/vendor-engagements/$EID2/issue" -d "{\"contact_id\":\"$CID\"}")
[ "$(echo "$NI" | j "d['error']")" = "empty_scope" ] && ok "nominal engagement cannot be issued (422 empty_scope)" || bad "empty issue" "$NI"

# ── 4b. Tier depth: a low-exposure relationship composes fewer objectives at attestation depth ──
R3=$(api -X POST "$ENGINE_URL/api/vendors/$VID/relationships" -d '{"name":"Newsletter tooling"}')
RID3=$(echo "$R3" | j "d['relationship']['id']")
LOW='{"max_tolerable_disruption":"gt_1_month","operational_dependency":"incidental","business_reach":"single_team","substitutability":"interchangeable","process_coupling":"peripheral","concentration":"none","data_sensitivity":"internal","data_volume":"minimal","access_level":"none","regulatory_exposure":"none","regulatory_breach_notification":false,"ai_involvement":"none","ai_autonomy":"none","hosting_model":"saas","fourth_party_exposure":"none"}'
I3=$(api -X POST "$ENGINE_URL/api/vendors/$VID/relationships/$RID3/intake" -d "$LOW")
T3=$(echo "$I3" | j "d['relationship']['assessment_tier']")
E3=$(api -X POST "$ENGINE_URL/api/vendor-engagements" -d "{\"vendor_id\":\"$VID\",\"relationship_id\":\"$RID3\",\"engagement_type\":\"initial\",\"title\":\"AC1 low $STAMP\"}")
EID3=$(echo "$E3" | j "d['id']")
S3=$(api -X POST "$ENGINE_URL/api/vendor-engagements/$EID3/scope" -d '{}')
A3=$(echo "$S3" | j "d['composition_snapshot']['summary']['core_applicable']"); AT3=$(echo "$S3" | j "d['composition_snapshot']['summary']['asked_attest']"); NA3=$(echo "$S3" | j "d['composition_snapshot']['summary']['core_not_applicable']")
[ "$T3" = "tier_4_low" ] && [ "$AT3" -gt 0 ] 2>/dev/null && [ "$A3" -lt 16 ] 2>/dev/null && ok "tier depth: low-exposure relationship = $T3, $A3 objectives apply ($NA3 not applicable), asked at ATTEST depth ($AT3)" || bad "tier depth" "tier=$T3 applicable=$A3 attest=$AT3 na=$NA3"
C3=$(api "$ENGINE_URL/api/vendor-engagements/$EID3/composition")
[ -n "$(echo "$C3" | j "next((o['rationale'] for o in d['composition']['core_assurance']['objectives'] if o['outcome']=='not_applicable'), '')")" ] && ok "not-applicable objectives carry their reason" || bad "n/a reason" "$(echo "$C3" | head -c 200)"

# ── 5. Issue to a directory contact, sent from SecureLogic ──
DUE=$(date -u -d "+21 days" +%Y-%m-%d 2>/dev/null || date -u -v+21d +%Y-%m-%d)
IS=$(api -X POST "$ENGINE_URL/api/vendor-engagements/$EID/issue" -d "{\"contact_id\":\"$CID\",\"message\":\"Hello Jane,\\n\\nAC1 E2E $STAMP — please complete our assessment.\\n\\nThanks\",\"due_date\":\"$DUE\"}")
INV=$(echo "$IS" | j "d.get('invite_token')")
[ -n "$INV" ] && ok "issued to directory contact (credential minted once)" || bad "issue" "$(echo "$IS" | head -c 300)"
[ "$(echo "$IS" | j "d.get('contact_id')")" = "$CID" ] && ok "invite bound to the contact for provenance" || bad "contact binding" "$IS"
DELIV=$(echo "$IS" | j "d.get('email_delivery')")
[ "$DELIV" = "sent" ] && ok "invitation SENT from SecureLogic (provider accepted)" || bad "email delivery" "$DELIV $(echo "$IS" | j "d.get('email_delivery_detail')")"
[ "$(echo "$IS" | j "d.get('due_date')")" = "$DUE" ] && ok "due date recorded" || bad "due date" "$IS"
G=$(api "$ENGINE_URL/api/vendor-engagements/$EID")
[ "$(echo "$G" | j "d['invite']['active']['email_delivery_state']")" = "sent" ] && [ "$(echo "$G" | j "d['invite']['active']['contact_id']")" = "$CID" ] && ok "engagement read shows the active invitation with delivery state" || bad "invite status" "$(echo "$G" | j "d.get('invite')")"
[ -n "$(echo "$G" | j "d['invite']['active']['email_provider_message_id']")" ] && ok "provider message id recorded (email_sends join)" || bad "provider id" ""
echo "$G" | grep -q "$INV" && bad "token leak" "raw token in engagement read" || ok "engagement read carries no token material"
# duplicate prevention
DUP=$(api -X POST "$ENGINE_URL/api/vendor-engagements/$EID/issue" -d "{\"contact_id\":\"$CID2\"}")
[ "$(echo "$DUP" | j "d['error']")" = "cannot_issue" ] && ok "second issue refused (one issuance per engagement)" || bad "duplicate" "$DUP"

# ── 6. Vendor side via the recovery link ──
JAR=$(mktemp)
SESS=$(curl -s --max-time 60 -c "$JAR" -o /dev/null -w '%{http_code}' -H "Content-Type: application/json" -X POST "$ENGINE_URL/api/vendor-portal/session" -d "{\"token\":\"$INV\"}")
[ "$SESS" = "200" ] && ok "portal: invite exchanged for a session" || bad "portal exchange" "HTTP $SESS"
PE=$(curl -s --max-time 60 -b "$JAR" "$ENGINE_URL/api/vendor-portal/engagement")
[ "$(echo "$PE" | j "d.get('due_date')")" = "$DUE" ] && ok "portal shows the customer's due date" || bad "portal due date" "$(echo "$PE" | head -c 200)"
PQ=$(curl -s --max-time 60 -b "$JAR" "$ENGINE_URL/api/vendor-portal/questions")
QN=$(echo "$PQ" | j "len(d['questions'])")
[ "$QN" = "$SCOPED" ] && ok "portal questionnaire = composed set ($QN)" || bad "portal questions" "$QN vs $SCOPED"
echo "$PQ" | grep -q "CAS-0" && ok "portal asks Core Assurance objectives" || bad "portal CAS" "$(echo "$PQ" | head -c 200)"
RQ=$(echo "$PQ" | j "d['questions'][0]['requirement_id']")
A=$(curl -s --max-time 60 -b "$JAR" -H "Content-Type: application/json" -X PUT "$ENGINE_URL/api/vendor-portal/questions/$RQ" -d '{"answer":"pass","notes":"AC1 E2E answer"}' -o /dev/null -w '%{http_code}')
[ "$A" = "200" ] && ok "vendor answered a question" || bad "answer" "HTTP $A"
rm -f "$JAR"
[ "$(api "$ENGINE_URL/api/vendor-engagements/$EID" | j "d['invite']['active']['exchange_count']")" = "1" ] && ok "customer sees the vendor opened the link" || bad "exchange count" ""
RESP=$(api "$ENGINE_URL/api/vendor-engagements/$EID/responses")
echo "$RESP" | grep -q "AC1 E2E answer" && ok "customer-side lifecycle received the answer" || bad "responses" "$(echo "$RESP" | head -c 200)"

# ── 7. Resend / revoke ──
RI=$(api -X POST "$ENGINE_URL/api/vendor-engagements/$EID/invite/reissue" -d "{\"contact_id\":\"$CID2\",\"message\":\"Second attempt\"}")
[ "$(echo "$RI" | j "d.get('prior_invites_revoked')")" = "1" ] && [ -n "$(echo "$RI" | j "d.get('invite_token')")" ] && ok "re-issue to another contact supersedes the prior credential" || bad "reissue" "$(echo "$RI" | head -c 300)"
OLD=$(curl -s --max-time 60 -o /dev/null -w '%{http_code}' -H "Content-Type: application/json" -X POST "$ENGINE_URL/api/vendor-portal/session" -d "{\"token\":\"$INV\"}")
[ "$OLD" = "401" ] && ok "old link dead after re-issue" || bad "old link" "HTTP $OLD"
[ "$(api "$ENGINE_URL/api/vendor-engagements/$EID" | j "d['invite']['history_count']")" = "2" ] && ok "invitation history preserved (2)" || bad "history" ""
RV=$(api -X POST "$ENGINE_URL/api/vendor-engagements/$EID/invite/revoke" -d '{"reason":"e2e revoke"}')
[ "$(echo "$RV" | j "d.get('invites_revoked')")" = "1" ] && ok "revoke: access revoked" || bad "revoke" "$RV"
[ "$(api "$ENGINE_URL/api/vendor-engagements/$EID/responses" | grep -c "AC1 E2E answer")" -ge 1 ] && ok "history survives revocation" || bad "history after revoke" ""

# ── cleanup ──
api -X PATCH "$ENGINE_URL/api/vendors/$VID" -d '{"status":"archived"}' >/dev/null 2>&1 || true
echo; printf '%s\n' "${LEDGER[@]}"; echo; echo "PASS=$PASS FAIL=$FAIL  vendor=$VID engagement=$EID nominal=$EID2 engine=$ENGINE_URL"
[ "$FAIL" = 0 ]
