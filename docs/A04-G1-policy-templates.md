# A04-G1 — RLS Policy Templates (Phase 0 deliverable)

The canonical Postgres Row-Level Security policy shapes for the A04-G1 rollout.
**This document is the authority every per-table phase-2/phase-3 migration
references** — the way the phase-1 admin-surface PRs (7.a–7.e) all referenced
§3 of `A04-G1-rls-rollout-plan.md`. Per-table assignment (which template a given
table uses) lives in `A04-G1-table-classification.md` §2; this doc defines the
templates themselves and the rules for choosing between them.

Governing decisions (see rollout-plan §1):
- **A1** — the engine connects as the non-owner role `app_request`
  (`NOBYPASSRLS`); the owner / elevated channel (`pgElevated`, migrations,
  cross-org workers via `MIGRATION_DATABASE_URL`) keeps bypassing RLS. We do
  **not** use `FORCE ROW LEVEL SECURITY` (that was the rejected A2 path).
- **B1** — tenant context is a transaction-local GUC, `app.current_org_id`, set
  by `withTenant(orgId, …)` via `SELECT set_config('app.current_org_id', $1, true)`
  after `BEGIN`.

All templates therefore key on
`NULLIF(current_setting('app.current_org_id', true), '')::uuid`. Both pieces are
load-bearing: the `missing_ok = true` second argument, and the `NULLIF(…, '')`
wrapper that collapses a *reset* (empty-string) GUC to NULL. See §I — this was
corrected during the phase-2 pilot after the harness proved a pooled connection
reads an unset GUC back as `''`, not NULL.

---

## §A — CUSTOMER-DATA (per-org) — the standard template

For any table with its own `organization_id NOT NULL` column. This is the
common case (~52 tables: `actions`, `assessments`, `controls`, `risks`,
`vendors`, `evidence`, `findings`, `policies`, `posture_snapshots`, `users`,
… — see classification §2 for the full list).

```sql
ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS <table>_tenant_isolation ON <table>;

CREATE POLICY <table>_tenant_isolation ON <table>
  USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
```

- **No `FORCE`** — the owner/elevated channel must keep bypassing (A1).
- **Single `FOR ALL` policy** (USING + WITH CHECK), not four per-command
  policies — `USING` filters which existing rows are visible/affected by
  SELECT/UPDATE/DELETE; `WITH CHECK` constrains the new-row image on
  INSERT/UPDATE so a tenant cannot stamp a row with another org's id. Same
  expression in both (see §G for when WITH CHECK may be omitted).
- **Re-apply safe** — `DROP POLICY IF EXISTS` guards the non-idempotent
  `CREATE POLICY`.

`findings` is the phase-2 pilot under this template
(`20260619_findings_rls_pilot.sql`).

---

## §B — HYBRID / NULLABLE-org

For tables where `organization_id` is **nullable**: a `NULL` row is a
platform-level row visible to every tenant; a non-null row is org-specific.
Tables (classification §2): `audit_log`, `cyber_signals`, `insights`,
`newsletter_issues`, `newsletter_deliveries`, `subscribers`. These are the
riskiest batch (rollout-plan phase-3 batch F) and go last.

```sql
ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS <table>_tenant_isolation ON <table>;

CREATE POLICY <table>_tenant_isolation ON <table>
  USING (
    organization_id IS NULL
    OR organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid
  )
  WITH CHECK (
    organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid
  );
```

- **`USING` is permissive on `NULL`** — every tenant reads platform rows. This
  matches the existing app-layer pattern, e.g. `briefScheduler.ts:232` reads
  `(organization_id = $1 OR organization_id IS NULL)`, and the §3 `‡` footnote
  for `subscribers` / `newsletter_issues`.
- **`WITH CHECK` is NOT permissive on `NULL`** — `app_request` may only write
  rows stamped with its own org. **NULL-org (platform) writes go through the
  owner / elevated channel**, never `app_request`. This asymmetry is the whole
  point of the hybrid shape: read platform rows, but never let a tenant forge
  one. (A tenant attempting `INSERT … organization_id = NULL` fails WITH CHECK
  because `NULL = <uuid>` is `NULL`, not true.)

---

## §C — ROOT-TENANT (`organizations`)

The `organizations` table is its own tenant root: an org should see only its
own row.

```sql
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS organizations_tenant_isolation ON organizations;

CREATE POLICY organizations_tenant_isolation ON organizations
  USING      (id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
```

The key is `id`, not `organization_id`. Under `withTenant(id)` the GUC equals
the org's own id, so the policy `id = GUC` makes exactly that one row visible.

**⚠️ Phase-3 prerequisite — convert `adminOrganizations.ts:99` to
`withTenant(id)` BEFORE enabling RLS on `organizations`.** That route still
runs `SELECT … FROM organizations WHERE id = $1` on the raw `pg` proxy (PR #128
classified it but was doc-only; the code was never migrated). Post-flip, with
RLS enabled and no `app.current_org_id` set, that SELECT returns **zero rows**
→ the route 404s every org lookup. This is a real blocker for the
`organizations` batch (not for the `findings` pilot — `organizations` gets no
policy in phase 2). Do the `withTenant(id)` conversion in the same PR that
enables RLS on `organizations`, or immediately before it.

Writes to `organizations` (admin / Stripe / customer-signup) run on the
**owner** path (Tier C grants `app_request` SELECT only), so `WITH CHECK` here
guards only the rare app_request-side write; keep it for symmetry.

---

## §D — INDIRECT (org via FK chain, no own org column)

For tables with no `organization_id` of their own, scoped through a parent.
Tables (classification §2): `domain_scores` (→ `posture_snapshots`),
`control_mappings` / `obligation_mappings` (→ `controls`/`obligations`),
`alert_sends` (→ `users`), `intelligence_brief_sends` (→ briefs/subscribers),
`newsletter_issue_insights` (→ `newsletter_issues`).

```sql
ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS <table>_tenant_isolation ON <table>;

CREATE POLICY <table>_tenant_isolation ON <table>
  USING (
    <fk_column> IN (
      SELECT id FROM <parent>
      WHERE organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid
    )
  )
  WITH CHECK (
    <fk_column> IN (
      SELECT id FROM <parent>
      WHERE organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid
    )
  );
```

- Higher evaluation cost (subquery per row) — ensure the FK column and the
  parent's `organization_id` are both indexed.
- If the parent is itself HYBRID (nullable org), the parent subquery inherits
  the §B `IS NULL OR …` shape — decide per table.
- **`findings` is NOT an INDIRECT table** despite once being listed as such; it
  has a direct `organization_id NOT NULL` column and uses §A. (Classification
  §2 corrected alongside the pilot.)

---

## §E — SHARED-REF (global, no policy)

Tables that are global by design and carry no org column. **No RLS policy.**
Access is controlled purely by the grant tier in
`20260618_create_app_request_role.sql`:

- **Tier C (SELECT-only grant), read in the request path:** `email_suppressions`,
  `intelligence_brief_sources`, `published_artifacts`, `risk_scale_presets`.
- **Tier D (NO grant — absence of grant IS the policy):** `auth_anomaly_alerts`,
  `webhook_events_processed`, `worker_runs`, `schema_migrations`. `app_request`
  cannot touch these at all; they are owner/elevated-only.

Do not `ENABLE ROW LEVEL SECURITY` on these — there is nothing to scope, and a
policy would only add evaluation cost or risk locking out the elevated path.

---

## §F — Skip / special cases

- **`password_history`** — user-scoped (FK `user_id → users`), no
  `organization_id`. It is technically §D-INDIRECT (via `users.organization_id`),
  but it is **skipped in phase 2 and deferred** in phase 3: it is only ever read
  in the auth path keyed by `user_id`, never enumerated cross-org, and the
  subquery cost on a hot auth path is not worth it for a table with no
  cross-org read surface. If it is ever exposed by a new route, revisit with the
  §D template against `users`. Documented here so the skip is explicit, not an
  oversight.
- **`email_provider_events`** — SHARED-REF, but note the open migration gap
  (no `CREATE TABLE` in `db/migrations/` on develop — classification §2 line
  flag). Reconcile that gap before granting/enabling anything; no policy
  regardless (global event log).

---

## §G — WITH CHECK decision rule

- **Include `WITH CHECK`** (same expression as `USING`) on any table
  `app_request` can `INSERT`/`UPDATE` — i.e. every Tier A table. Without it, a
  tenant could `INSERT`/`UPDATE` a row stamped with another org's id even though
  it could not later read it. This is the default.
- **Omit `WITH CHECK`** only on tables `app_request` reads but never writes
  (Tier C SELECT-only) — there is no write to constrain. In practice such tables
  are SHARED-REF (§E, no policy at all), so the omit case is rare.
- **Hybrid (§B)** is the one place `USING` and `WITH CHECK` differ
  deliberately: read platform (`NULL`) rows, but never write them as a tenant.

---

## §H — How to verify a policy (manual recipe)

The recipe the harness automates (`test/isolation/findingsRls.test.ts`). No
`app_request` password needed — a superuser `SET ROLE`s into it:

```sql
-- as a superuser / owner connection:
BEGIN;
SET LOCAL ROLE app_request;                                   -- become the non-owner role
SELECT set_config('app.current_org_id', '<org-A-uuid>', true);-- tx-local tenant context

-- expect: only org A's rows, even with no WHERE filter
SELECT id, organization_id FROM <table>;

-- expect: zero rows (cross-org denied) even with an explicit WHERE
SELECT id FROM <table> WHERE organization_id = '<org-B-uuid>';

ROLLBACK;                                                     -- reverts role + GUC
```

Checklist per table class:
1. **Scoped read** — org-A context returns only org-A rows.
2. **Cross-org read** — explicit `WHERE organization_id = <org-B>` returns 0.
3. **Unset GUC** — `SET LOCAL ROLE app_request` with no `set_config` → 0 rows
   (fail-closed, §I).
4. **WITH CHECK** — `INSERT … organization_id = <org-B>` under org-A context
   → `ERROR: new row violates row-level security policy`.
5. **Owner bypass** — without `SET ROLE`, the owner sees all rows (confirms the
   elevated path still works; A1, no FORCE).
6. **Hybrid only** — `NULL`-org rows are visible to every tenant on read but a
   tenant cannot write one.

To inspect state directly:
```sql
SELECT relname, relrowsecurity, relforcerowsecurity
FROM pg_class WHERE relname = '<table>';        -- relrowsecurity = true, relforcerowsecurity = false (A1)
SELECT polname, polcmd, pg_get_expr(polqual, polrelid) AS using,
       pg_get_expr(polwithcheck, polrelid) AS with_check
FROM pg_policy WHERE polrelid = '<table>'::regclass;
```

---

## §I — Unset / empty-string GUC behavior, and rollback

**Why `NULLIF(…, '')` — the empty-string trap (discovered in the pilot).** The
intuition is "unset GUC → `current_setting(…, true)` returns NULL → `org = NULL`
→ zero rows." That is true only for a GUC that was *never touched* in the
session. But `app_request` runs over a **connection pool**: a connection that
served one `withTenant` request has had `app.current_org_id` SET (tx-locally)
and then reset at transaction end — and a custom GUC in that
set-then-reset state reads back as an **empty string `''`, not NULL**. A bare
`''::uuid` raises `invalid input syntax for type uuid` (SQLSTATE `22P02`). So
the naive `current_setting(…)::uuid` template would turn a forgotten
`withTenant` into a **500 on a reused connection** — and would *fail*
rollout-plan §5's "unset → assert zero rows" requirement. The pilot test caught
exactly this (a pooled connection reproduced the `''` state).

**The fix — `NULLIF(current_setting('app.current_org_id', true), '')::uuid`.**
`NULLIF(NULL, '')` and `NULLIF('', '')` both yield `NULL`, so **both** the
never-set and the reset-to-empty states collapse to `NULL` → `organization_id =
NULL` → **zero rows**. Fail-closed to an empty result in every unscoped state,
no 500, no leak. A genuinely malformed non-empty value (e.g. `'abc'`) still
raises `22P02` — which is correct, because `withTenant` only ever sets a valid
uuid or nothing, so a non-empty non-uuid is real corruption worth failing
loudly on. The pilot test (`findingsRls.test.ts`) asserts **zero rows** for
both the unset and the empty-string cases, pinning this contract.

This is a deliberate refinement over the paraphrased SQL in rollout-plan
§3/§4 (which §4 explicitly deferred to "actual SQL drafted in the phase-2 PR").
**Every template above uses the `NULLIF` form; do not drop it.**

**Rollback (all templates are forward-only migrations).** No down-migration
file ships. If a policy must be removed manually:

```sql
DROP POLICY IF EXISTS <table>_tenant_isolation ON <table>;
ALTER TABLE <table> DISABLE ROW LEVEL SECURITY;
```

Because RLS is inert until the operator flips `DATABASE_URL` to `app_request`
(the owner bypasses RLS under A1), a policy migration that lands ahead of the
flip is a no-op and needs no rollback; the rollback procedure matters only
post-flip.
