# A04-G1 — Phase-3 Batch A RLS policy enablement — DESIGN PASS

**Status:** Design pass only. No migration authored, no SQL committed, no source touched. Same discipline as the γ.0–γ.3 design passes.
**Author context:** produced after the γ wrap track completed (γ.0+γ.1+γ.2+γ.3 on main, prod-verified). This doc is the gate; implementation is a separate authorization.
**Governing inputs:** `A04-G1-rls-rollout-plan.md` §4 (phase-3 batch order), `A04-G1-policy-templates.md` (§A/§D), `A04-G1-table-classification.md` §2, `20260619_findings_rls_pilot.sql` (canonical pilot), memory `project_a04_g1_pr7_flip_reconcile`.

---

## ⛔ HEADLINE FINDING — Batch A is NOT a clean "policies on the γ-wrapped tables" PR. SCOPE DECISION REQUIRED BEFORE IMPLEMENTATION.

The task framing was: *"add the enforced RLS policy to the tables wrapped in γ.1/γ.2/γ.3."* The audit shows that set and the rollout plan's **Batch A** are **not the same set**, and the plan's Batch A is not flip-ready. Three independent facts, all empirically verified:

1. **Rollout plan Batch A = 10 tables, not 4.** Verbatim, `A04-G1-rls-rollout-plan.md:297`:
   > "Batch A — read-heavy customer-data tables with non-null org column (`vendors`, `controls`, `risks`, `assessments`, `policies`, `evidence`, `actions`, `reports`, `posture_snapshots`, `users`)."

2. **The γ wrap track wrapped only 3 of those 10 table families.** Confirmed by `grep -rl asTenant src/api/routes/` → exactly four route files carry `asTenant`: `findings.ts`, `posture.ts`, `risks.ts`, `vendorAssessments.ts`. Mapping to Batch-A tables:
   - `risks` — wrapped (γ.1, `risks.ts`). ✅
   - `posture_snapshots` — wrapped (γ.2, `posture.ts`). ✅
   - `vendors` — the **table** is written by γ.3's wrapped `vendorAssessments.ts` POST (the risk-score recompute), but the **`vendors.ts` CRUD route is UNWRAPPED** (`grep -c asTenant src/api/routes/vendors.ts` = 0). ⚠️ partial.
   - `controls`, `assessments`, `policies`, `evidence`, `actions` — **UNWRAPPED** (each route file: `asTenant` count 0).
   - `reports` — no `reports.ts` route; the table is written by `assess.ts`. **UNWRAPPED.**
   - `users` — no `users.ts` CRUD route; the table is read/written by the **pre-context auth path** (`requireApiKey.ts`, `requireAuth.ts`, `customerAuth.ts`, `teamInvites.ts`, `sso.ts`, `mfa.ts`) which runs **before** the org GUC is set. **Special — see §2/§4.**

3. **The project's own sequencing rule says policy batches are gated on the wrap.** Memory `project_a04_g1_pr7_flip_reconcile` (authoritative A04-G1 state): *"Phase-2 sweep batches A–G still not started — gated on the wrap being applied to those routes' families first (γ–ζ)."* δ–ζ have **not** wrapped controls/assessments/policies/evidence/actions/reports/vendors-CRUD/users. So enabling Batch-A policies on the plan's 10-table definition now is **out of sequence by the project's own gate.**

**Plus a memory correction:** the task's stated expectation (per memory) was Batch A = `risks, posture_snapshots, domain_scores, vendors`. That is wrong on two counts:
- `domain_scores` is **not** in Batch A. Classification §2 (`20260410_platform_primitives.sql:121`) → `domain_scores` is **INDIRECT** (FK `posture_snapshot_id → posture_snapshots.organization_id`, no own org column). The plan assigns it to **Batch G** (`rollout-plan:303`). It needs the §D subquery template, not the §A standard template.
- The four-table mental model omits the 6 other tables the plan's Batch A actually names.

### What this means

- **Landing policies is still SAFE today** (inert pre-flip — the engine connects as owner, which bypasses RLS under A1; identical to the findings pilot). So nothing *breaks* on landing regardless of which set we pick.
- **But "flip-ready" is the actual goal of this work**, and the plan's 10-table Batch A is **not** flip-ready: 7 of its 10 families have routes that set no GUC. Post-flip those routes would `SET ROLE app_request`, fail the policy's `NULLIF(...) IS NULL` check, and return **zero rows** — silent data-disappearance, the exact failure mode RLS is meant to prevent, reintroduced by enabling the policy ahead of the wrap.

### The decision (Phase 7, restated up front because it gates everything)

**Which "Batch A" do we implement?**
- **Option A — γ-aligned subset (flip-ready today):** policies on `risks`, `posture_snapshots`, `vendors` only — the tables whose write paths are already wrapped. Smallest correct step; every table shipped is genuinely flip-ready. Optionally add `domain_scores` (wrapped via `posture.ts`, but needs §D INDIRECT template + is labeled Batch G — a scope-creep flag, not a free add).
- **Option B — plan's full 10-table Batch A:** requires δ-class route wraps on controls/assessments/policies/evidence/actions/vendors-CRUD/assess(reports) **and** the `users` auth-path elevated-channel work **first**. That is a multi-PR wrap workstream, not a policy PR. Per the project's own gate, this is the sequenced path but it is **not** the next single PR.
- **Option C — re-scope the plan:** formally redefine Batch A in `rollout-plan` to the γ-aligned subset and renumber the remaining tables into later batches keyed to δ–ζ wrap completion.

**I did not pick one. This is the operator decision the design pass exists to surface.** Everything below is the supporting audit, written so it holds regardless of which option is chosen.

---

## §1. Scope confirmation (Phase 1)

### Rollout plan Batch A — exact list, ordering, gating

- **Table list (10):** `vendors, controls, risks, assessments, policies, evidence, actions, reports, posture_snapshots, users` (`rollout-plan:297`, quoted above).
- **Ordering position:** Batch A is the **first** of seven phase-3 batches (A–G, `rollout-plan:296-303`). Batch A runs only **"After phase 2 main-merge has cooked in prod for 7 days with no incident"** (`rollout-plan:294`). Phase-2 = the `findings` pilot (`20260619_findings_rls_pilot.sql`), on main, **inert pre-flip** — so the "7-day prod cook" is a cook of an inert no-op (see §5: the cook does not test RLS while the engine is owner-cred).
- **Per-batch gating:** each phase-3 batch "has its own staging gate (steps 1–4 [of phase 2]; the 48-hour observation window can shrink to 24 hours after phase 2 confidence)" (`rollout-plan:294`).
- **Batch A is "subject to phase 0 classification matrix"** (`rollout-plan:296`) — i.e. the plan explicitly defers the final list to the classification doc, which I reconcile in §2.

### Pending Batch-A-specific follow-ups already tracked (from `pr7_flip_reconcile`)

- *"Phase-2 sweep batches A–G still not started — gated on the wrap being applied to those routes' families first (γ–ζ)."* — the gate that makes this a scope decision (headline #3).
- The `admin*.ts` RLS-channel triage is **COMPLETE** (7.a–7.e on main) — not a Batch-A blocker.
- `organizations` (ROOT-TENANT, §C) is **not** in Batch A and is explicitly gated on converting `adminOrganizations.ts:99` to `withTenant(id)` first (policy-templates §C ⚠) — out of scope here, noted so it is not conflated.

### Canonical policy reference (Phase 1)

`db/migrations/20260619_findings_rls_pilot.sql` — the exact, load-bearing form every Batch-A CUSTOMER-DATA table copies (policy-templates §A):

```sql
ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS <table>_tenant_isolation ON <table>;
CREATE POLICY <table>_tenant_isolation ON <table>
  USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
```

Load-bearing details (all from the pilot + policy-templates §I): **no `FORCE`** (owner/elevated must keep bypassing — A1); **single `FOR ALL` policy** (USING filters reads + old-row on UPDATE/DELETE, WITH CHECK constrains the new-row image); **`NULLIF(…, '')`** collapses both the never-set GUC (`NULL`) and the pooled-reset GUC (`''`) to `NULL` → `org = NULL` → zero rows (fail-closed, no 22P02 500); **`DROP POLICY IF EXISTS`** makes the non-idempotent `CREATE POLICY` re-appliable.

---

## §2. Per-table audit grid (Phase 2)

All 10 plan-Batch-A tables are CUSTOMER-DATA `organization_id NOT NULL` (classification §2) → §A template. Wrap/worker status is the differentiator.

| Table | Bucket / template | Route family | Wrapped today? | By which PR | Background-job writers (channel) | Cross-org FK / trigger / view |
|---|---|---|---|---|---|---|
| `risks` | CUSTOMER-DATA / §A | `risks.ts` (8 routes) | ✅ yes | γ.1 (#152/#153) | none repo-wide write `risks` outside routes | none (no triggers/views in `db/migrations/`, classification §4 caveat 2) |
| `posture_snapshots` | CUSTOMER-DATA / §A | `posture.ts` (4 routes) | ✅ yes | γ.2 (#154/#155) | `postureSnapshot.ts:260` (per-org, via `withTenant` in posture-worker + `asTenant` in route); `cyberSignalProcessingService.ts:879` (**`pgElevated`** — owner, cross-org-capable, SAFE) | `domain_scores` is its INDIRECT child (Batch G, not here) |
| `vendors` | CUSTOMER-DATA / §A | `vendors.ts` CRUD (**UNWRAPPED**, 0 `asTenant`) + written by γ.3-wrapped `vendorAssessments.ts` recompute + `templateLoader.ts:180` (per-org, via `withTenant`) | ⚠️ **partial** — table written by a wrapped path, but the `vendors.ts` CRUD route is unwrapped | γ.3 (#156/#157) wraps only the recompute writer; CRUD deferred to δ/CRUD-sweep | `templateLoader.ts:170` `withTenant` (SAFE); recompute (SAFE, own `withTenant`) | none |
| `controls` | CUSTOMER-DATA / §A | `controls.ts` (**UNWRAPPED**, 0) | ❌ no | — | `templateLoader.ts:293` (per-org, via `withTenant`, SAFE) | `control_mappings`, `policy_control_links` are INDIRECT children (later batches) |
| `assessments` | CUSTOMER-DATA / §A | `assessments.ts` (**UNWRAPPED**, 0) | ❌ no | — | `assess.ts` route (unwrapped) | none |
| `policies` | CUSTOMER-DATA / §A | `policies.ts` (**UNWRAPPED**, 0) | ❌ no | — | none found outside routes | `policy_control_links` INDIRECT child |
| `evidence` | CUSTOMER-DATA / §A | `evidence.ts` (**UNWRAPPED**, 0) | ❌ no | — | none found outside routes | none |
| `actions` | CUSTOMER-DATA / §A | `actions.ts` (**UNWRAPPED**, 0) | ❌ no | — | none found outside routes | none |
| `reports` | CUSTOMER-DATA / §A | no `reports.ts`; written by `assess.ts` (**UNWRAPPED**) | ❌ no | — | `assess.ts` (unwrapped). NB: dead `assessSignal.ts` reports-writer was deleted 2026-05-24 (classification §4) | nullable-add→backfill→NOT NULL (`20260504_reports_organization_id.sql`) — no orphans |
| `users` | CUSTOMER-DATA / §A (special) | **no CRUD route** — pre-context auth path | ❌ no (and cannot be simply wrapped) | — | pre-context reads on **owner**: `requireApiKey.ts:76/114/149`, `requireAuth.ts:47`, `customerAuth.ts:297/475/774`, `teamInvites.ts:689` (classification §4, grant matrix `:449`); writers `sso.ts`/`mfa.ts`/`teamInvites.ts`/`customerAuth.ts`/`templates.ts` | **the highest-risk table in the batch** — see §4 |

**Grid takeaways:**
- **Worker/lib write paths are clean across the board** — every non-route writer of a Batch-A table is already on a safe channel (`pgElevated` for the cross-org cyber-signal posture write; `withTenant` for templateLoader vendors/controls and postureSnapshot). The policy migration introduces no worker breakage.
- **The entire gap is the route layer.** 7 families (controls, assessments, policies, evidence, actions, reports/assess, vendors-CRUD) are unwrapped; `users` is structurally pre-context and needs the elevated-channel treatment already specified in the grant matrix, not a route wrap.
- **No triggers or views exist** in `db/migrations/` (classification §4 caveat 2, grep-verified there) → no trigger/view-vs-RLS interaction on any Batch-A table.

---

## §3. Policy form per table (Phase 3)

| Table | Recommended form | Literal pilot template usable? |
|---|---|---|
| `risks` | §A standard | ✅ verbatim (swap table name) |
| `posture_snapshots` | §A standard | ✅ verbatim |
| `vendors` | §A standard | ✅ verbatim |
| `controls` | §A standard | ✅ verbatim |
| `assessments` | §A standard | ✅ verbatim |
| `policies` | §A standard | ✅ verbatim |
| `evidence` | §A standard | ✅ verbatim |
| `actions` | §A standard | ✅ verbatim |
| `reports` | §A standard | ✅ verbatim (post-backfill NOT NULL — clean) |
| `users` | §A standard **expression**, but **do not enable until** every pre-context auth read is confirmed on the owner/elevated channel (grant matrix `:449` already specifies this). The policy SQL is standard; the *enablement* is the special case. | ✅ expression verbatim; ⚠️ enablement gated |

- **All 10 use the §A `NULLIF` USING+WITH CHECK form** — no table in plan-Batch-A needs a variation (none are HYBRID/nullable, none are INDIRECT, none are ROOT-TENANT). `domain_scores` — if the operator pulls it in from Batch G — is the **only** one that would need a different template (§D INDIRECT subquery via `posture_snapshots`), and it carries a per-row subquery cost (policy-templates §D note; classification §4 caveat 5). That difference is itself a reason to keep `domain_scores` out of a "§A Batch A" PR.
- **Confirmed for every table:** targets BOTH `USING` and `WITH CHECK`; fail-closed via `NULLIF(…, '')`; scoped to `app_request` only (no `FORCE`, so engine-owner continues to bypass pre-flip — the whole point). `WITH CHECK` is required (not omittable) on all 10 — every Batch-A table is a Tier-A read/write table (grant matrix), so per policy-templates §G the WITH CHECK must be present to stop a tenant stamping another org's id.

---

## §4. Pre-write audits (Phase 4)

### 4.1 Fire-and-forget hazard (γ-track standing rule, incl. the γ.3 setImmediate sub-case)

- **For the wrapped tables (risks, posture_snapshots, vendors-via-recompute):** the fire-and-forget audit already ran and passed during γ.1/γ.2/γ.3 (dispatcher → `pgElevated`; γ.3's `setImmediate` recompute → own `withTenant`). The Batch-A **policy migration wraps no new route**, so it introduces no new fire-and-forget surface on these.
- **For the unwrapped tables:** there is no `asTenant` wrap in a policy PR, so no fire-and-forget hazard is introduced *now*. The hazard is **deferred** to whenever those routes get wrapped (δ/CRUD-sweep) — and per the updated `feedback_route_wrap_fire_and_forget` rule, that future wrap PR must grep each handler for `setImmediate`/`process.nextTick`/`queueMicrotask`/dispatcher/audit ambient-`pg` work. **Flag carried, not actioned here.**
- **No unaudited ambient-`pg` fire-and-forget site touches a Batch-A table from a worker:** the two non-route writers (`cyberSignalProcessingService:879`, `templateLoader:170/293`) are both on safe channels (verified).

### 4.2 Worker / background-job audit (connection mode + GUC)

| Job | Batch-A table touched | Channel | GUC set? | Post-flip verdict |
|---|---|---|---|---|
| posture-worker `index.ts:49` → `postureSnapshot.ts:260` | `posture_snapshots` | `app_request` (per-org) | yes — `withTenant(orgId)` (PR 6) | SAFE (wrapped) |
| `cyberSignalProcessingService.ts:879` | `posture_snapshots` | **owner** (`pgElevated.connect()`) | n/a (owner bypasses RLS) | SAFE (elevated, cross-org-capable by design) |
| `templateLoader.ts:170` (called by `templates.ts`) | `vendors` (:180), `controls` (:293) | `app_request` (per-org) | yes — `withTenant(organizationId)` | SAFE (wrapped) |
| intelligence-worker | none of the 10 Batch-A tables (writes signals/insights/trends/newsletter — other batches) | — | — | n/a |

**No worker connects as `app_request` without setting the GUC on a Batch-A table.** The classic silent-failure mode (posture-worker writing snapshots with no GUC) was already closed by PR 6's `withTenant` wrap. **No worker bricks post-flip on Batch-A tables.**

### 4.3 Migration ordering (Batch A vs δ/ε/ζ)

- **Policy phase-3 vs wrap δ–ζ are two different axes.** δ/ε/ζ (per `A04-G1-request-scope-wrap-design.md` §5, summarized in `pr7_flip_reconcile`) are the **app-layer wrap** rollout (δ = streaming/export + LLM routes; ε = pool sizing/staging load; ζ = CI-enforced invariant). Phase-3 batches A–G are the **DB-policy** rollout. They interlock: per `pr7_flip_reconcile`, **a family's policy batch is gated on that family's wrap.** So:
  - The 3 wrapped families (risks/posture/vendors-recompute) can take a policy **now** (inert, and flip-ready when the flip happens).
  - The 7 unwrapped families' policies should land **after** their δ-class wrap — i.e. **Batch A (full 10) lands after δ**, not before.
- **No schema prerequisite blocks the policy itself** — every Batch-A table already has `organization_id NOT NULL` (no column-add, no NOT-NULL conversion needed in the policy migration). Contrast `findings`, which needed its column added+backfilled+SET NOT NULL in a *prior* migration before the pilot — that work is already done for all 10 here.

### 4.4 Backfill / orphan-row audit

- **Orphan (`organization_id IS NULL`) rows are impossible by construction on all 10 Batch-A tables** — every one is declared `organization_id NOT NULL` (classification §2). The two that were *added* nullable then tightened (`reports` via `20260504_reports_organization_id.sql`: nullable-add → backfill → SET NOT NULL; `user_alert_preferences` similarly, though it's not in Batch A) completed their backfill **before** the NOT NULL constraint was applied — so the constraint itself proves zero nulls remain. **No cleanup step is needed in the policy migration.**
- **I did not run a live row count.** Per the standing credential rule (`feedback_credential_handling` / `never-inline-credentials-in-bash`), I do not connect to prod/staging Postgres from this session. The NOT NULL constraint makes a runtime count **logically unnecessary** (a null row could not exist without violating the constraint). If you want belt-and-suspenders confirmation, the operator-run query is, per table:
  ```sql
  SELECT count(*) FROM <table> WHERE organization_id IS NULL;   -- expected: 0 (constraint-guaranteed)
  ```
  and a cross-org orphan check (rows whose org no longer exists) would be:
  ```sql
  SELECT count(*) FROM <table> t LEFT JOIN organizations o ON o.id = t.organization_id WHERE o.id IS NULL;
  ```
  Neither is a blocker; both are expected to be 0. **If either returns non-zero, STOP** — the policy would lock those rows out of the `app_request` channel and the migration would need a cleanup/reassignment step.

---

## §5. Staging gate plan (Phase 5)

**The uncomfortable truth the cook must confront: staging connects as OWNER today, not `app_request`.** The flip (`DATABASE_URL` → `app_request`, §4a / PR 7) has **not** happened on staging or prod (per `pr7_flip_reconcile` + the pilot migration header: *"MIGRATION_DATABASE_URL unset, app_request has no password"*). So a Batch-A policy migration auto-applied to staging is **inert there too** — the owner bypasses RLS. **A naive "watch staging for 24–48h" cook would observe nothing, because nothing changes.**

What a *meaningful* cook for Batch A must therefore do (this is the design recommendation, not the plan's literal step list, because the plan's steps assume the flip is concurrent):

1. **Schema-state assertion (proves the policy exists, not that it fires):** on staging, `SELECT relname, relrowsecurity FROM pg_class WHERE relname IN (<batch-a tables>)` → all `true`; `SELECT polname, pg_get_expr(polqual,polrelid), pg_get_expr(polwithcheck,polrelid) FROM pg_policy` → the §A NULLIF expression present for each.
2. **Enforcement proof via `SET ROLE` (proves it fires, without the flip):** the harness recipe (policy-templates §H, automated like `findingsRls.test.ts`) — a superuser/owner connection does `SET LOCAL ROLE app_request; SELECT set_config('app.current_org_id', '<orgA>', true)` and asserts (a) only org-A rows visible, (b) explicit cross-org `WHERE` → 0 rows, (c) unset GUC → 0 rows, (d) WITH CHECK rejects a cross-org INSERT. This is the **real** test surface; it does not need the flip and does not need a staging cook — it runs in CI against Docker Postgres. **This is what proves Batch A safe, not a wall-clock cook.**
3. **App-smoke under owner (proves no regression on landing):** log in, exercise the wrapped families (risks list/create/update, posture snapshot, vendor recompute) on staging — confirm zero behavior change (expected, since owner bypasses). This is the only part the 24–48h window adds, and it only proves *inertness*, which we already expect.

**Minimum operator-visible signals that Batch A is safe to promote:** (i) CI `cross-org-isolation` job green including the new `SET ROLE` enforcement probes for each Batch-A table; (ii) `pg_class.relrowsecurity = true` + `relforcerowsecurity = false` on staging for each; (iii) no new `tenant_commit_failed`/`tenant_wrap_handler_failed` on the wrapped families during the owner-cred smoke; (iv) zero `findings`-style 500s tagged to the wrapped families.

**What the cook is actually testing, given the wrap discipline:** almost nothing about RLS (owner bypasses). Its only real job pre-flip is to catch a **migration-application failure** (a typo'd policy, a lock-contention stall on `ALTER TABLE … ENABLE ROW LEVEL SECURITY` against a hot table) and to confirm the auto-migrate path applied cleanly. **The genuine RLS failure mode — a route that sets no GUC returning zero rows — is invisible until the flip,** which is exactly why landing policies on *unwrapped* families (Option B prematurely) is dangerous: the cook cannot catch it. The `SET ROLE` CI probe is the only thing that can, and only for the specific unwrapped-route case if a test exercises that route end-to-end as `app_request` (the harness does, for findings).

---

## §6. Behavioral-change classification (Phase 6)

- **On landing (engine still owner-cred): FUNCTIONALLY INERT** — the β2/γ.0/γ.2/γ.3 pattern. The policy exists but the owner bypasses it; zero client-observable change, zero latency change, zero RLS effect. Identical to how `20260619_findings_rls_pilot.sql` is inert today.
- **On flip (engine → `app_request`): behavior changes — and this is where the scope decision bites.**
  - For the **wrapped** tables (risks, posture_snapshots, vendors-via-recompute): the policy *activates* and DB-level isolation begins firing; legitimate requests are unaffected (GUC is set), a missing-`WHERE` bug becomes non-leaking instead of leaking — the intended security win, no user-visible change for correct code.
  - For the **unwrapped** tables (if shipped under Option B before their wrap): the flip makes their routes return **zero rows** — a user-visible regression (data "disappears"). This is the failure the §5 cook **cannot** see pre-flip.
- **Pre-flip behavioral-change risk on landing:** the only real one is **lock acquisition.** `ALTER TABLE … ENABLE ROW LEVEL SECURITY` takes an `ACCESS EXCLUSIVE` lock briefly; on a hot, large table (`risks`, `actions`, `findings`-scale) under prod auto-migrate this is a sub-second metadata change but is **not** zero — it queues behind/blocks concurrent statements for the lock duration. `CREATE POLICY` is metadata-only. No data rewrite occurs (RLS enablement does not rewrite the table). Risk is low but non-zero; worth a note in the migration and a low-traffic apply window. No interaction with any existing migration (each Batch-A table's last schema migration is long settled).

---

## §7. Open questions for operator decision (Phase 7)

**Structural (must be answered before any implementation):**

1. **⛔ Which Batch A? (the headline §0 decision.)** Option A (γ-aligned subset: `risks`, `posture_snapshots`, `vendors` — flip-ready now) / Option B (plan's full 10, after δ wraps the other 7 families + `users` elevated work) / Option C (re-scope the plan doc to match reality). **My read, not a decision:** Option A is the smallest correct step and the only one that ships nothing un-flip-ready; it also matches the task's own "policies on the γ-wrapped tables" framing once `domain_scores` is dropped from that mental model. But this is yours to set.
2. **`domain_scores` — in or out?** It is wrapped (via `posture.ts`) but is INDIRECT (§D template, subquery cost) and labeled Batch G. Including it means mixing a second template into the PR. Recommend **out** (keep the PR single-template §A); revisit with the other INDIRECT tables.
3. **`vendors` — does the unwrapped `vendors.ts` CRUD route disqualify it from Option A?** The `vendors` *table* has only wrapped writers (recompute + templateLoader), but the `vendors.ts` read/CRUD route is unwrapped — post-flip those reads return zero rows. So `vendors` is **flip-ready for writes but not for its own CRUD reads.** Strictly, `vendors` belongs in Option A only if we accept that its CRUD route still needs a δ wrap before the flip. **This may shrink the truly-clean Option-A set to just `risks` + `posture_snapshots`.** Needs your call.

**Stylistic (default to γ-track precedent unless you say otherwise):**

4. **One migration vs table-per-migration?** γ/phase-2 precedent = one migration file per logical step (`20260619_findings_rls_pilot.sql` is one file, one table). The plan says "Each batch is one migration file" (`rollout-plan:294`). **Default: one migration file for the whole chosen Batch-A set**, matching the plan. (Flag: a single file means a single `schema_migrations` row — all-or-nothing apply, which is fine for idempotent `ENABLE`+`DROP/CREATE POLICY`.)
5. **Raw SQL vs node-pg-migrate policy helper?** The pilot and every A04-G1 migration to date are **raw `.sql`** in `db/migrations/` applied by `scripts/runMigrations.ts`. **Default: raw SQL**, copying the pilot verbatim. (node-pg-migrate's policy helpers are not in use here and would be an inconsistent first.)
6. **Test surface:** mirror `findingsRls.test.ts` per table (the §H `SET ROLE` recipe). Default: yes, one `test/isolation/<batch-a>Rls.test.ts` (or extend a shared param table) per shipped table — this is the actual proof-of-enforcement and the §5 gate signal.

---

## §8. Summary for the report

- **Batch A (plan) = 10 tables; only 3 families wrapped; `domain_scores` is not even in Batch A.** This is not a clean "policies on the γ-wrapped tables" PR — it requires a scope decision (§0/§7-Q1) before implementation.
- **Policy form:** §A NULLIF USING+WITH CHECK, verbatim from the pilot, for all 10 (no variations needed; `domain_scores` would be the lone §D exception if pulled in).
- **Pre-write audits:** fire-and-forget — no new surface (policy wraps no route); workers — all Batch-A table writers already on `pgElevated`/`withTenant`, **none brick post-flip**; ordering — full Batch A is gated behind δ per the project's own rule; backfill/orphans — **zero by NOT NULL construction on all 10**, no cleanup needed, no live count run (constraint-guaranteed, credential rule honored).
- **Behavior:** INERT on landing (owner bypass); activates on flip — safe for wrapped tables, **regressive for unwrapped tables** if shipped prematurely; only landing risk is the brief `ACCESS EXCLUSIVE` lock on `ENABLE ROW LEVEL SECURITY`.
- **Staging cook caveat:** staging is owner-cred too → the cook is inert; the real proof is the `SET ROLE` CI enforcement probe, not a wall-clock window.

**STOP — design doc + report is the gate. No migration SQL written, no source touched, no memory touched. Awaiting the §7-Q1 scope decision before any implementation.**
