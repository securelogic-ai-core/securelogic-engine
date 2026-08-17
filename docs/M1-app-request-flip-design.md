# M-1 — `app_request` Privilege Separation: Activation Design

**Status:** DESIGN FOR OPERATOR APPROVAL — no implementation authorized, nothing in this
document has been executed.
**Package:** M-1 (the A04-G1 phase-3 `DATABASE_URL` flip), design-gated per the
2026-08-17 hardening assessment. Tracked as KNOWN_ISSUES **M-1** and issue **#695** (DS-2).
**Inherits:** `docs/A04-G1-rls-rollout-plan.md` (Decisions A1+B1, LOCKED 2026-05-24),
`docs/A04-G1-table-classification.md`, `TENANT_ISOLATION_STANDARD.md` §14 amendment.
**Out of scope, untouched by this package:** Stage 2 activation, E-2 Increment 4
(`erasure_agent` stays NOLOGIN — no credential is issued here), destructive TDG
activation, §12 Wave 1 armed state.
**Evidence date:** 2026-08-17, verified against develop @ `d2cc9835` and the live Render
environment (read-only env inspection; hostnames/usernames only).

---

## 1. Current DB privilege model (verified)

**Connections.** Eleven deployed services hold a `DATABASE_URL`; every one connects as
the Render-managed **database owner**:

| Environment | Owner login in use | Services |
|---|---|---|
| Production (`dpg-d6r4an7diees73c2522g`) | `securelogicdb_pszw_user` | engine, intelligence-worker, posture-worker, data-rights-worker, vendor-extraction-worker, **intelligence-api** |
| Staging (`dpg-d7n0pohj2pic738iidbg`) | `securelogicstagingdb_9w6v_user` — **except** intel-worker-staging, which uses `securelogic_staging_user` (same host + database, different login; provenance unknown → pre-flight item P-1) | engine, intelligence-worker, posture-worker, data-rights-worker, vendor-extraction-worker |
| Demo (`dpg-d7khqn3bc2fs73bbj960`) | demo DB owner | demo-engine |

`MIGRATION_DATABASE_URL` is **absent from every service** (verified via Render API
2026-08-17). Consequence: `pgElevated` (`src/api/infra/postgres.ts:69` —
`MIGRATION_DATABASE_URL ?? DATABASE_URL`) currently resolves to the *same owner
connection* as `pg`. The elevated/tenant split exists fully in code and is **inert in
deployment** — exactly the designed pre-flip state.

**Roles in the database.**

- **owner** — Render's default role. Table owner of everything; implicitly bypasses all
  RLS (`NOT FORCE` everywhere); demonstrated `CREATEROLE` capability (the role-creating
  migrations ran as it).
- **`app_request`** — created by `20260618_create_app_request_role.sql` (`LOGIN`,
  **no password yet**, `NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION`).
  4-tier grant matrix: Tier A full DML (70 tables at creation + later tables granted in
  their own migrations — 42 migrations carry `GRANT`s, the Option-Y discipline has
  held); Tier B SELECT+INSERT only on `audit_log`/`security_audit_log`; Tier C SELECT
  only (`organizations` + 4 shared-ref); Tier D **no grant** (`auth_anomaly_alerts`,
  `webhook_events_processed`, `worker_runs`, `schema_migrations`). Confirmed present in
  the **production** DB (`docs/validation/bl1-migration-lock-exposure.md:44`).
- **`erasure_agent`** — NOLOGIN, E-2. Untouched by M-1. Note the E-2 design's own words:
  the residual limitation it names ("owner can `ALTER TABLE … DISABLE TRIGGER`") **is
  closed by M-1, not by anything in E-2**.

**RLS state.** By migration-file census: RLS enabled on **~78 distinct tables**,
policies on **~73**; `FORCE ROW LEVEL SECURITY` used **nowhere** (twice explicitly
declined). All of it INERT today (owner connection + `NOT FORCE`). At least
`asset_product_identities` and `identity_systems` appear **enabled with no policy** —
which is deny-all for `app_request`, see §8-F2. The migration-file grep is not
authoritative (multi-line statements); the pre-flight SQL (§5 step 0) produces the
authoritative census from `pg_class`/`pg_policies`.

**Governing-doc staleness (surfaced per CLAUDE.md):** `BUILD_SEQUENCE.md:589` and
`TENANT_ISOLATION_STANDARD.md:122` both still say "~22 tables" with policies, and
`src/api/lib/dataClassification.ts` marks 50 tables `rlsStatus:"pending"` that the
migration log contradicts. Doc-sync rides this package (§12 of this doc).

**App-layer plumbing (complete, verified):**
`withTenant`/`asTenant`/`pgElevated`/`withElevated` are all built and wired (the γ wrap
track is marked complete). 53 of 144 route files use `asTenant`; `vendorPortal.ts` and
`vendorAssuranceDocuments.ts` use explicit `withTenant` (15 and 14 calls) with
documented opt-outs for streaming/redirect/long-LLM handlers; the `admin*.ts` triage is
**complete** (rollout plan §3). ~254 live `pgElevated` call sites across 74 files.
Zero `new Pool(` outside `infra/postgres.ts` in live code (14 in `scripts/` only).
No `SET ROLE` anywhere in live code — the flip is purely a credential repoint.

**One stale claim killed during this design:** `src/api/infra/db.ts` (runtime
`CREATE TABLE`) looked like a flip blocker; it is **better-sqlite3** dead code with zero
importers. Not a blocker. (Candidate for deletion in cleanup, not this package.)

---

## 2. Owner vs runtime identity — the target model

| Identity | Who connects | What it may do |
|---|---|---|
| **owner** (via `MIGRATION_DATABASE_URL`) | The migrate runner at engine boot; `pgElevated`/`withElevated` (cross-org: worker claim polls, ingestion, admin list-all, authAnomaly, webhook dispatch, signup org-INSERT); operator scripts | Everything, incl. DDL and RLS bypass. Reachable **only** through code paths that explicitly chose the elevated channel. |
| **`app_request`** (via `DATABASE_URL`) | Every ordinary request handler and per-org worker body | Granted DML only; RLS applies (NOBYPASSRLS, not owner); no DDL, no TRUNCATE (never granted), no role management, no `schema_migrations`, no audit UPDATE/DELETE. |
| **`erasure_agent`** | Nobody (NOLOGIN) | Unchanged. M-1 does not issue its credential. |

The boundary between the two live identities is **which pool a call site imports** —
`pg`/`withTenant` vs `pgElevated`/`withElevated` — a reviewable, greppable, already-
audited property, instead of today's boundary of *nothing*.

---

## 3. What ordinary app code can do today that it should not

Every route handler — and therefore any SQL injection or logic bug in any of 144 route
files — currently executes with these owner capabilities:

1. **Bypass every RLS policy.** 73 tables' policies are decoration. A single missed
   `WHERE organization_id` is a cross-tenant leak (risk-register R8, the 2026-05 audit's
   surviving High).
2. **`ALTER TABLE … DISABLE TRIGGER`** — defeats the WORM append-only guards on the
   nine WORM tables, `security_audit_log`, and `erasure_certificates`, then rewrites or
   deletes audit history. This is the *documented* residual limitation in
   `20261018_erasure_authorization.sql` and the promotion audit — both name M-1 as its
   closure.
3. **DDL and mass destruction** — `DROP TABLE`, `ALTER TABLE`, `TRUNCATE` on any table.
4. **Role management** — the owner demonstrably holds `CREATEROLE` (it created
   `app_request` and `erasure_agent`). Injected SQL today can
   `ALTER ROLE erasure_agent LOGIN PASSWORD '…'` — **minting the erasure credential
   that E-2 Increment 4 deliberately keeps uncreated** — or create fresh login roles as
   persistence.
5. **Forge migration bookkeeping** — write `schema_migrations` (Tier D for a reason).
6. **GRANT/REVOKE** on any owned object.

Post-flip, `app_request` can do none of these: not owner (no DDL/trigger-disable/grant
on owner-owned objects), `NOCREATEROLE`, no TRUNCATE grant, Tier B/D withheld, RLS
enforced. An injected statement's blast radius shrinks to: granted DML, inside the
current transaction's `app.current_org_id`, on policied tables — and the audit trail of
doing it survives, because the WORM triggers can no longer be disabled by the same
connection that is being abused.

---

## 4. Migration/runtime split

Already coded; activation is configuration:

- `scripts/runMigrations.ts:16` — `MIGRATION_DATABASE_URL ?? DATABASE_URL`.
- `src/api/infra/postgres.ts:69` — `pgElevated` uses the identical rule.
- Engine `startCommand` is `npm run migrate && npm start`: **set
  `MIGRATION_DATABASE_URL` (owner DSN) on the engine before flipping `DATABASE_URL`**,
  and boot-time migration keeps owner DDL rights while the runtime pool drops to
  `app_request`. Workers never migrate; they need `MIGRATION_DATABASE_URL` only for
  their `pgElevated` claim polls / cross-org reads.
- **Option-Y enforcement becomes mandatory:** the "phase 4" CI assertion that every
  live table carries the expected `app_request` grants is **in scope for M-1**
  (deliverable C-3, §6) — post-flip, a missed grant is a production outage
  (fail-closed 42501), so it must be caught at PR time, not deploy time.

---

## 5. `app_request` activation model (per environment: staging → prod → demo)

All steps are operator-executed or operator-authorized; Render injects env **at deploy**
(proven twice) — every env change below is followed by a same-SHA redeploy.

**Step 0 — Pre-flight SQL (read-only, psql per environment).** One script, versioned as
`scripts/validation/m1-preflight.sql`, producing a PASS/FAIL report:
- **P-1** Resolve the staging two-role drift: what is `securelogic_staging_user`
  (owner-membership? BYPASSRLS? object ownership?). If it is effectively a second owner,
  intel-worker-staging's flip entry changes; if it's a forgotten legacy login, retire it.
- **P-2** D-13 grant verification (the PART_B_PREFLIGHT §1.3 query, extended): for every
  live table, diff actual `app_request` grants against the expected tier. Known suspect:
  the reshaped `20260719` migration may have skipped grants on
  `enterprise_entities`/`enterprise_data_stores` on staging.
- **P-3** Authoritative RLS census from `pg_class.relrowsecurity` × `pg_policies`:
  the **enabled-with-no-policy set must be empty** before flip (grep candidates:
  `asset_product_identities`, `identity_systems`). Fix = policy migration or
  `DISABLE ROW LEVEL SECURITY` with rationale, decided per table at design review of
  deliverable C-1.
- **P-4** Confirm owner attributes (`rolcreaterole` etc.) and that `app_request` has no
  password set yet / no open sessions.

**Step 1 — Credential issuance.** `ALTER USER app_request PASSWORD '…'` per
environment (distinct passwords), recorded in the P0-2 sealed-secrets inventory. This
is a new secret with rotation obligations — same lifecycle class as the owner DSN.

**Step 2 — Owner channel first (inert).** Add `MIGRATION_DATABASE_URL` = current owner
DSN (external hostname per P0-1) to every flip-set service; redeploy. Behaviour is
byte-identical (both pools same target) — zero-risk rehearsal of the env mechanics.

**Step 3 — The flip (per environment, one service at a time).** Repoint `DATABASE_URL`
to `postgres://app_request:…@<external-host>/<db>`; redeploy; run the §11 proof battery
between services. Engine first (loudest failure surface, health-checked), then workers
(watch **runtime tick logs, not deploy status** — the P0-1 lesson: workers fail
live-but-broken).

**Rollback at any point** = repoint `DATABASE_URL` back to the owner DSN + redeploy
(§9).

**Flip-set (updated from rollout-plan §4a, verified against live Render 2026-08-17):**
engine, intelligence-worker, posture-worker, data-rights-worker,
vendor-extraction-worker — *plus two the plan predates*:
- **`securelogic-intelligence-api`** — prod web service holding the prod owner DSN,
  **absent from `render.yaml`** (the §4a dashboard-drift caveat realized). Must be
  classified before the prod flip: what code does it run, does it belong in the flip
  set, in `render.yaml`, or in decommissioning? → **Open decision D-2.**
- **`securelogic-demo-engine`** — runs `main`, migrations already created
  `app_request` on the demo DB. Recommend flipping demo in the prod wave (same code,
  cheap rehearsal of prod mechanics); explicitly deciding "demo stays owner forever"
  is the alternative. → **Open decision D-3.**

---

## 6. Route/worker coverage impact

**The impact rule.** Under `app_request`, a query outside any tenant scope runs on the
raw pool with `app.current_org_id` unset. On a **policied** table the policy predicate
evaluates NULL → **zero rows / blocked writes, silently**. On an unpolicied-but-granted
table, behaviour is unchanged. So the flip's blast radius is exactly:
*(call sites outside tenant scope) × (the ~73 policied tables)*.

**Current coverage:** 53/144 route files `asTenant`-wrapped; vendorPortal +
vendorAssuranceDocuments explicitly `withTenant`-wrapped (their streaming/redirect/LLM
opt-outs are the model for handlers the wrap cannot hold); admin surface triage
complete; auth path (`requireApiKey`/`attachOrganizationContext` →
`api_keys`/`users`/`organizations`) is **safe today because none of those tables carry
RLS** — verified — and this becomes a hard constraint on any future policy batch that
touches them (the key lookup runs before any org context exists).

**77 route files query without `asTenant`.** Census names the heavy ones: teamInvites
(19 queries, no wrap and no elevated), cyberSignals (16), executiveReport (15), mfa
(14), policies (13), requirements (12), intelligenceBriefs (12), webhooks (11),
customerApiKeys (7), gapReport, auditPackage, frameworkReadiness, obligationMappings,
riskScale, dataExports, auditLog, alertPreferences, orgSettings. Which of these
actually intersect a policied table is not hand-auditable at 77 files — so:

**Deliverable C-1 — the coverage matrix (mechanical, pre-flip):** a script that emits,
per route file and worker core: tables referenced × RLS/policy state (from the P-3
census) × wrap status (asTenant / withTenant / pgElevated / bare). Every *bare ×
policied* intersection gets one of: wrap, explicit `withTenant`, or a justified
`pgElevated`. The matrix is re-run in CI so it cannot rot (subsumes the phase-1
warn-only coverage check and promotes it, per plan phase 4).

**Deliverable C-2 — loud-not-silent instrumentation:** a flag-gated strict mode
(`SECURELOGIC_DB_ROLE=app_request` set alongside the flip): when `pg.query` executes on
the raw-pool fallback outside any tenant scope, log a sampled, structured warning
(`db_query_outside_tenant_scope`, with route/caller). The staging soak reads this
signal to find missed wraps *empirically* — converting the worst failure class (silent
empty) into a visible one before prod. Removal after the prod soak.

**Deliverable C-3 — Option-Y grant assertion in CI** (§4).

**Workers:** data-rights and vendor-extraction are flip-correct by construction
(elevated claim poll + `withTenant` job bodies). Posture-worker now wraps its per-org
body (the §4a phase-1 gap is closed in code — the flip verification re-proves it on
staging). The intelligence worker is **`pgElevated`-only (~29 sites)**: at the flip it
simply keeps the owner channel via `MIGRATION_DATABASE_URL` — unchanged behaviour,
accepted by the plan (global-signal writer; per-org containment is proven by
`r5PipelineIsolation.test.ts`, and its per-org *consumption* paths run in the engine,
not the worker).

---

## 7. RLS implications

- The flip is the moment ~73 tables' policies become **live for the runtime identity**
  while remaining bypassed for the elevated channel — precisely Decision A1's shape.
  `NOT FORCE` stays: owner-channel bypass is the designed escape, not a hole.
- Enabled-without-policy tables are **deny-all** under `app_request` and must be
  resolved pre-flip (P-3).
- Hybrid tables (`cyber_signals` etc., `org IS NULL OR org = GUC` shape): tenant reads
  through `withTenant` see global + own rows; ingestion keeps writing NULL-org rows on
  the elevated channel. No change at flip beyond enforcement.
- The ~50 unpolicied tables (incl. `vendors`, `controls`, `obligations`, `ai_systems`,
  the vendor_assurance suite, and the entire auth path) continue on grants + route
  discipline. **M-1 does not require completing them** (see §10 sequencing rationale),
  but every post-flip policy batch lands *enforced from day one*, so each batch's
  staging gate becomes a true test — and any batch touching `api_keys`/`users`/
  `organizations` must first re-design the pre-org-context auth path (elevated lookup
  or a permissive key-lookup policy).
- `withTenant` sets the GUC transaction-locally (`set_config(..., true)`) — the B1
  correct-by-construction property is unchanged; the flip adds the enforcement layer
  under it.

---

## 8. Failure modes

| # | Failure | Behaviour | Detection | Mitigation |
|---|---|---|---|---|
| F1 | Missing grant on a table (Option-Y miss, D-13) | **Fail closed, loud**: 42501 `permission denied` → 500s | Pre-flight P-2; C-3 CI assertion; staging soak | Grant migration; rollback if prod |
| F2 | RLS enabled, no policy | **Deny-all** on that table (silent empties on read, blocked writes) | Pre-flight P-3 | Policy or disable, pre-flip |
| F3 | Missed wrap on a policied table | **Silent zero rows** — the worst class (generalized posture-worker §4a mode) | C-1 matrix (static) + C-2 strict-mode logs (empirical) + product walkthrough on staging | Wrap before flip; the two together bound the residual |
| F4 | Cross-org path left on `pg` instead of `pgElevated` | Zero rows for other orgs' data | Same as F3; the ~254 elevated sites are already the audited inventory | — |
| F5 | `MIGRATION_DATABASE_URL` forgotten on the engine | Boot migrate runs as `app_request` → DDL denied → **deploy fails safe**, old build stays live (P0-1-identical failure shape) | Deploy status | Step-2-before-Step-3 ordering makes this impossible if followed |
| F6 | `MIGRATION_DATABASE_URL` forgotten on a worker | Claim poll / cross-org reads return zero rows or 42501 (`jobs` etc. policied/Tier-mixed) → **worker live-but-broken** | Runtime tick logs (`*_worker_tick_error` or silent-idle anomaly) | Same ordering; per-worker log check in §11 battery |
| F7 | Bad `app_request` password | Engine: boot fail (safe). Workers: live-but-broken | Deploy status / tick logs | Rollback env flip |
| F8 | Env change without redeploy | Config-true / process-false split-brain | Known trap; every step redeploys | — |
| F9 | Dashboard-only service missed (the intelligence-api precedent) | Service silently keeps owner → RLS bypassed for its surface | Live service-list reconcile is part of Step 0 | D-2 |
| F10 | Password rotation of owner DSN later forgets `MIGRATION_DATABASE_URL` | pgElevated breaks while `/health` stays green (exactly the 2026-08-11 rotation trap) | Add both DSNs to the rotation runbook | Doc change in this package |

---

## 9. Rollback

Repoint `DATABASE_URL` back to the owner DSN on the affected service + redeploy. No
code revert, no migration, no schema change; policies return to inert automatically
(owner + `NOT FORCE`). **Partial rollback is safe**: services are independent
connections, and a rolled-back service merely loses the RLS backstop (returns to
today's discipline-only state) — it does not corrupt anything for the still-flipped
services. `app_request`'s password stays set (inert while unused); rotate it only on
suspicion of exposure. `MIGRATION_DATABASE_URL` can stay in place permanently — it is
behaviour-neutral pre-flip and required post-flip.

---

## 10. Production sequencing

**Pre-flip engineering (rides the normal release train, ordinary PR gates):**
1. C-1 coverage matrix script + the wrap/elevate closures it demands (batched PRs —
   size unknown until the matrix runs; the 77-file list bounds it).
2. C-2 strict-mode instrumentation.
3. C-3 Option-Y CI assertion.
4. P-3 fixes (enabled-no-policy tables) as one migration.
5. Doc-sync (§12).

**Then the staging flip (env-only, no train):** Step 0 → 1 → 2 → 3 on staging; §11
battery; **48-hour soak** (plan §4 gate) watching strict-mode logs, error rates, and a
full product walkthrough on the walkthrough org. Exit = zero unexplained
`db_query_outside_tenant_scope` warnings on customer paths, zero 42501s, battery green.

**Then production:** same steps, one service at a time, engine first, workers verified
by runtime logs; demo rides the prod wave (pending D-3). Prod soak 7 days before the
package closes; then promote the coverage check to required CI and flip
KNOWN_ISSUES M-1 + R8 to closed.

**Deliberately not blocked on:** completing RLS policies for the ~50 unpolicied tables.
Rationale: the privilege-separation value (§3 — DDL, trigger-disable, role-minting,
audit-rewrite all become unreachable) is delivered by the flip alone and is independent
of per-table policy coverage; policy batches continue post-flip on the existing batch
cadence, each now landing enforced-from-day-one. Issue #695's precondition list was
written at ~22 policied tables; at ~73 the calculus favors flipping once C-1/C-2/P-2/P-3
close rather than serializing 50 more table batches in front of the security win.
**This is a deviation from #695's letter and needs explicit operator ratification** →
**Open decision D-1.**

**Untouched, restated:** no `erasure_agent` credential, no Stage-2 or TDG flag changes,
no §12 Wave-1 interaction — the only env keys this package touches are
`DATABASE_URL` / `MIGRATION_DATABASE_URL` / (new) `SECURELOGIC_DB_ROLE`.

---

## 11. Proof battery — runtime cannot exercise owner capability; owner channels still work

Versioned as `scripts/validation/m1-proof.ts` (read-only + self-reverting probes), run
per environment at each flip, plus the existing CI assets.

**A. The deployed identity is really the non-owner role** (the check that
distinguishes "flip performed" from "flip assured"):
via a one-off psql as `app_request` and via the engine (temporary diagnostic or log
line): `SELECT current_user, session_user;` → `app_request`;
`SELECT rolbypassrls, rolcreaterole, rolsuper FROM pg_roles WHERE rolname = current_user;`
→ all false.

**B. Owner capabilities are refused** (each must FAIL as `app_request`):
`CREATE TABLE`, `DROP TABLE`, `ALTER TABLE findings DISABLE TRIGGER …`, `TRUNCATE
findings`, `CREATE ROLE x`, `ALTER ROLE erasure_agent LOGIN`, `GRANT … TO x`,
`INSERT INTO schema_migrations …`, `UPDATE/DELETE audit_log` / `security_audit_log`,
`SET ROLE erasure_agent` (not a member), any WORM-table DELETE even with erasure GUCs
set (`session_user` gate). Every probe asserts the *specific* error class (42501 /
must-be-owner / trigger RAISE) so a probe passing for the wrong reason fails the run.

**C. RLS enforces for the runtime identity** (live-DB versions of harness Tests 1–2 on
a seeded probe org): unscoped `SELECT` on `findings` returns only the GUC org's rows;
GUC unset → zero rows; cross-org INSERT/UPDATE/DELETE refused. The 27 per-table
`test/isolation/*Rls.test.ts` files already prove policy correctness in CI via
`SET ROLE`; the battery proves the **deployed credential** gets the same treatment.

**D. Migrations and admin/elevated operations still work** (each must SUCCEED):
- Engine deploy applies a no-op marker migration and boots (`Migrations complete` +
  boot self-test + `/health db:connected`) — proves the owner migrate channel.
- Each worker's claim poll returns work / ticks clean in runtime logs — proves
  `pgElevated` per worker (F6 check).
- One admin list-all route (`GET /admin/ops/health` or `/admin/organizations`) returns
  cross-org data — proves the elevated read path.
- authAnomaly scan and webhook dispatch log normal completion.
- Signup path creates an org (elevated org-INSERT) on staging.

**E. Regression floor:** full cross-org isolation harness + product walkthrough on
staging (walkthrough org), unchanged pass required.

---

## 12. Documentation updates riding this package

- `TENANT_ISOLATION_STANDARD.md` §14: "~22" → actual census; on flip completion, RLS
  moves from "inert defense-in-depth" to live second line; R8 closes.
- `BUILD_SEQUENCE.md:589`: same census correction; A04-G1 status advances.
- `KNOWN_ISSUES.md` M-1: closes at prod soak exit.
- `dataClassification.ts` `rlsStatus` reconciled to the P-3 census (it is code, so this
  is a PR not a doc edit).
- `render.yaml`: `MIGRATION_DATABASE_URL` declared (`sync: false`) on flip-set services;
  the line-1204 comment finally comes true; intelligence-api resolved per D-2.
- Credential-rotation runbook: owner rotation now touches TWO env keys per service (F10).
- Issue #695: updated with D-1 ratification outcome.
- `docs/A04-G1-rls-rollout-plan.md` §4a: flip-set table updated (+vendor-extraction,
  +intelligence-api disposition, +demo-engine disposition, delivery-worker note:
  no such Render service exists as of 2026-08-17 — dead-runner classification stands).

---

## Open decisions for the operator (blocking, in order)

- **D-1 — Ratify the sequencing deviation:** flip after C-1/C-2/C-3 + P-2/P-3 close,
  *without* first completing policies on the ~50 unpolicied tables (deviates from issue
  #695's letter; rationale in §10). Alternative: hold the flip behind full Tier-A
  policy completion (adds an estimated many-batch tail in front of the §3 wins).
- **D-2 — Classify `securelogic-intelligence-api`:** flip-set member + add to
  `render.yaml`, or decommission. It holds a prod owner DSN today and is invisible to
  IaC.
- **D-3 — Demo scope:** flip demo-engine with the prod wave (recommended) or record
  demo as permanently owner/inert-RLS.
- **D-4 — Staging `securelogic_staging_user`:** investigate-and-retire vs adopt;
  resolved by pre-flight P-1 evidence.

**No implementation begins until D-1..D-4 are decided and this design is approved.**

---

# Addendum — 2026-08-17 operator rulings and authoritative census results

**Rulings:** D-1 APPROVED (flip not blocked on full policy coverage; authoritative
census mandatory; any enabled-no-policy table on a runtime path is a stop condition for
that path). D-2 classify-before-activation. D-3 demo EXCLUDED from the primary wave —
separate follow-on activation after demo DB reconciliation. D-4 investigate-first,
preserve until evidence. 48-hour soak approved with runtime-behavior acceptance.
`m1-proof.ts` must prove both sides of the boundary. Doc-sync is in the bounded package.

The census below was executed 2026-08-17 with **read-only** catalog queries against the
live staging and production databases (owner-channel psql; SELECTs only; production not
modified).

## A. P-3 authoritative RLS census — stop condition CLEAR

Staging and production are structurally identical: **142 tables, 78 RLS-enabled,
0 FORCE, and ZERO tables enabled-without-policy.** The §8-F2 grep candidates
(`asset_product_identities`, `identity_systems`) each carry **1 policy + full Tier-A
grants** in both environments — the migration-file grep missed multi-line statements;
the live catalogs are clean. No D-1 stop condition exists.

## B. P-2 grant verification — FAILS with an identical 21-table gap in BOTH envs

The original D-13 suspects (`enterprise_entities`, `enterprise_data_stores`) are
**clean** (policy + full grants). The real Option-Y breakage is elsewhere: 21 tables
have **zero `app_request` grants**, byte-identical between staging and prod. Four are
intentional Tier-D (`auth_anomaly_alerts`, `webhook_events_processed`, `worker_runs`,
`schema_migrations`). The other **17 are the M-1 blocker B-1**:

`asset_assessments`* · `canonical_product_external_ids` · `canonical_product_versions`
· `canonical_products` · `email_provider_events` · `evidence_analysis`* · `feed_health`
· `intelligence_brief_item_provenance`* · `intelligence_event_sources` ·
`intelligence_event_timeline` · `intelligence_event_workflow_triggers` ·
`intelligence_events` · `legal_consents` · `risk_approvals`* · `risk_lifecycle_events`*
· `sources` · `sso_login_codes`*   (\* = also RLS-enabled)

Consumer mapping confirms most are on ordinary runtime paths (`assetAssessments.ts`,
`vendorPortal.ts`/`vendorEngagements.ts`/`vendorEvidenceAnalysisWorker.ts`,
`intelligenceBriefs.ts`, `findings.ts`, `riskApprovals.ts`/`riskLifecycle.ts`,
`executiveReport.ts`, `customerAuth.ts`/`legalConsent.ts`) — post-flip these would
fail **42501 permission denied** (loud, fail-closed) without remediation. Fix =
one catch-up grant migration (M1-G1) with per-table tiers assigned by the C-1
matrix, plus the C-3 CI assertion so the gap class cannot recur.

## C. D-2 — `securelogic-intelligence-api` is OBSOLETE; decommission proposed

Evidence: service **suspended**, autoDeploy off; last three deploys ALL
`update_failed`, most recent attempt 2026-05-02 (it has not run new code in >3
months); its `startCommand` entrypoint
(`services/intelligence-worker/src/api/server.js`) **no longer exists on `main`**;
zero references in `render.yaml` or any live code. **Risk while it exists:** its env
store holds the **current live** prod owner `DATABASE_URL` (verified equal to the
engine's), plus `SECURELOGIC_ADMIN_KEY`, `SECURELOGIC_SIGNING_SECRET`,
`RESEND_API_KEY`, `REDIS_URL`. **Proposal (operator-executed, destructive):** delete
the service, which destroys the stored copies; the shared owner DSN itself cannot be
revoked independently and remains legitimately in use (`MIGRATION_DATABASE_URL`), so
deletion is the complete remedy unless exposure of the store is suspected (then rotate
per the 2026-08-11 runbook). It is NOT a flip-set member. No undocumented owner-DSN
exception survives.

## D. D-4 — `securelogic_staging_user` provenance RESOLVED; no role surgery

The assumed model was inverted. On **both** databases Render's native pattern is an
**owner role + a login member**:

| | Owner (all 142 tables, CREATEROLE) | Login member services use |
|---|---|---|
| Prod | `securelogic_user` — **NOLOGIN** | `securelogicdb_pszw_user` (member of owner) |
| Staging | `securelogic_staging_user` — **LOGIN** | `securelogicstagingdb_9w6v_user` (member of owner) |

So `securelogic_staging_user` is not a stray second role — it IS the staging owner
(Render-managed; the Render connection-info endpoint hands out its DSN). The genuine
anomaly is narrower: **intel-worker-staging connects as the owner directly** instead of
the login member. Disposition: **preserve the role** (it cannot be retired — it owns
everything); during that service's flip step, its `MIGRATION_DATABASE_URL` gets the
standard login-member DSN, ending direct-owner login by any service. Optional later
hardening (out of M-1 scope, Render-managed): staging owner LOGIN→NOLOGIN parity with
prod. Also noted on both envs: the owner is a member of `app_request` and
`erasure_agent` — this enables `SET ROLE` for admin/testing and does **not** weaken the
erasure guard (`session_user` gate, verified in E-2). No `app_request` sessions
observed; live sessions are exclusively the login member (6) + Render's `postgres` (2)
on staging.

## E. Consequence for §5 activation

`MIGRATION_DATABASE_URL` per service = **today's `DATABASE_URL` value** (the
owner-equivalent login member) — no new owner credential is created anywhere; prod's
true owner stays NOLOGIN. The only new secret M-1 introduces is the `app_request`
password per environment. Flip-set final: engine, intelligence-worker, posture-worker,
data-rights-worker, vendor-extraction-worker (5 services × staging/prod waves); demo
follow-on per D-3; intelligence-api decommissioned per D-2.
