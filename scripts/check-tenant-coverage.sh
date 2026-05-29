#!/usr/bin/env bash
#
# scripts/check-tenant-coverage.sh — A04-G1 phase 1 (PR 2 of N). WARN-ONLY.
#
# As the A04-G1 elevated-migration PRs (3-6) land, this gives reviewers a live,
# visible census of:
#   1. any Postgres Pool constructed OUTSIDE the central wrapper module
#      (a rogue pool escapes the tenant wrapper and could connect as owner), and
#   2. every DELIBERATE tenant-scope bypass — pgRaw (escape hatch), pgElevated /
#      withElevated (legitimately cross-org) — so each new one is reviewed.
# Plus an informational count of pg.connect() explicit-transaction sites, which
# depend on the savepoint proxy once the request middleware lands (PR 7).
#
# Sanctioned access (NOT flagged): pg.query(...) / pg.connect(...) on the
# wrapper exported by src/api/infra/postgres.ts. Those route through the
# request-scoped AsyncLocalStorage client when a withTenant scope is active,
# else the raw pool — that is the intended default path for customer data.
#
# WARN-ONLY: this script emits GitHub Actions warning annotations and ALWAYS
# exits 0. It never blocks a merge in phase 1. Phase 4 (enforcement lock-in)
# escalates the rogue-pool section to ::error:: + `exit 1` and adds the
# `tenant-coverage` job to the main ruleset's required checks.
#
# NOTE: no `set -e` — the script must always reach the final `exit 0`.

set -uo pipefail

cd "$(dirname "$0")/.."

POSTGRES_MODULE="src/api/infra/postgres.ts"
TENANT_MODULE="src/api/infra/tenantContext.ts"
SEARCH=(src services)
# Tests own their own pools / harness DB — never flagged.
EXCLUDE_RE='(__tests__|/tests/|\.test\.ts|\.spec\.ts)'

annotate_warning() { echo "::warning file=$1,line=$2::$3"; }

findings=0

echo "================================================================"
echo " A04-G1 tenant-coverage census (WARN-ONLY — never blocks merge)"
echo "================================================================"

# --- 1. Rogue pool construction --------------------------------------------
echo
echo "## 1. Pool construction (must be ONLY ${POSTGRES_MODULE})"
rogue=$(grep -rn "new Pool(" "${SEARCH[@]}" --include="*.ts" 2>/dev/null \
  | grep -vE "$EXCLUDE_RE" \
  | grep -v "^${POSTGRES_MODULE}:" || true)
if [ -n "$rogue" ]; then
  while IFS= read -r line; do
    file="${line%%:*}"; rest="${line#*:}"; lineno="${rest%%:*}"
    annotate_warning "$file" "$lineno" \
      "Pool constructed outside ${POSTGRES_MODULE} — escapes the tenant wrapper. Use the exported pg / pgElevated, or justify in review. (phase 4: this becomes a hard failure)"
    echo "  ROGUE  $file:$lineno"
    findings=$((findings + 1))
  done <<< "$rogue"
else
  echo "  OK — no Pool constructed outside ${POSTGRES_MODULE}"
fi

# --- 2. Deliberate tenant-scope bypasses -----------------------------------
echo
echo "## 2. Deliberate bypasses — pgRaw / pgElevated / withElevated (review each)"
bypass=$(grep -rnE "pgRaw|pgElevated|withElevated" "${SEARCH[@]}" --include="*.ts" 2>/dev/null \
  | grep -vE "$EXCLUDE_RE" \
  | grep -vE "^(${POSTGRES_MODULE}|${TENANT_MODULE}):" || true)
if [ -n "$bypass" ]; then
  while IFS= read -r line; do
    file="${line%%:*}"; rest="${line#*:}"; lineno="${rest%%:*}"
    annotate_warning "$file" "$lineno" \
      "Tenant-scope bypass (pgRaw / pgElevated / withElevated) — confirm this path is legitimately cross-org or an approved escape hatch."
    echo "  BYPASS $file:$lineno"
    findings=$((findings + 1))
  done <<< "$bypass"
else
  echo "  OK — no escape-hatch / elevated consumers outside the wrapper module"
fi

# --- 3. Informational census -----------------------------------------------
echo
echo "## 3. Census (informational only)"
connect_count=$(grep -rn "pg\.connect(" "${SEARCH[@]}" --include="*.ts" 2>/dev/null \
  | grep -vE "$EXCLUDE_RE" | wc -l | tr -d ' ')
echo "  pg.connect() explicit-transaction sites: ${connect_count}"
echo "    (these rely on the savepoint proxy once the request middleware lands — PR 7)"

echo
echo "----------------------------------------------------------------"
echo " Flagged items (warnings): ${findings}  —  exit 0 (warn-only)"
echo "----------------------------------------------------------------"

exit 0
