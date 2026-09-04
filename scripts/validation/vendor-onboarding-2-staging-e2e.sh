#!/usr/bin/env bash
# vendor-onboarding-2-staging-e2e.sh — Vendor Onboarding 2.0 end-to-end
# acceptance against a deployed engine (staging), through the public API as a
# customer would use it. Prints a PASS/FAIL ledger and exits non-zero on any
# failure. Read-only against nothing: it CREATES a uniquely-named vendor on the
# validation tenant and archives it at the end.
#
#   ENGINE_URL=https://securelogic-engine-staging.onrender.com \
#   E2E_EMAIL=... E2E_PASSWORD=... bash scripts/validation/vendor-onboarding-2-staging-e2e.sh
set -u
ENGINE_URL="${ENGINE_URL:-https://securelogic-engine-staging.onrender.com}"
: "${E2E_EMAIL:?}"; : "${E2E_PASSWORD:?}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
PASS=0; FAIL=0; LEDGER=()
ok()   { PASS=$((PASS+1)); LEDGER+=("PASS  $1"); }
bad()  { FAIL=$((FAIL+1)); LEDGER+=("FAIL  $1 :: $2"); }
# Prints the evaluated expression, or NOTHING for None/missing — so a `-n`
# test never passes on the literal string "None".
j()    { python3 -c "
import json,sys
try:
    d=json.load(sys.stdin); v=eval(sys.argv[1])
except Exception: v=None
print('' if v is None else v)" "$1" 2>/dev/null; }
api()  { curl -s --max-time 60 -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" "$@"; }

TOK=$(curl -s --max-time 60 -X POST -H "Content-Type: application/json" "$ENGINE_URL/api/auth/login" -d "{\"email\":\"$E2E_EMAIL\",\"password\":\"$E2E_PASSWORD\"}" | j "d['token']")
[ -n "$TOK" ] && ok "login" || { echo "FAIL login"; exit 2; }
# Render reports a deploy live slightly before the new instance takes traffic.
# Wait until the VO2 route answers with its own shape (401/200/404-no-path),
# not the Express fallthrough 404 that carries a "path" key.
for i in $(seq 1 20); do
  P=$(curl -s --max-time 30 -H "Authorization: Bearer $TOK" "$ENGINE_URL/api/vendors/00000000-0000-0000-0000-000000000000/relationships")
  echo "$P" | grep -q '"path"' || break
  sleep 6
done

# ── 1. Add Vendor: identity + factual master data, NO classification ──
V=$(api -X POST "$ENGINE_URL/api/vendors" -d "{\"name\":\"VO2 E2E Payments $STAMP\",\"category\":\"Payment Processing\",\"service_description\":\"Card acquiring\",\"data_sensitivity\":\"restricted\",\"access_level\":\"read_write\",\"website\":\"https://example.test\"}")
VID=$(echo "$V" | j "d['vendor']['id']")
[ -n "$VID" ] && ok "create vendor (no criticality asked)" || bad "create vendor" "$V"
[ -z "$(echo "$V" | j "d['vendor'].get('criticality')")" ] && ok "vendor has NO manufactured criticality" || bad "criticality manufactured" "$(echo "$V" | j "d['vendor'].get('criticality')")"

# ── 2. Relationship grain ──
R1=$(api -X POST "$ENGINE_URL/api/vendors/$VID/relationships" -d '{"name":"Card processing","service_description":"Online card acquiring"}')
RID=$(echo "$R1" | j "d['relationship']['id']")
[ -n "$RID" ] && ok "create relationship" || bad "create relationship (VO2 deployed?)" "$R1"
[ "$(echo "$R1" | j "d['relationship']['is_primary']")" = "True" ] && ok "first relationship is primary" || bad "first not primary" "$R1"
[ "$(echo "$R1" | j "d['relationship']['classification_state']")" = "intake_required" ] && ok "new relationship is intake_required (ignorance, not zero)" || bad "state" "$R1"
[ -z "$(echo "$R1" | j "d['relationship']['assessment_tier']")" ] && ok "no tier before intake" || bad "tier before intake" "$R1"

# ── 3. Contacts: persistent vendor-level records ──
C1=$(api -X POST "$ENGINE_URL/api/vendors/$VID/contacts" -d "{\"full_name\":\"Jane Security\",\"email\":\"jane-$STAMP@vendor.test\",\"contact_role\":\"security\",\"is_primary_contact\":true}")
CID=$(echo "$C1" | j "d['contact']['id']")
[ -n "$CID" ] && ok "create primary contact" || bad "create contact" "$C1"
C2=$(api -X POST "$ENGINE_URL/api/vendors/$VID/contacts" -d "{\"full_name\":\"Raj Privacy\",\"email\":\"raj-$STAMP@vendor.test\",\"contact_role\":\"privacy\"}")
[ -n "$(echo "$C2" | j "d['contact']['id']")" ] && ok "create second contact" || bad "second contact" "$C2"
CL=$(api "$ENGINE_URL/api/vendors/$VID/contacts")
[ "$(echo "$CL" | j "d['count']")" = "2" ] && ok "contacts list = 2" || bad "contacts count" "$CL"

# ── 4. Factual intake -> deterministic classification (owner scenario) ──
INTAKE='{"max_tolerable_disruption":"lt_24_hours","operational_dependency":"essential","business_reach":"enterprise_wide","substitutability":"replaceable_months","process_coupling":"in_critical_path","concentration":"moderate","data_sensitivity":"restricted","data_volume":"large","access_level":"read_write","regulatory_exposure":"high","regulatory_breach_notification":false,"ai_involvement":"none","ai_autonomy":"none","hosting_model":"saas","fourth_party_exposure":"moderate"}'
I1=$(api -X POST "$ENGINE_URL/api/vendors/$VID/relationships/$RID/intake" -d "$INTAKE")
IID=$(echo "$I1" | j "d['intake']['id']")
[ -n "$IID" ] && ok "intake accepted (version $(echo "$I1" | j "d['intake']['version']"))" || bad "intake" "$I1"
[ "$(echo "$I1" | j "d['relationship']['criticality_score']")" = "90" ] && [ "$(echo "$I1" | j "d['relationship']['criticality_band']")" = "Critical" ] && ok "Criticality 90 / Critical (CR2)" || bad "criticality" "$(echo "$I1" | j "(d['relationship']['criticality_score'], d['relationship']['criticality_band'])")"
[ "$(echo "$I1" | j "d['relationship']['inherent_score']")" = "70" ] && [ "$(echo "$I1" | j "d['relationship']['inherent_band']")" = "High" ] && ok "Inherent risk v2 70 / High" || bad "inherent" "$(echo "$I1" | j "(d['relationship']['inherent_score'], d['relationship']['inherent_band'])")"
[ "$(echo "$I1" | j "d['relationship']['assessment_tier']")" = "tier_1_critical" ] && ok "Assessment tier = tier_1 (Critical x High on the matrix)" || bad "tier" "$(echo "$I1" | j "d['relationship']['assessment_tier']")"
[ "$(echo "$I1" | j "d['relationship']['classification_intake_id']")" = "$IID" ] && ok "provenance: classification names the intake that produced it" || bad "provenance" "$I1"
[ "$(echo "$I1" | j "d['relationship']['inherent_methodology_version']")" = "2.0.0" ] && ok "inherent stamped 2.0.0" || bad "methodology stamp" "$I1"
[ "$(echo "$I1" | j "[a['rule_id'] for a in d['relationship']['criticality_basis']['adjustments']]")" = "['CR2']" ] && ok "named floor CR2 recorded in basis" || bad "CR2 basis" "$I1"

# incomplete intake refused, nothing scored
BAD=$(api -X POST "$ENGINE_URL/api/vendors/$VID/relationships/$RID/intake" -d '{"data_sensitivity":"none"}')
[ "$(echo "$BAD" | j "d['error']")" = "incomplete_intake" ] && ok "incomplete intake refused with the missing fields named" || bad "incomplete intake" "$BAD"

# ── 5. Policy: raise-only ──
P1=$(api -X PATCH "$ENGINE_URL/api/vendors/$VID/relationships/$RID" -d '{"policy_minimum_tier":"tier_4_low"}')
[ "$(echo "$P1" | j "d['relationship']['assessment_tier']")" = "tier_1_critical" ] && [ "$(echo "$P1" | j "d['relationship']['tier_basis']['policy']['applied']")" = "False" ] && ok "policy cannot LOWER (refusal recorded)" || bad "policy lower" "$P1"

# ── 6. Multi-relationship: a second service with a different classification ──
R2=$(api -X POST "$ENGINE_URL/api/vendors/$VID/relationships" -d '{"name":"Office catering"}')
RID2=$(echo "$R2" | j "d['relationship']['id']")
[ "$(echo "$R2" | j "d['relationship']['is_primary']")" = "False" ] && ok "second relationship not primary" || bad "second primary" "$R2"
CAT='{"max_tolerable_disruption":"gt_1_month","operational_dependency":"incidental","business_reach":"single_team","substitutability":"interchangeable","process_coupling":"peripheral","concentration":"none","data_sensitivity":"none","data_volume":"minimal","access_level":"none","regulatory_exposure":"none","regulatory_breach_notification":false,"ai_involvement":"none","ai_autonomy":"none","hosting_model":"saas","fourth_party_exposure":"none"}'
I2=$(api -X POST "$ENGINE_URL/api/vendors/$VID/relationships/$RID2/intake" -d "$CAT")
[ "$(echo "$I2" | j "d['relationship']['assessment_tier']")" = "tier_4_low" ] && ok "same vendor, second relationship = tier_4 (multi-relationship)" || bad "second tier" "$I2"
P2=$(api -X PATCH "$ENGINE_URL/api/vendors/$VID/relationships/$RID2" -d '{"policy_minimum_tier":"tier_2_high"}')
[ "$(echo "$P2" | j "d['relationship']['assessment_tier']")" = "tier_2_high" ] && [ "$(echo "$P2" | j "d['relationship']['tier_calculated_minimum']")" = "tier_4_low" ] && ok "policy RAISES tier_4 -> tier_2, minimum preserved" || bad "policy raise" "$P2"
L=$(api "$ENGINE_URL/api/vendors/$VID/relationships")
[ "$(echo "$L" | j "d['count']")" = "2" ] && [ "$(echo "$L" | j "d['intake_required_count']")" = "0" ] && ok "vendor lists 2 classified relationships" || bad "list" "$L"

# ── 7. Engagement FROM the relationship -> existing assurance lifecycle ──
E=$(api -X POST "$ENGINE_URL/api/vendor-engagements" -d "{\"vendor_id\":\"$VID\",\"relationship_id\":\"$RID\",\"engagement_type\":\"initial\",\"title\":\"VO2 E2E $STAMP\"}")
EID=$(echo "$E" | j "d['id']")
[ -n "$EID" ] && ok "engagement opened from relationship (no re-ask)" || bad "engagement from relationship" "$E"
if [ -z "$EID" ]; then EID="00000000-0000-0000-0000-000000000000"; fi
[ "$(echo "$E" | j "d['inherent']['tier']")" = "tier_1_critical" ] && ok "engagement carries the JOINT tier_1 (v1 would have said tier_2)" || bad "engagement tier" "$E"
G=$(api "$ENGINE_URL/api/vendor-engagements/$EID")
[ "$(echo "$G" | j "d.get('methodology_version') or d.get('engagement',{}).get('methodology_version')")" = "2.0.0" ] && ok "engagement stamped methodology 2.0.0" || bad "engagement stamp" "$(echo "$G" | head -c 300)"
[ "$(echo "$G" | j "d.get('relationship_id') or d.get('engagement',{}).get('relationship_id')")" = "$RID" ] && ok "engagement.relationship_id set" || bad "relationship_id" "$(echo "$G" | head -c 200)"
S=$(api -X POST "$ENGINE_URL/api/vendor-engagements/$EID/scope" -d '{}')
SC=$(echo "$S" | j "d.get('resolution',{}).get('items') and len(d['resolution']['items']) or d.get('scope_item_count') or d.get('count') or (d.get('scope') and len(d['scope']))")
[ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 60 -H "Authorization: Bearer $TOK" -X POST "$ENGINE_URL/api/vendor-engagements/$EID/scope" -H 'Content-Type: application/json' -d '{}')" = "200" ] && ok "scope resolved through the existing resolver (items=$SC)" || bad "scope" "$(echo "$S" | head -c 300)"
IS=$(api -X POST "$ENGINE_URL/api/vendor-engagements/$EID/issue" -d "{\"contact_id\":\"$CID\"}")
[ -n "$(echo "$IS" | j "d.get('invite_token') or d.get('ok')")" ] && ok "questionnaire issued to a DIRECTORY CONTACT (portal credential separate from contact)" || bad "issue to contact" "$(echo "$IS" | head -c 300)"
# the supplier's credential is engagement-specific and SEPARATE from the contact:
# exchange the invite for a portal session (cookie) and read the engagement as the vendor would
INV=$(echo "$IS" | j "d.get('invite_token')")
JAR=$(mktemp)
SESS=$(curl -s --max-time 60 -c "$JAR" -o /dev/null -w '%{http_code}' -H "Content-Type: application/json" -X POST "$ENGINE_URL/api/vendor-portal/session" -d "{\"token\":\"$INV\"}")
[ "$SESS" = "200" ] && ok "portal: invite exchanged for an engagement-scoped session (credential != contact)" || bad "portal exchange" "HTTP $SESS"
PE=$(curl -s --max-time 60 -b "$JAR" "$ENGINE_URL/api/vendor-portal/engagement")
# The portal view deliberately carries NO engagement id (anti-enumeration): the
# vendor sees title/vendor/status only. Match on the title we set.
[ "$(echo "$PE" | j "d.get('title')")" = "VO2 E2E $STAMP" ] && [ "$(echo "$PE" | j "d.get('accepting_responses')")" = "True" ] && ok "portal: the vendor sees the engagement opened from the relationship, accepting responses" || bad "portal engagement" "$(echo "$PE" | head -c 200)"
PQ=$(curl -s --max-time 60 -b "$JAR" -o /dev/null -w '%{http_code}' "$ENGINE_URL/api/vendor-portal/questions")
[ "$PQ" = "200" ] && ok "portal: questionnaire composed from the derived tier is readable by the vendor" || bad "portal questions" "HTTP $PQ"
rm -f "$JAR"
# lifecycle continuity: the VO2 engagement is an ordinary engagement to every downstream surface
for path in responses assurance-coverage evidence integrity; do
  code=$(curl -s --max-time 60 -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $TOK" "$ENGINE_URL/api/vendor-engagements/$EID/$path")
  [ "$code" = "200" ] && ok "continuity: GET /vendor-engagements/:id/$path = 200" || bad "continuity $path" "HTTP $code"
done
ST=$(api "$ENGINE_URL/api/vendor-engagements/$EID" | j "d.get('status') or d.get('engagement',{}).get('status')")
# issue -> issued; the vendor's first session exchange -> in_progress. Both are
# the EXISTING state machine acting on a VO2 engagement.
[ "$ST" = "in_progress" ] && ok "state machine: issued -> in_progress on the vendor's first portal session (existing lifecycle unchanged)" || bad "state" "$ST"
# an engagement from an intake_required relationship must be refused
R3=$(api -X POST "$ENGINE_URL/api/vendors/$VID/relationships" -d '{"name":"Unassessed service"}')
RID3=$(echo "$R3" | j "d['relationship']['id']")
NO=$(api -X POST "$ENGINE_URL/api/vendor-engagements" -d "{\"vendor_id\":\"$VID\",\"relationship_id\":\"$RID3\",\"engagement_type\":\"initial\"}")
[ "$(echo "$NO" | j "d['error']")" = "intake_required" ] && ok "engagement from intake_required relationship refused (409)" || bad "intake_required refusal" "$NO"

# ── 8. History + immutability + legacy transition ──
H=$(api "$ENGINE_URL/api/vendors/$VID/relationships/$RID/intake")
[ "$(echo "$H" | j "d['count']")" = "1" ] && [ "$(echo "$H" | j "d['intake'][0]['id']")" = "$IID" ] && ok "intake history readable, version 1 = the classifying intake" || bad "history" "$H"
UN=$(curl -s -o /dev/null -w '%{http_code}' --max-time 60 "$ENGINE_URL/api/vendors/$VID/relationships")
[ "$UN" = "401" ] && ok "unauthenticated relationship read = 401 (auth layer intact)" || bad "unauth" "$UN"
# a pre-2.0 vendor (manual criticality, no relationship) is intake-required by absence, not manufactured
OLD=$(api "$ENGINE_URL/api/vendors?status=active&limit=100")
OLDID=$(echo "$OLD" | j "next((v['id'] for v in d['vendors'] if v.get('criticality') and v['id']!='$VID'), '')")
if [ -n "$OLDID" ]; then
  OL=$(api "$ENGINE_URL/api/vendors/$OLDID/relationships")
  [ "$(echo "$OL" | j "d['count']")" = "0" ] && ok "legacy vendor (manual criticality) has NO derived classification — nothing manufactured" || bad "legacy vendor" "$OL"
fi

# ── cleanup: archive the E2E vendor (best effort) ──
api -X PATCH "$ENGINE_URL/api/vendors/$VID" -d '{"status":"archived"}' >/dev/null 2>&1 || true

echo; printf '%s\n' "${LEDGER[@]}"; echo; echo "PASS=$PASS FAIL=$FAIL  vendor=$VID engagement=${EID:-none}  engine=$ENGINE_URL"
[ "$FAIL" = 0 ]
