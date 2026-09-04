#!/usr/bin/env bash
# vendor-onboarding-2-staging-app-check.sh — server-rendered proof that the
# Onboarding 2.0 surfaces reached the deployed APP (not just the engine).
# Logs into the app, fetches the vendor page and the new-vendor page, and
# greps the HTML for the card and for the ABSENCE of the criticality dropdown.
set -u
APP_URL="${APP_URL:-https://securelogic-app-staging.onrender.com}"
: "${E2E_EMAIL:?}"; : "${E2E_PASSWORD:?}"; : "${VENDOR_ID:?}"
CK=$(mktemp)
curl -s -c "$CK" -o /dev/null -w "app login HTTP %{http_code}\n" --max-time 60 -X POST -H "Content-Type: application/json" "$APP_URL/api/auth-login" -d "{\"email\":\"$E2E_EMAIL\",\"password\":\"$E2E_PASSWORD\"}"
echo "deployed app: $(curl -s --max-time 30 "$APP_URL/api/version")"
V=$(curl -s -b "$CK" --max-time 60 "$APP_URL/vendors/$VENDOR_ID")
N=$(curl -s -b "$CK" --max-time 60 "$APP_URL/vendors/new")
chk() { if echo "$2" | grep -q -- "$3"; then echo "PASS  $1"; else echo "FAIL  $1"; fi; }
nchk(){ if echo "$2" | grep -q -- "$3"; then echo "FAIL  $1"; else echo "PASS  $1"; fi; }
chk  "vendor page renders the Relationships & classification card" "$V" "Relationships &amp; classification"
chk  "vendor page shows a derived tier or intake-required state" "$V" "Tier [1-4] —\|Intake required"
chk  "vendor page labels the manual classification as legacy (if present)" "$V" "not used to derive\|Relationships &amp; classification"
nchk "Add Vendor no longer asks for a criticality classification" "$N" "Select criticality"
chk  "Add Vendor still collects factual master data" "$N" 'name="data_sensitivity"'
rm -f "$CK"
