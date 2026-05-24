# A04-G1 — Postgres RLS Rollout Plan (package scoping)

**Status:** Draft for operator review. No code or migrations have been authored. Plan is gated on operator decisions in §1 (A) and §1 (B).
**Source finding:** `docs/security-audit-owasp-2026-05.md:224-230`. Standard: `TENANT_ISOLATION_STANDARD.md` §4 / §6 / §11 R1 + R8 / §12 / §13.
**Survey baseline (HEAD `6bf5042d`):** 94 migrations, 81 distinct tables, 110 route files (85 reference `organization_id`), zero RLS artifacts in code or schema, single shared `Pool` connecting as DB owner, no `SET LOCAL` / `set_config` / `SET ROLE` anywhere.

This is a defense-in-depth package. It does not replace per-route discipline (R1) or the cross-org isolation harness (E1-G1) — it makes a missed `WHERE organization_id` predicate non-leaking instead of silently leaking.

---

## §1. Decisions

> **Status: LOCKED 2026-05-24.** Operator chose **A1 + B1**. Rationale below; full tradeoff analysis preserved beneath the decision blocks for reference.

### Decision A — Owner-bypass approach: **A1 (non-owner application role) — DECIDED**

A new `app_request` (or `securelogic_app`) Postgres role is introduced. The engine connects as this non-owner role; migrations and admin tooling continue to run as the owner role.

**Rationale:** Clean separation between "code that should be tenant-scoped" (the engine, connecting as `app_request`, going through RLS) and "code that legitimately spans tenants" (migrations, cross-org workers, admin scripts, running as the owner). The A2 alternative would require `FORCE ROW LEVEL SECURITY` plus a per-statement `SET LOCAL row_security = off` discipline on every owner-running script — a discipline that decays silently. The role-management cost of A1 is bounded; the discipline cost of A2 is forever.

### Decision B — Session-variable mechanism: **B1 (transaction-wrapped `SET LOCAL`) — DECIDED**

Every customer-data request is wrapped in a transaction by middleware. `SET LOCAL app.current_org_id` runs inside the transaction; the request handler runs against the same client; transaction commits on success or rolls back on error.

**Rationale:** Correct-by-construction — the transaction boundary *is* the tenant boundary, so the stale-GUC hazard that haunts B2 cannot occur. The cost is a wider refactor surface (every customer-data query call site must use the request-scoped client via `AsyncLocalStorage` rather than the raw pool), but that refactor is one-time and verifiable; B2's pool-checkout discipline would be permanent and easy to bypass. Read-replica complications are out of scope today and remain out of scope.

**Combined choice (A1 + B1):** the most paranoid of the four combinations. The plan accepts the wider refactor surface in phase 1 in exchange for two independent failure modes (role separation + transaction-scoped GUC) instead of one.

---

### Decision A — Owner-bypass approach (analysis, preserved for reference)

The app currently connects as the database owner role. Postgres RLS is **bypassed by table owners by default** (`pg_class.relrowsecurity` only applies to non-owners; `pg_class.relforcerowsecurity` applies to everyone). If we ship `ENABLE ROW LEVEL SECURITY` without addressing this, policies will be in place but the application will pass through them untouched — silent no-op, false sense of safety.

Two ways to fix it:

**A1. Introduce a non-owner application role.** Create `securelogic_app` role. Grant scoped DML (SELECT/INSERT/UPDATE/DELETE on customer-data tables, SELECT on reference tables). Migrations and admin tooling continue to run as the owner role; the engine connects as the new role. RLS policies apply because the connecting role is no longer the owner.

- *Render constraint:* Render-managed Postgres exposes one default role per database in the dashboard. Creating an additional role requires `CREATE ROLE` privilege, which the default role does have on its own database — but the role lifecycle is then *our* problem, not Render's: password rotation, dashboard-invisible permissions, and any `pg_dump`/restore flow have to know the second role exists. Render does not surface custom roles in any UI.
- *Connection-string impact:* `DATABASE_URL` would need to be changed in Render env to use the new role's password. The owner role's connection string is still needed for migrations (the engine's `startCommand` auto-runs `npm run migrate` — see §4 below — and the migrate runner needs DDL privilege). Either the migrate runner is given a separate `MIGRATION_DATABASE_URL`, or migrations run as the application role and we grant it `CREATE` on the schema (defeats the point).
- *Background jobs:* per-org workers (posture worker, brief scheduler) inherit the app role automatically — they go through RLS. Cross-org workers (KEV polling, NVD adapter, CISA alerts, intelligence ingestion — see §3) become a problem and need an explicit elevated path.
- *Risk:* one more secret to rotate; misconfigured connection string ⇒ engine boots but cannot read/write; permission grants drift over time and need a verifier.

**A2. `ALTER TABLE … FORCE ROW LEVEL SECURITY` on every customer-data table.** Keep the single owner role. `FORCE` makes policies apply even to the owner — no role split.

- *Migration impact:* every migration that creates a customer-data table going forward must remember to `ENABLE` *and* `FORCE` RLS, or the table reverts to the bypass default. We need a verifier (the test in §5 catches it at PR time; a `pg_class` check in CI catches it durably).
- *Admin tooling impact:* every script that runs as the owner against customer-data tables now hits RLS. `scripts/seed-demo.ts`, `scripts/backfill-vendor-assurance-cuecs.ts`, `scripts/triggerBriefForOrg.ts`, `scripts/backfillRequirementDescriptions.ts`, and the migrate runner itself (for any data-migration step touching customer-data rows) all need to set `app.current_org_id` per-statement or be granted an explicit bypass via a per-statement `SET LOCAL row_security = off` (requires the role to have `BYPASSRLS` attribute, which the default Render role does not have unless we toggle it).
- *Background jobs:* same per-statement gymnastics for any cross-org job that legitimately spans tenants — and the bypass cannot be silent or it defeats the point.
- *Risk:* every future migration is one `FORCE` keyword away from a silent regression; tooling-vs-RLS friction shows up in scripts, not at PR time.

**Tradeoff in one line:** A1 introduces a role-management problem we currently don't have, in exchange for clean separation between "code that should be tenant-scoped" and "code that legitimately spans tenants." A2 keeps the role topology simple, in exchange for every migration and every owner-running script having to be RLS-aware forever.

**Operator decision needed:** A1, A2, or hybrid. *(Decided above — A1.)*

### Decision B — Session-variable mechanism (analysis, preserved for reference)

RLS policies will reference `current_setting('app.current_org_id', true)::uuid`. *Something* has to set that GUC per-request. Two patterns:

**B1. Wrap each request in a transaction; `SET LOCAL app.current_org_id` inside.** `SET LOCAL` is per-transaction; outside a transaction it's a no-op. So this requires a middleware that issues `BEGIN`, sets the GUC, runs the request handler against the same client, then `COMMIT` / `ROLLBACK`.

- *Hot path impact:* every customer-data request becomes a transaction. `pg.Pool.query()` calls inside route handlers currently each grab a connection from the pool; under B1 they all need to use a single client checked out by the middleware. That's a refactor of every customer-data query call site, or an `AsyncLocalStorage`-backed client lookup.
- *Failure mode:* a single missed transaction boundary leaks the previous request's GUC into the next request *or* sets nothing and RLS denies every row. Either failure is loud (test catches it) but the refactor surface is wide.
- *Read replicas / future work:* transactions interact with read-replica routing — anything that wants to send reads to a replica needs to be transaction-aware. Not a problem today, becomes one if we ever add replicas.

**B2. `set_config('app.current_org_id', $1, false)` on every checkout.** The `false` third argument makes the setting connection-scoped (not transaction-scoped). Combined with a pool checkout hook, every connection borrowed for a request gets the GUC set as the first statement; the connection is returned to the pool afterward.

- *Hot path impact:* one extra round-trip per checkout — `set_config(...)` round-trip before the route handler's queries. The current pool is `pg.Pool`; we'd wrap `pool.connect()` (or replace direct `pool.query` calls with a tenant-aware helper that does `connect → set_config → query → release`).
- *Failure mode — critical:* `set_config(..., false)` is **session-scoped**. If a connection is returned to the pool without resetting the GUC and the *next* checkout doesn't overwrite it, that next request runs with the *previous* tenant's GUC. This is the classic "stale session variable" hazard. Mitigation is to make the set-config-on-checkout helper non-bypassable — every code path that gets a client must go through it — and to also `RESET app.current_org_id` on release. Even with discipline, this is a footgun; the verification test in §5 must explicitly probe for it.
- *No transaction needed:* leaves the existing query-per-call shape intact. Far smaller refactor.

**Tradeoff in one line:** B1 is correct-by-construction (transaction boundary == tenant boundary) but every customer-data query call site changes. B2 is a one-helper change but lives or dies on the pool-checkout discipline, with a quiet-failure mode where cross-tenant data is served because someone bypassed the helper.

**Note on combined choice:** A1 + B2 is the most common shape in production codebases (separate role + checkout-time GUC). A2 + B1 is the most paranoid. A1 + B1 is overkill. A2 + B2 is the weakest — relies on `FORCE` + an easily-bypassed helper.

**Operator decision needed:** B1 or B2. *(Decided above — B1.)*

---

## §2. Table triage

81 distinct tables exist in `db/migrations/`. Approximate classification — to be locked down in phase 0 with the verification method below:

### Bucket 1 — customer-data, needs RLS policy (≈ 70 tables)

These are tables that already carry an `organization_id` column (declared either at CREATE TABLE or added via ALTER TABLE ADD COLUMN). Every row belongs to exactly one tenant.

Examples (not exhaustive): `actions`, `ai_governance_assessments`, `ai_systems`, `ai_system_vendor_dependencies`, `api_keys`, `api_usage_daily`, `assessments`, `audit_log`, `control_assessments`, `control_mappings`, `controls`, `dashboard_preferences`, `dependencies`, `dependency_assessments`, `domain_scores`, `email_suppressions`, `evidence`, `findings`, `frameworks`*, `governance_reviews`, `insights`, `intelligence_brief_items`, `intelligence_briefs`, `intelligence_brief_sends`, `intelligence_brief_sources`, `intelligence_brief_subscribers`, `newsletter_deliveries`, `newsletter_issues`, `obligation_assessments`, `obligation_mappings`, `obligations`, `organization_risk_scales`, `org_invites`, `org_sso_configs`, `policies`, `policy_control_links`, `posture_snapshots`, `reports`, `requirement_responses`, `requirements`*, `risk_control_links`, `risk_obligation_links`, `risks`, `risk_scale_presets`, `risk_scoring_weights`, `risk_settings`, `risk_treatments`, `security_audit_log`, `signal_*_links` (4 link tables), `signal_match_suggestions`, `subscribers`, `trends`, `trend_signals`, `user_alert_preferences`, `users`, `vendor_assessments`, `vendor_assurance_*` (7 tables), `vendor_reviews`, `vendors`, `webhook_deliveries`, `webhook_endpoints`, `worker_runs`.

\* `frameworks`, `requirements`, `control_mappings`, `obligation_mappings`, `risk_scale_presets` — these may turn out to be **hybrid**: some rows are the global catalog (NIST 800-53 framework, HIPAA obligation catalog), others are per-org customizations. Phase 0 must resolve each: is the catalog stored in this same table with `organization_id IS NULL` (and per-org rows non-null), or in a separate catalog table? Policy shape differs — see §3, "Hybrid global-plus-tenant tables."

### Bucket 2 — shared reference / no policy (≈ 1 table)

Tables that intentionally have no `organization_id` because they are global by definition. Confirmed:

- `webhook_events_processed` — the webhook idempotency table (`78f509cc`). Keyed by `event_id`; no tenant scope.
- `schema_migrations` — the migrate runner's bookkeeping table.

### Bucket 3 — cross-org-job-accessed, needs explicit elevated path (≈ 5–10 tables)

Tables that the cross-org workers write to per §6. These either have `organization_id NULL` for global rows + non-null for per-org overrides (the `cyber_signals` pattern, established in `20260420_cyber_signals_allow_null_org.sql`) or have no org column and are pure global signal stores. Candidates:

- `cyber_signals` — `organization_id` nullable; global advisories carry NULL.
- `signals`, `signal_*` link tables — likely similar; needs row-level inspection.
- `auth_anomaly_alerts` — ledger for the A04-G4 dedup; per-IP, not per-org.
- `alert_sends` — operator-alert dedup; per-process.
- `password_history` — per-user; FK chain to org but no direct column. Policy uses subquery `WHERE user_id IN (SELECT id FROM users WHERE organization_id = current_setting(...))`.
- `published_artifacts` — publication ledger; needs review (is this per-org or global?).

Bucket 3 is the hardest. RLS policies on these tables must allow:
- *Reads* by the per-org consumption step (a user reading a `cyber_signal` that matches their org's controls).
- *Writes* by the cross-org ingestion worker (which doesn't have a single `organization_id` to set).

### Classification method (phase 0 deliverable)

Rather than enumerate by inspection, the phase 0 work item is to produce a **classification matrix** as `docs/A04-G1-table-classification.md` by:

1. For every table in the migration log, query `information_schema.columns` to determine if `organization_id` exists, and if so its `is_nullable` value.
2. For every table flagged as nullable-org or no-org, grep `src/api/` for write call sites to identify which workers/routes are the legitimate writers.
3. Categorize: pure tenant (non-null org), pure global (no org), hybrid (nullable org), per-user-indirect (FK to `users`).
4. Per category, lock the policy shape (see §3).

This matrix is the source of truth for phase 1 onward — no migration is written without consulting it.

---

## §3. Background-job problem — cross-org read paths that will break under RLS

These are the legitimate cross-org code paths today. Each needs explicit handling before the phase that turns RLS on for the affected table.

### Per-org loops (no break — RLS-compatible by construction)

The §6 "canonical pattern: posture worker" loops `SELECT id FROM organizations WHERE status = 'active'` and processes each org one at a time. Files involved:

- `src/api/lib/briefScheduler.ts` — brief generation per active org.
- `src/api/lib/schedulerRunner.ts` — node-cron host wraps the above.
- `src/api/lib/authAnomaly.ts` — auth anomaly scanner runs per-IP across the `security_audit_log` table; rows in that table are already org-scoped, so this works *if* the scanner can read all orgs' rows (it must, by design — it's a security operator function, not a tenant function). **This is a true cross-org reader.**

**Treatment:** wrap each iteration in `SET LOCAL app.current_org_id = '<that org>'` (B1) or `set_config(..., false)` followed by reset (B2) per iteration. For `authAnomaly` specifically: it must use the elevated path (see "elevated path" below), because it legitimately reads across all orgs.

### Cross-org ingestion workers — write paths

These workers read public sources and write to shared signal tables. From the §6 enumeration + grep evidence:

- `src/api/lib/cisaKevAdapter.ts` — CISA KEV polling. Writes to `cyber_signals` with NULL org.
- `src/api/lib/cisaAlertsAdapter.ts` — CISA alerts ingestion. Same.
- `src/api/lib/nvdAdapter.ts` — NVD CVE ingestion. Same.
- `src/api/lib/mitreAttackAdapter.ts` — MITRE ATT&CK ingestion. Same.
- `src/api/lib/cyberSignalProcessingService.ts` — normalization + persistence path.
- `src/api/lib/cyberSignalNormalizer.ts`, `cyberSignalValidation.ts` — pure functions, no DB.

**Treatment:** these writers need to insert rows with `organization_id IS NULL`. Two policy shapes possible on `cyber_signals`:

- *Permissive write:* policy allows INSERT where `organization_id IS NULL` from any role, with `organization_id = current_setting('app.current_org_id')` from the app role for per-org rows. Cleanest.
- *Elevated path:* writes from these adapters go through a separate "elevated" connection that bypasses RLS entirely (A1: a second role with `BYPASSRLS` attribute; A2: `SET LOCAL row_security = off` per-statement). The adapter knows it is system code.

The elevated path is unavoidable for `authAnomaly` (cross-org *read*, not just write).

### Per-org reads — fan-out at consumption

§6: "Per-org fan-out MUST happen at consumption time (brief generation, finding creation, signal-to-vendor linkage) — and the consumption step is itself an org-scoped operation under §4."

Files involved (cross-org reads of global signals filtered to one org's perspective):
- `src/api/lib/briefSynthesizer.ts` — reads `cyber_signals` (global + own-org overrides) when building a brief for org X.
- `src/api/lib/briefScheduler.ts` (per-org loop above, calls synthesizer).
- Various route handlers that surface a signal to a tenant user.

**Treatment:** RLS policy on `cyber_signals` for SELECT should be: `organization_id IS NULL OR organization_id = current_setting('app.current_org_id')::uuid`. Same for other hybrid tables. This means a tenant sees the global rows plus their own — without leaking other tenants' overrides.

### Admin surface

`src/api/middleware/requireAdminKey.ts` chain authenticates staff; admin routes today run as the same DB role as customer requests but with `req.organizationContext.organizationId = null` (no org binding).

**Treatment:** admin reads of customer data must set `app.current_org_id` to the *target* org (the one the operator is impersonating) — every admin route that takes an `organizationId` parameter must push it into the session GUC, exactly the same way customer routes push the requester's own org. Admin reads that legitimately span orgs (e.g. operator dashboard counting open findings across all orgs) must use the elevated path.

### Migrations and admin scripts

`scripts/runMigrations.ts` runs DDL — under A1 it runs as the migration role, which is the owner; under A2 it runs as the owner with `row_security = on` and would be blocked from data-touching steps. Scripts in `scripts/` that mutate customer data (`backfill-vendor-assurance-cuecs.ts`, `seed-demo.ts`, `triggerBriefForOrg.ts`, `backfillRequirementDescriptions.ts`) face the same problem.

**Treatment:** every such script must either run on the elevated connection (A1) or set `row_security = off` per session (A2 + BYPASSRLS grant).

---

## §4. Rollout phasing — hard staging gate, controlled by migration scope

**Critical constraint:** the engine `startCommand` on Render auto-runs `npm run migrate` on every deploy (staging on `develop` push, prod on `main` merge — see memory `project_render_auto_migrate`). The migrate runner (`scripts/runMigrations.ts`) applies any `.sql` file in `db/migrations/` not yet in `schema_migrations`, in filename order, each in its own transaction. **A merge to `develop` activates the migration on staging within minutes; a merge to `main` activates it in prod within minutes.** There is no separate deploy toggle.

**Implication:** RLS activation cannot be gated on a feature flag the app reads at runtime — auto-migrate runs the SQL whether the flag is on or off. The only durable gate is **which migration file exists in which branch.** Phasing therefore proceeds *by adding one migration at a time*, observing it on staging, and only then merging to main.

### Phase 0 — Preflight, no behavior change

PR target: `develop`. Migrations: **none**. Operator decisions A and B must be locked in before this phase begins.

Deliverables:
1. `docs/A04-G1-table-classification.md` — the matrix from §2.
2. `docs/A04-G1-policy-templates.md` — the canonical policy shapes per category (tenant-only, hybrid global+tenant, per-user indirect).
3. *(If A1 chosen)* role-creation runbook authored but not executed. Render dashboard work documented; `MIGRATION_DATABASE_URL` env-var plan written.
4. A new `npm` script `test:rls` (vitest config) wired in CI but with zero tests — placeholder so phase 2 can drop tests into a known job. CI passes green.

Staging gate: nothing migrates. Verify CI green on develop. **Merge to main only after operator sign-off on §2 and §3.**

### Phase 1 — Plumbing, still no policies

PR target: `develop`. Migrations: **none yet** — this phase is app-layer only.

Deliverables:
1. Tenant-context helper based on Decision B:
   - *(B1)* request-scoped transaction wrapper; refactor `attachOrganizationContext.ts` to wrap downstream middleware/handlers in a `BEGIN … SET LOCAL … COMMIT` block; introduce `AsyncLocalStorage`-backed client lookup for `pg` usage inside the wrapped scope.
   - *(B2)* tenant-aware checkout helper; replace direct `pg.query()` call sites with `withTenant(orgId, async (client) => …)` that does `connect → set_config → query → reset → release`.
2. Per-org workers (briefScheduler, posture worker, etc.) updated to set the GUC at the top of each iteration.
3. Cross-org workers (KEV/NVD/MITRE/CISA adapters, `authAnomaly`) updated to use the elevated path (the elevated path is implemented but inert — until policies exist, it has nothing to bypass).
4. `withTenant`-coverage CI check: a script that greps for direct `pg.query(` / `pool.connect(` outside the helper and lists offenders. Starts as a warn-only job; phase 2 promotes it to required.

Staging gate: app boots, all features work, zero RLS-related errors in logs. Verify `attachOrganizationContext` is now ALSO setting the GUC on every customer request (instrument a debug log line for one staging day, then remove). **Merge to main only after a clean staging day.**

### Phase 2 — Pilot table: `findings`

PR target: `develop`. Migrations: **one new file** — `db/migrations/2026MMDD_rls_pilot_findings.sql`.

`findings` is chosen because:
- It is heavily tested by the cross-org isolation harness (E1-G1 already probes `findings` cross-org on GET and PATCH).
- It has a clean `organization_id NOT NULL` shape (no hybrid rows).
- It is wide-touched by routes — a regression is loud, not silent.

Migration body (paraphrased — actual SQL drafted in phase 2 PR):
- `ALTER TABLE findings ENABLE ROW LEVEL SECURITY;`
- *(If A2)* `ALTER TABLE findings FORCE ROW LEVEL SECURITY;`
- `CREATE POLICY findings_tenant_isolation ON findings USING (organization_id = current_setting('app.current_org_id', true)::uuid);` (one policy for SELECT/INSERT/UPDATE/DELETE, or four separate, per §3 templates)
- *(If A1)* the policy applies because connecting role is no longer owner. No explicit role grant needed beyond what was set up in phase 0.

Tests added in this PR (see §5):
- The harness's existing `findings` GET/PATCH probes still pass (proves the app-layer behavior is unchanged for legitimate users).
- A new probe: connect as the app role, deliberately omit `WHERE organization_id`, attempt to read another org's row, assert zero rows returned (proves DB-layer enforcement).
- A new probe: connect with `app.current_org_id` unset (NULL setting), attempt any read on `findings`, assert zero rows.

Staging gate (**HARD — this is the most important gate in the whole rollout**):
1. Migration applies cleanly on staging via auto-migrate.
2. Staging smoke test: log in, view findings list, view a single finding, create a finding, update a finding, delete a finding. All work.
3. Cross-org isolation harness passes against staging DB (separate one-off run with `TEST_DATABASE_URL` pointed at a staging-replica throwaway).
4. Verify `pg_class.relrowsecurity = true` and (if A2) `pg_class.relforcerowsecurity = true` for `findings` on staging.
5. **Observe staging for 48 hours** before main merge. Any 500s tagged with `findings` in logs trigger an immediate revert.

Only after these five gates pass: merge to `main`. Same auto-migrate path activates on prod.

### Phase 3 — Sweep batches

After phase 2 main-merge has cooked in prod for 7 days with no incident, batches of ~10 tables per PR. Each batch is one migration file. Each batch has its own staging gate (steps 1–4 above; the 48-hour observation window can shrink to 24 hours after phase 2 confidence).

Batch order (proposed; subject to phase 0 classification matrix):
- Batch A — read-heavy customer-data tables with non-null org column (`vendors`, `controls`, `risks`, `assessments`, `policies`, `evidence`, `actions`, `reports`, `posture_snapshots`, `users`).
- Batch B — link tables (`risk_control_links`, `risk_obligation_links`, `policy_control_links`, `signal_*_links` — but only after the global-signal hybrid policy is locked).
- Batch C — workflow tables (`*_assessments`, `*_reviews`, `*_review_decisions`).
- Batch D — vendor_assurance suite (7 tables, treat as one batch since they're tightly coupled).
- Batch E — auth/billing/audit tables (`api_keys`, `audit_log`, `security_audit_log`, `webhook_deliveries`, `webhook_endpoints`, `password_history`, `org_invites`, `org_sso_configs`).
- Batch F — hybrid global+tenant tables (`cyber_signals`, `frameworks`, `requirements`, `obligations`, `control_mappings`, `obligation_mappings`) — these get the `organization_id IS NULL OR organization_id = ...` policy shape and are the riskiest batch; they go last and on their own.
- Batch G — small remainder (`dashboard_preferences`, `user_alert_preferences`, `intelligence_brief_*`, `newsletter_*`, `trends`, `trend_signals`, `insights`, `domain_scores`).

### Phase 4 — Enforcement lock-in

After all batches in prod for 14 days no-incident:
- Promote the `withTenant`-coverage script from warn-only to required CI check.
- Add a `pg_class.relrowsecurity` CI assertion: for every table in the bucket-1 list, RLS is on; if a future migration creates a customer-data table without RLS, CI fails.
- Flip `A04-G1` status header in the audit doc from 🟥 Open → ✅ Closed.

### Why each phase ends in a hard merge-to-main gate

Auto-migrate makes every merge to `main` a production change. The phasing assumes:
- Develop branch is `develop` (Render staging tracks develop per existing setup).
- Main is `main` (prod auto-migrates from this).
- The 48-hour observation window between staging and prod for phase 2, and 24 hours for subsequent batches, is a hard requirement — not a guideline. Skipping it means we're using prod as the verification environment.

---

## §5. Proof-of-enforcement test — extending the cross-org isolation harness

The existing harness (`test/isolation/crossOrgIsolation.test.ts`, driven by `test/isolation/testDb.ts`) proves *app-layer* isolation: it sends HTTP requests with org-A's key and asserts 404 on org-B's resources. That proves the WHERE clauses exist and work today. It does *not* prove the DB will deny the row if the WHERE clause is removed.

The new test surface needed for A04-G1 lives alongside it but is structurally different — it bypasses the HTTP layer and the app's WHERE clauses to talk to Postgres directly *as the enforced role*.

### Test 1 — RLS denies cross-org SELECT without app-layer WHERE

For each table in bucket 1:

1. Seed org A and org B via the existing `bootstrapTestDb()` (each gets one resource, e.g. one `finding`).
2. Open a new `pg.Pool` connection that connects **as the enforced role** (A1: the new `securelogic_app` role; A2: the owner role — and explicitly verify `row_security = on` for the session).
3. Set `app.current_org_id` to org A's id via `set_config` (or open a transaction and `SET LOCAL` if Decision B is B1).
4. Issue a raw `SELECT * FROM findings WHERE id = $1` with org B's finding id. **Assert zero rows returned.**
5. Issue a raw `SELECT * FROM findings` (no predicate at all). **Assert only org A's rows returned.**
6. Reset GUC, repeat with `app.current_org_id` set to org B's id. Assert symmetric result.
7. Unset GUC entirely (`RESET app.current_org_id` / set to NULL). Issue `SELECT * FROM findings`. **Assert zero rows returned** (no GUC ⇒ no rows ⇒ failure mode is closed).

This is the **single most important test in the package.** It is the only test that distinguishes "RLS is enabled" from "RLS is enabled and actually applies to the connecting role."

### Test 2 — RLS denies cross-org INSERT/UPDATE/DELETE with wrong org

Same shape as Test 1 but for writes:

- INSERT with `organization_id = orgB.id` while GUC is set to orgA. Assert error (`new row violates row-level security policy`).
- UPDATE on orgB's row while GUC is set to orgA. Assert zero rows affected.
- DELETE on orgB's row while GUC is set to orgA. Assert zero rows affected.

### Test 3 — Hybrid table behavior (phase 3 batch F)

For `cyber_signals`:
- Seed three rows: one with `organization_id = NULL` (global), one for orgA, one for orgB.
- As app role with GUC = orgA: assert SELECT returns the global row + orgA's row, not orgB's.
- As app role with GUC = orgB: assert SELECT returns the global row + orgB's row, not orgA's.
- As elevated/bypass role: assert SELECT returns all three.

### Test 4 — Elevated path actually bypasses

A test that the elevated/admin connection — the one used by `cisaKevAdapter`, `authAnomaly`, etc. — really does see across orgs.

- Open the elevated connection.
- SELECT all rows from `findings`. Assert both orgA's and orgB's rows are returned (proves the elevated path works for legitimate cross-org operations).
- Mismatch case: if elevated path is misconfigured and goes through RLS, this test fails — protects against the inverse bug (a cross-org worker silently writes nothing).

### Test 5 — Helper-bypass detection (B2 only)

Specific to Decision B2 — the stale-GUC hazard:

- Check out a client via the tenant helper for orgA.
- Run a query, then release.
- Immediately check out another client *bypassing the helper* (raw `pool.connect()`).
- Issue a query. **Assert** that either (a) the GUC is reset (no rows for any tenant) or (b) the test fails loudly. The pool-checkout discipline must guarantee no GUC leakage.

### Wiring into CI

`test:isolation` already runs as the `cross-org-isolation` job. The new tests can go into the same vitest project (`vitest.isolation.config.ts`) under a new file `test/isolation/rlsEnforcement.test.ts`. The job continues to run on every PR. The schema rebuild in `testDb.ts` already applies every migration in `db/migrations/`, so it picks up RLS migrations automatically — no harness change needed beyond authoring the test file and adding a second pool that connects as the enforced role.

The one harness change required: `bootstrapTestDb` currently connects with the harness Postgres's superuser. Under A1, the test needs *two* connection contexts — owner (for setup) and app-role (for the enforcement assertions). A small extension to `testDb.ts` returns both.

---

## §6. What this plan deliberately does not include

- **App-layer code review for missing WHERE clauses.** R1 says discipline is the first line. This package strengthens the second line. PR #81/#83/#85's harness covers v1 customer-data routes (13/13); phase-2 expansion of E1-G1 (collection routes, JWT DELETEs, 3 deferred create-paths) is its own package and not blocked by RLS.
- **SQL-AST lint rule.** A01-G1 remediation lists this as a cheap stopgap. If A04-G1 ships, the lint rule becomes redundant for the cross-tenant case and is dropped from the roadmap.
- **Read replicas.** Out of scope; mentioned only as a Decision B1 consideration.
- **`pgaudit` or per-policy audit logging.** Postgres-side audit is separate from the app's audit log. Not in scope for A04-G1; revisit if a future package wants DB-layer policy-decision logging.
- **Schema-level vs table-level RLS.** Postgres supports row-level only at the table level. Schema-level "RLS" would be done via separate schemas per tenant — a much larger architectural change and explicitly out of scope here.

---

## §7. Open items requiring operator input

Listed once for convenience:

1. **Decision A** — A1 (non-owner role) vs A2 (`FORCE ROW LEVEL SECURITY`) vs hybrid.
2. **Decision B** — B1 (transaction + `SET LOCAL`) vs B2 (`set_config` per checkout).
3. **Phase 2 pilot table.** Plan proposes `findings`. Acceptable alternatives: `vendors`, `controls`, `risks` — all wide-touched and harness-covered.
4. **Observation window for phase 2.** Plan proposes 48 hours staging-to-prod. Operator may want longer.
5. **Bucket-3 tables.** Plan lists candidates; the classification matrix in phase 0 will be the authoritative list. Operator should review phase 0 output before phase 1 starts.

**HOLD — no implementation work begins until decisions 1 and 2 are made.**
