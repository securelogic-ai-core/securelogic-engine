# Stop Gate A — External Isolation Readiness · Evidence

Program: September 15 design-partner launch
Branches: `feat/sept15-va-phase1-engagement-spine`
Date: 2026-08-12
Harness: Postgres 16, full 211-migration set, `SET ROLE app_request` (NOBYPASSRLS, non-owner)

---

## Verdict

**Database-layer isolation: PASS.**
**Gate overall: PARTIAL** — one criterion is not satisfiable from this environment (§5).

---

## 1. Criteria

| # | Criterion | Result |
|---|---|---|
| A.1 | RLS enabled + policy on every Tier A and Tier B table | **PASS** |
| A.2 | A passing `test/isolation/` file per table under `SET ROLE app_request` | **PASS** |
| A.3 | Every route touching those tables is tenant-scoped | **PASS** |
| A.4 | No route reads `organization_id` from a request body | **PASS** |
| A.5 | Security review sign-off recorded | **NOT SATISFIABLE HERE** — operator-owned |

---

## 2. Tables now protected

Before this work, **nine** vendor-domain tables had no row-level security. That
set holds the most sensitive content in the product: the vendor register,
uploaded third-party SOC reports, and everything extracted from them.

| Table | Migration | Note |
|---|---|---|
| `vendor_engagements` | `20260920` | New spine — RLS landed with the table |
| `vendors` | `20260921` | The register itself |
| `vendor_reviews` | `20260921` | |
| `vendor_assurance_documents` | `20260921` | Uploaded SOC PDFs |
| `vendor_assurance_extractions` | `20260921` | |
| `vendor_assurance_extraction_spans` | `20260921` | |
| `vendor_assurance_review_decisions` | `20260921` | |
| `vendor_assurance_field_overrides` | `20260921` | |
| `vendor_assurance_cuecs` | `20260921` | |
| `vendor_assurance_cuec_control_mappings` | `20260921` | |

All are `ENABLE ROW LEVEL SECURITY`, **NOT FORCE**. Not-force is deliberate: the
owner/elevated channel (`pgElevated`, migrations, the vendor-extraction worker's
claim poll, and — from Phase 3 — the portal's pre-org-context token lookup) must
keep bypassing RLS for legitimate cross-org work.

Every policy uses `NULLIF(current_setting('app.current_org_id', true), '')::uuid`.
The `NULLIF` is mandatory rather than stylistic: pooled `app_request` resets the
GUC to `''` (not NULL) between checkouts, so a bare `''::uuid` cast would raise
instead of isolating.

---

## 3. The precondition that had to be met first

The standing A04-G1 rule is **policy ⟹ routes wrapped**. A policy on a table
whose routes are unscoped is a latent zero-rows failure that appears only at the
`app_request` flip — invisible in review and invisible in staging until then.

`vendorAssuranceDocuments.ts` shipped **18 routes with zero tenant scoping**, so
this migration could not have landed safely before Phase 0 closed that.

Phase 0 (`a3e991bd`) resolved it with two mechanisms chosen by handler shape:

- **12 routes** wrapped with `asTenant` at the router;
- **6 routes** scoped explicitly with `withTenant` inside the handler, because
  they stream, redirect, perform long external I/O, or already open their own
  scope. `asTenant`'s buffering proxy throws on a handler that sets headers, and
  `withTenant` takes a fresh pool connection per call — so wrapping an
  already-scoped handler would double-connect.

`vendorReviews.ts` was already fully wrapped. `vendors.ts` routes are
`asTenant`-wrapped.

A structural guard (`vendorAssuranceTenantWrapCoverage.test.ts`) fails the build
if a new route arrives with neither mechanism, and it was **negative-tested**:
removing one `asTenant(` makes it fail by route name, and it passes again when
restored.

---

## 4. Test evidence

```
test/isolation/vendorEngagementsRls.test.ts     14 passed
test/isolation/vendorTierBRls.test.ts           48 passed
                                                ──────────
                                                62 passed

Full isolation suite:  140 files · 960 tests · 0 failed
  (baseline before this work: 138 files · 898 tests)
```

**Zero regressions** across the pre-existing 898 tests despite enabling RLS on
nine previously-unprotected tables — including `vendors`, which many suites
touch. That is the strongest single signal that the policies are correctly
scoped and that NOT FORCE is behaving as intended.

### What the isolation tests actually assert

Per table, under `SET ROLE app_request` inside `BEGIN … ROLLBACK` with a
transaction-local GUC:

- org A reads its own row, and **explicitly asking for org B's id returns zero**
  — the policy filters, it does not merely fail to volunteer;
- an unscoped `SELECT` returns only the caller's org;
- `WITH CHECK` rejects an INSERT stamped for another org (a tenant must not be
  able to plant rows it then cannot see);
- cross-org `UPDATE` and `DELETE` affect zero rows, and the target row is
  verified untouched afterwards as the owner;
- a **missing** GUC and an **empty-string** GUC both fail CLOSED — zero rows,
  never an exception, never everything;
- the owner channel still crosses orgs (NOT FORCE verified, not assumed);
- `app_request` holds the DML grant. Without it the role gets *permission
  denied*, which superficially resembles isolation working but is the feature
  being broken for every tenant equally.

### Completeness, read from the catalogue

`vendorTierBRls.test.ts` queries `pg_class` for every `vendor%` table and fails
if any has `relrowsecurity = false`. A table added by a future migration cannot
quietly opt out — the test does not consult a hand-maintained list.

### Schema invariants also certified

- a decision cannot be recorded without a non-blank rationale
  (`vendor_engagements_decision_consistency`);
- only a `targeted` engagement may descend from a parent;
- scores are constrained to 0–100;
- cancellation always carries a reason.

---

## 5. The one criterion not satisfiable here

**A.5 — security review sign-off.** Requires a human reviewer and is
operator-owned. Nothing in this environment can produce it.

Related environment limits, recorded so the gap is not mistaken for an oversight:
no staging or production credentials exist here, so Stop Gate B's "a real
external tester completes an engagement on staging" and the end-to-end
walkthroughs remain operator-owed. D2 (production R2 configuration) is likewise
unprovable from the repository.

---

## 6. Reproducing this locally

There is no `DATABASE_URL` in the dev container, and without one **all 137
isolation files fail to import**. Docker is available:

```bash
docker run -d --name slpg -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=securelogic_test -p 5433:5432 postgres:16

export TEST_DATABASE_URL="postgres://postgres:postgres@localhost:5433/securelogic_test"
export DATABASE_URL="$TEST_DATABASE_URL"
npx vitest run --config vitest.isolation.config.ts
```

Two notes for whoever does this next:

- `ssl: false` is required. `scripts/runMigrations.ts:17` hardcodes
  `ssl: { rejectUnauthorized: false }` and therefore **cannot** run against local
  Postgres — use the harness, which sets `ssl: false` itself.
- Applying migrations in plain filename order fails at
  `20260504_user_alert_preferences_org_scope.sql`. The harness performs retry
  passes for ordering-dependent migrations, so **the harness is the only valid
  migration validator**.
