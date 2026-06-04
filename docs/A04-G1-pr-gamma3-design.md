# A04-G1 PR γ.3 — Design: wrap the `vendorAssessments` family in `asTenant()` (+ umbrella doc-sync)

**Status:** Design only. No implementation. No route files touched, no umbrella file touched. The read is the gate (same discipline as β1.5 / γ.0 / γ.1 / γ.2).
**Base:** main @ `56c94c75` (γ.2 posture family landed + prod-verified).
**Scope:** **THIRD AND FINAL** γ sub-PR — γ.1 risks ✅ → γ.2 posture ✅ → **γ.3 vendorAssessments**. After γ.3 promote, the **γ wrap track (the β1 dispatcher arc) is COMPLETE**.
**References:** `docs/A04-G1-pr-gamma-design.md` (umbrella — **§3 inventory + §4.1 fire-and-forget verdict are STALE/WRONG for vendorAssessments, corrected here, see §2.umbrella + §11**), `docs/A04-G1-pr-gamma1-design.md` + `docs/A04-G1-pr-gamma2-design.md` (the shapes this mirrors), `docs/A04-G1-rls-rollout-plan.md` (batch classification), the **four** standing pre-wrap rules `feedback_route_wrap_{fire_and_forget,streaming_guard,concurrent_query,post_commit_ambient_query}.md`.

All line numbers are point-in-time against `vendorAssessments.ts` (521 ln) at `56c94c75`; **re-anchor at implementation time** — route+method/symbol is the durable anchor.

---

## 1. Scope — disambiguation outcome + the 3 `vendorAssessments` routes

### 1.0 Scope disambiguation (Phase 1 — γ.3 is structurally different; this is the gate)
The "vendorAssessments" name in the umbrella maps to **exactly one route file: `src/api/routes/vendorAssessments.ts`**. The vendor-domain route surface was enumerated and classified:

| File | Touches vendor_* tables | γ.3? | Rationale |
|---|---|---|---|
| **`vendorAssessments.ts`** | `vendor_assessments` (+ `vendors` read/lock, `findings` write) | **✅ IN SCOPE** | The β1 dispatcher arc — emits `vendor.assessed` (`dispatchWebhookEvent`). The family β1 was built to unblock (umbrella §1/§3). |
| `vendors.ts` | `vendors` | ❌ deferred | **No webhook dispatch** (audit-only writes). Contains a **streaming CSV export** (`/vendors/export.csv`) → streaming-guard BLOCKED. Per umbrella §6/§8 → δ / plain-CRUD sweep. |
| `vendorReviews.ts` | `vendor_reviews` | ❌ deferred | Explicit-tx, savepoint-safe, **no dispatch** → outside the γ arc; plain-CRUD sweep (umbrella §6). |
| `vendorAssessmentAnalysis.ts` | (LLM, reads docs) | ❌ deferred | **LLM route** (`analyzeAssessmentDocument`) → δ scoped-DB/unscoped-LLM split (umbrella §6). |
| `vendorAssuranceDocuments.ts`, `vendorSignalContext.ts`, `aiSystemVendorDependencies.ts`, `signalVendorLinks.ts` | various vendor-adjacent | ❌ deferred | Not the dispatcher arc; CRUD/link/upload families → post-A04-G1 sweep. |

**Decision: γ.3 = `vendorAssessments.ts` only (3 routes).** This matches the umbrella exactly (§3 row, §6.2 "γ.3 — vendorAssessments (3 routes)"). γ.3 does **not** silently expand into the CRUD sweep. The deferred files are named in §8 with rationale. **No operator decision needed on scope** — the umbrella is unambiguous and the empirical file map confirms it.

### 1.1 The 3 routes (verified line-by-line)
`vendorAssessments.ts` registers exactly 3 routes. **No PATCH, no review/approval workflow, no hard-delete** — the header documents "Assessments are immutable once created." So there is exactly ONE write and it is the explicit-tx create.

| # | Route | Decl. line | Class | Detail |
|---|---|---|---|---|
| 1 | POST `/vendor-assessments` | 80 | **write (explicit tx, inline in handler)** | `pg.connect()` `:102`; `BEGIN :104`; `SELECT … vendors … FOR UPDATE :109`; INSERT `vendor_assessments :132`; INSERT `findings :174`; **loop** INSERT `findings :219` (imported findings, sequential awaits); `COMMIT :246`; `writeAuditEvent :260`; `dispatchWebhookEvent :271`; **`setImmediate(...) :282`** (⚠️ §2.1); res 201 `:312`; catch `ROLLBACK :315`; finally `client.release() :326`. 404 early-return path also does `ROLLBACK :122`. |
| 2 | GET `/vendor-assessments` | 337 | read | single `pg.query :394` (cursor-paginated). No concurrent queries. |
| 3 | GET `/vendor-assessments/:id` | 437 | read | **2 sequential** `pg.query` — assessment `:462`, then finding `:481`. Not `Promise.all`; already sequential. |

**Count: 1 write + 2 reads = 3.** Cross-reference vs umbrella §3 (`vendorAssessments.ts` POST `:80`, GET `:337`, GET `:437`): ✅ **MATCH** on route set; ✗ the umbrella's §4.1 fire-and-forget verdict for the POST is **incomplete** (§2.1 / §2.umbrella).

---

## 2. The wrap mechanism — what changes per route

Identical to γ.1/γ.2: wrap each handler in `asTenant(async (req, res) => { … })`, inheriting β1.5 commit-before-respond. **No change** to `asTenant`, `withTenant`, `createSavepointClient`, the γ.0 guard, the dispatcher, or `auditLog`. `asTenant` sits after `attachOrganizationContext`, innermost around the handler. Opener `async (req,res)=>{` → `asTenant(async (req,res)=>{`, closer `}` → `})`, **no body re-indent** (γ.1/γ.2 precedent).

The 2 GETs are **pure mechanical wraps** (GET `:id`'s two reads are already sequential; GET list is one query). The **POST carries the one non-mechanical change (§2.1) and is BLOCKED until it lands**.

### 2.1 The fire-and-forget BLOCKER — `setImmediate` background risk-score recompute (`:282-310`) — **this is γ.3's β1**
The POST schedules a **non-awaited `setImmediate` background job** that, after the response, recomputes and persists the vendor's risk score. Its body issues **three queries on the ambient `pg` proxy**:
- `:284` `pg.query(SELECT criticality FROM vendors WHERE id=$1 AND organization_id=$2)` — read
- `:291` `pg.query(SELECT f.severity, f.status FROM findings f JOIN vendor_assessments va … WHERE … organization_id=$2 …)` — read
- `:302` `pg.query(UPDATE vendors SET current_risk_score=$1 … WHERE id=$2 AND organization_id=$3)` — **write**

**Verdict: BLOCKED by the fire-and-forget audit** (`feedback_route_wrap_fire_and_forget.md`). `setImmediate` is the textbook non-awaited continuation: it is scheduled *inside* the handler (so it inherits the `withTenant` AsyncLocalStorage scope) but **runs as a macrotask AFTER the wrap's outer `COMMIT` and `client.release()`**. Its ambient `pg.query` calls therefore resolve to `ctx.client` — a connection already returned to the pool → **use-after-release** (silent cross-tenant corruption or a hard error). This is the SAME class of blocker β1 fixed for the webhook dispatcher; it is why γ.3 is structurally a β1+β2 in one file, not a pure mechanical wrap.

> Today (POST unwrapped) this is harmless: with no `withTenant` scope, the ambient `pg` proxy resolves to the **pool**, so each `setImmediate` query grabs its own pooled connection. The hazard appears **only when the route is wrapped** — exactly the fire-and-forget rule's "fires on wrap, not on flip" character.

**The other two non-awaited side-effects are SAFE** (verified, not assumed): `writeAuditEvent :260` → `pgElevated` (`auditLog.ts:26/66`), `dispatchWebhookEvent :271` → `pgElevated` (`webhookDispatcher.ts:27`, β1). Both are separate owner-pool channels, immune to the tenant-client lifecycle. The validation/scoring helpers (`validateVendorAssessmentCreate`, `severityToPriority`, `computeVendorRiskScore`) are **pure** (no `pg` import — verified).

**The fix (the §2.1 change — required before/with the wrap):** move the `setImmediate` body's DB work off the ambient tenant proxy. Two options:

- **(a) RECOMMENDED — wrap the callback body in its own `withTenant(orgId, …)`:**
  ```js
  setImmediate(() => {
    void withTenant(organizationId, async () => {
      try {
        const vendorRow = await pg.query(/* criticality */);
        if ((vendorRow.rowCount ?? 0) === 0) return;
        const findingsRows = await pg.query(/* severities */);
        const { score } = computeVendorRiskScore(criticality, findingsRows.rows);
        await pg.query(/* UPDATE vendors … */);
      } catch { /* silent — best-effort */ }
    }).catch(() => {});
  });
  ```
  The fresh `withTenant` opens its **own** client + tx + `SET LOCAL app.current_org_id`, so the ambient `pg` inside it routes to that client (the stale outer ALS store is overridden by `withTenant`'s own `als.run`). Post-flip the recompute's `vendors` UPDATE and `findings`/`vendors` reads are **RLS-enforced** (GUC-scoped), not merely `WHERE`-scoped. Requires adding `withTenant` to the `vendorAssessments.ts` import. This is the architecturally correct channel for **single-org tenant-table** background work (contrast β1's dispatcher, which writes cross-org *infra* tables → pgElevated).

- **(b) ALTERNATIVE — `pg.query` → `pgElevated.query` (the β1 precedent):** simplest (3-token change + import), but runs the recompute on the **owner channel** — bypasses RLS post-flip, relying solely on the explicit `WHERE organization_id=$n` for isolation. Acceptable for a best-effort score write but weaker than (a) once `vendors` (Batch A) gets its policy.

**§9-Q1 asks the operator to choose (a) vs (b). Recommendation: (a).**

### 2.2 No concurrent-query restructuring (γ.3 differs from γ.1/γ.2)
**Concurrent-query audit: ZERO sites.** No `Promise.all` over `pg.query`, no eager `const p = pg.query(...)` promise-binding, no helper fan-out. The POST's writes are sequential awaits (including the `for … of input.findings` loop). GET `:id`'s two reads are already sequential. GET list is a single query. **So γ.3 has NO serialization change** — unlike γ.1 (2 sites) and γ.2 (1 site). The wrap of the GETs and (post-fix) POST is otherwise purely mechanical.

### 2.umbrella — the γ-umbrella doc-sync correction (carried from γ.1 §11-item-1, deferred by γ.2; option (a): land it WITH γ.3)
γ.3's PR will modify a **second file**, `docs/A04-G1-pr-gamma-design.md` (on main), with **three** corrections. Note this is **more than the planned RLS-framing fix** — implementing γ.3 empirically surfaced a *factual error* in the umbrella (see §11 + Flags):

1. **§4.1 fire-and-forget table (line ~109) — FACTUAL CORRECTION.** The umbrella's row for `vendorAssessments POST` lists only `dispatchWebhookEvent` + `writeAuditEvent` and marks **PASS**. It **MISSED the `setImmediate` background recompute** (3 ambient `pg.query`). Correct the row to reflect the BLOCKER + the §2.1 fix, and amend the "**No route is BLOCKED by the fire-and-forget rule**" summary line directly below it (it is false as written — vendorAssessments POST *was* blocked until the setImmediate fix).
2. **§7.2 test plan — RLS-FRAMING CORRECTION (the original §11-item-1).** Replace the RLS-certifying language ("RLS isolation of the write"; "**Fail-closed:** … NULLIF policy") with the **two-axis split**: the γ wraps certify **transaction-shape**; **RLS isolation** is certified later by the phase-3 batch migrations. Record that `risks` / `posture_snapshots` / `domain_scores` / `vendor_assessments` are **policy-less today** (Batch A / A / G / C respectively), so the "Fail-closed NULLIF" test applies only to the `findings` pilot, not to the γ families' own tables. Reframe "cross-org" tests as **WHERE-clause tripwires**.
3. **§4 audit list — ADD THE 3rd + 4th AXES.** The umbrella's §4 lists only fire-and-forget (§4.1) + streaming (§4.2). Add **concurrent-query** ([[feedback_route_wrap_concurrent_query]], surfaced γ.1) and **post-commit-ambient-query** ([[feedback_route_wrap_post_commit_ambient_query]], surfaced γ.1) as standing pre-wrap axes, with the per-family results (risks: 2 concurrent sites + 1 post-commit-atomicity; posture: 1 concurrent site, post-commit clear; vendorAssessments: 0 concurrent, post-commit clear).

**These edits do NOT touch γ.1's or γ.2's already-landed code or tests** — they correct the *umbrella's forward-looking framing/verdicts only*, and only the vendorAssessments row was factually wrong (risks/posture verdicts in §4.1 were correct). See §9-Q2 (option (a) vs (b)) and the Flags.

---

## 3. Savepoint-safety verification (the explicit tx is inline in the POST handler)

The POST's `pg.connect()` (`:102`) becomes `createSavepointClient(ctx)` under the wrap (same shape as γ.1's risks review/PATCH — the tx is **inline in the handler**, NOT in a helper, so there is **no γ.2-style inner-`withTenant`/helper-savepoint refactor**; see §2.x-absent note below).

### 3.0 Preconditions
1. **Connects via the `pg` proxy.** `:27` `import { pg }`; `:102` `await pg.connect()` — not `pgRaw`, not a direct pool. ✅
2. **Bare control statements only.** `:104` `"BEGIN"`, `:246` `"COMMIT"`, `:122` + `:315` `"ROLLBACK"` — all exact single-arg form. No `BEGIN ISOLATION LEVEL`, no `SET TRANSACTION`, no advisory lock, no `LISTEN/NOTIFY`, no `COPY`. The `SELECT … FOR UPDATE` (`:116`) is a row lock *inside* the tx, not a control statement — unaffected by the γ.0 guard. ✅

### 3.1 Stack walk (single `pg.connect()` → one savepoint client; `ctx.savepoint.n` starts at 0)

| Path | Statements | Stack | Outer-tx outcome |
|---|---|---|---|
| **Success** | BEGIN→`SAVEPOINT sp_1`; SELECT FOR UPDATE; INSERT assessment; INSERT finding; loop INSERTs; COMMIT→`RELEASE sp_1` | `[sp_1]`→`[]` | writes folded into outer tx; res 201 buffered; `writeAuditEvent`/`dispatch` fire on pgElevated; `setImmediate` scheduled (runs post-release in its own scope after §2.1 fix); handler resolves → **outer COMMIT persists** → flush 201. ✅ commit-before-respond intact |
| **Vendor-not-found (404, `:121`)** | BEGIN→SAVEPOINT; SELECT FOR UPDATE returns 0 rows; `ROLLBACK`→`ROLLBACK TO sp_1; RELEASE sp_1`; res 404 buffered; `return` | `[sp_1]`→`[]` | savepoint balanced; handler resolves → outer COMMIT (empty) → flush 404. ✅ (mirrors γ.1's early-return rollback) |
| **In-tx error (catch, `:313`)** | BEGIN→SAVEPOINT; a query errors (or the imported-findings loop throws); catch runs `ROLLBACK`→`ROLLBACK TO sp_1; RELEASE sp_1`; res 500 buffered | `[sp_1]`→`[]` | `ROLLBACK TO SAVEPOINT` recovers the outer tx from aborted state (25P02 cleared); handler resolves → outer COMMIT (empty) → flush 500. **500 + nothing persisted (atomic).** ✅ |

Exactly one BEGIN, depth ≤ 1, no nested BEGIN, `client.release()` (`:326`) → no-op under the wrap (outer `withTenant` owns the real client). On the no-org fall-through (`:89`) the handler 403s before `pg.connect()` and `asTenant` gives it the real `res`. ✅ **Savepoint-safe by construction** (matches umbrella §6.2 claim).

### 3.2 Post-commit-ambient-query (4th axis) — **does NOT apply to vendorAssessments** (run-and-clear)
The γ.1 review-POST atomicity quirk needs an **awaited ambient `pg.query` AFTER the COMMIT and before the response**, synchronously in the handler. **The POST has none:** after `COMMIT :246`, the only work before `res :312` is `writeAuditEvent` (pgElevated, fire-and-forget), `dispatchWebhookEvent` (pgElevated, `.catch`), and **`setImmediate` (scheduled, not awaited — a separate macrotask)**. No awaited ambient tenant-client query runs post-COMMIT. The immutability of assessments (no PATCH/review/approval handler) means there is **no review-POST-shaped surface anywhere in the file**. So **there is NO γ.1-style aborted-tx-silent-rollback behavior change in γ.3.** The 4th-axis audit is **run and clear** — recorded so the absence is deliberate.

### 3.x No inner-`withTenant` / no helper-savepoint refactor (contrast γ.2)
γ.2 had to remove an inner `withTenant` and relied on a *helper* (`computeAndSavePostureSnapshot`) opening `pg.connect()`. **γ.3 has neither:** the POST's `pg.connect()` tx is inline in the handler, and **no route wraps a helper in `withTenant`** (the file does not even import `withTenant` today — it will only import it if §2.1 option (a) is chosen). The **only structural change in γ.3 is the §2.1 fire-and-forget fix.** Everything else is the mechanical wrap.

---

## 4. Test plan

Harness: role-simulation suite under `app_request` (β2/γ.1/γ.2 precedent). New file: `test/isolation/vendorAssessmentsTenantWrap.test.ts`. **Harness prerequisite:** add a `seedVendor(pool, orgId, { status, criticality })` helper to `test/isolation/testDb.ts` (mirrors `seedFinding`/`seedRisk`; `vendors` requires `organization_id`, `name`; set `status='active'` so the POST's `FOR UPDATE` precheck passes, and a `criticality` so the recompute produces a non-trivial score). No `seedVendor` exists yet.

### 4.0 The two certification axes — what γ.3 CAN and CANNOT prove (mirrors γ.1/γ.2 §4.0)
**No `vendor_assessments` RLS policy exists** — verified: the only `ENABLE ROW LEVEL SECURITY`/`CREATE POLICY` in the migration set is `findings` (`20260619_findings_rls_pilot.sql`). Per the rollout plan, the POST's three tables land RLS in **different phase-3 batches**:

| Table | Batch | Note |
|---|---|---|
| `vendor_assessments` | **Batch C** (rollout-plan `:299`, `*_assessments`) | γ.3's headline table; no policy today |
| `vendors` (read/lock + recompute UPDATE) | **Batch A** (`:297`) | no policy today |
| `findings` (sub-write) | **pilot (already enforced)** | `findings` carries the phase-2 policy — see the load-bearing finding below |

| Axis | Property | Certified by | In γ.3? |
|---|---|---|---|
| **Transaction-shape** | savepoint safety, commit-before-respond, single-connection, dispatch survival, **setImmediate-recompute survival** (the §2.1 fix) | **γ.3** (this file) | ✅ yes |
| **RLS isolation** | NULLIF fail-closed, cross-org policy-enforced visibility | **Phase-3 Batch C** (vendor_assessments) migration | ❌ deferred |

γ.3 certifies transaction-shape only. Cross-org isolation today is the handler's `WHERE organization_id = $n`, not the DB.

**LOAD-BEARING RLS FINDING (the POST writes `findings`, which ALREADY has a policy).** The POST's `findings` INSERT (`:174`, `:219`) hits the **enforced** `findings_tenant_isolation` policy whose `WITH CHECK` is `organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid`. **Today (unwrapped, owner-cred):** owner bypasses RLS → works. **Post-flip, if this route were left UNWRAPPED:** the `findings` INSERT runs with **no `app.current_org_id` GUC** (the inline `pg.connect()` tx sets no GUC) → `WITH CHECK` evaluates `organization_id = NULL` → **INSERT rejected → the whole POST fails.** Therefore wrapping vendorAssessments POST is **not merely "preparatory" — it is a prerequisite for the flip** (the wrap's `withTenant` sets the GUC so the `findings` sub-write passes its policy). γ.3 stays **INERT pre-flip** (owner bypasses RLS), but it is load-bearing for flip-readiness — analogous to the worker `withTenant` wrap (PR 6). A functional-under-`app_request` POST test that asserts the `findings` row is created **doubly verifies** the wrap sets the GUC correctly (it exercises the live findings policy).

### 4.1 Isolation/shape suite (`test/isolation/vendorAssessmentsTenantWrap.test.ts`) — RLS-independent for vendor_assessments
**Functional-under-`app_request`** (proves the wrap + §2.1 fix don't break CRUD under the non-owner role; catches a missing Tier-A grant AND verifies the findings-policy GUC):
- POST `/vendor-assessments` (seed an active vendor for orgA first) → 201; the `vendor_assessments` row **and** its linked `findings` row readable back by orgA (owner-pool poll). The findings read-back is the GUC/pilot-policy cross-check.
- GET list → 200 with the assessment; GET `:id` → 200 with `{assessment, finding}`.

**Transaction-shape (the γ.3-specific content):**
- **savepoint-nesting atomicity** — induce an in-tx failure on the `findings` INSERT (trigger-injected `RAISE`, mirroring γ.2's `domain_scores` trigger) on a **fresh org+vendor** → POST 500 `vendor_assessment_create_failed`, and **neither** the `vendor_assessments` row **nor** any `findings` row persists (atomic via `ROLLBACK TO sp_1`); assert `tenant_commit_failed` does NOT fire; a later valid POST succeeds (pool not poisoned). This is γ.3's analogue of γ.2's savepoint test and pins §3.1 row 3.
- **dispatch-survives** — seed orgA `webhook_endpoint`, POST, poll `webhook_deliveries` for `vendor.assessed` → proves the non-awaited dispatch fired on pgElevated after the wrap committed.
- **setImmediate-recompute-survives (NEW, γ.3-specific — pins the §2.1 fix)** — POST for a vendor, then poll `vendors.current_risk_score` until non-null/updated → proves the background recompute still runs **after** the §2.1 fix (its own `withTenant`/pgElevated channel), i.e. the fire-and-forget fix didn't silently kill the feature. A regression to the ambient `pg` proxy would either error (use-after-release) or, worse, write to a wrong/released connection — this test is the guard.

**Cross-org tripwires (labeled "WHERE-clause isolation — RLS certification deferred to Batch C"):**
- GET `:id` of orgB's assessment under orgA → 404.
- GET list under orgA excludes orgB's assessments.
- POST under orgA referencing **orgB's vendor_id** → 404 `vendor_not_found` (the `FOR UPDATE` precheck is `WHERE … organization_id=$2`), and no `vendor_assessments`/`findings` row is created for orgB.

### 4.2 Unit suite deltas — **none required**
γ.3 has **no concurrent-query site**, so there is **no serialization-order guard** to add (contrast γ.1/γ.2's `*SerializationOrder.test.ts`). The existing `src/api/__tests__/vendorAssessments.test.ts` covers the pure validation/route logic and is unchanged. The wrap is exercised end-to-end by the isolation suite. **Estimate: 0 unit deltas + ~8–9 isolation** (re-count fresh at implementation; do not assume).

### 4.3 No post-COMMIT-throw pinning test (contrast γ.1)
No post-commit-ambient-query exists (§3.2) → no atomicity behavior-change to pin. The savepoint-nesting test covers the in-tx error path. Recorded so the absence is deliberate.

---

## 5. What this catches vs. what it doesn't (honest residuals)

**Catches (transaction-shape):** on POST — savepoint safety of the inline tx, commit-before-respond, in-tx error atomicity, **the §2.1 fire-and-forget fix (use-after-release closed; recompute still runs)**, dispatch survival, and (via the findings sub-write) correct GUC propagation against the live findings pilot policy. All 3 routes prepared for the future `vendor_assessments` policy.

**Does NOT catch / out of γ.3's reach:**
- **RLS cross-org isolation** for `vendor_assessments` (Batch C) and `vendors` (Batch A) — no policy exists; deferred to the phase-3 batch migrations. Same shape as γ.1/γ.2.
- **The deferred vendor families** — `vendors.ts` (incl. the `export.csv` streaming route — streaming-guard BLOCKED, δ), `vendorReviews.ts`, `vendorAssessmentAnalysis.ts` (LLM, δ). §8.
- **Fire-and-forget infra channels** — `dispatchWebhookEvent`/`writeAuditEvent` run on pgElevated by design (β1); not RLS-isolated by this wrap (dispatch-survives proves they fire, not that they're tenant-scoped).

**Audit results summary:** fire-and-forget = **1 BLOCKER fixed in-PR** (setImmediate, §2.1); streaming = **PASS** (zero hits); concurrent-query = **PASS** (zero sites, no serialization); post-commit-ambient-query = **run and CLEAR** (§3.2).

---

## 6. Failure modes

| Event | Outcome |
|---|---|
| **Vendor not found / archived** | 404 `vendor_not_found`; savepoint `ROLLBACK TO` balances; outer COMMIT empty; nothing persisted. |
| **In-tx error (any INSERT, or imported-findings loop)** | catch `ROLLBACK TO sp_1` recovers; 500 `vendor_assessment_create_failed`; outer COMMIT empty; atomic, nothing persisted. No `tenant_commit_failed`. |
| **§2.1 fix regressed (setImmediate back on ambient `pg`)** | post-release use-after-release on the pooled tenant client → recompute errors or corrupts; caught by the setImmediate-survives test (and, in prod, by a missing/!-updated `current_risk_score`). |
| **Handler throws (uncaught)** | handler catches internally and sends its own 5xx (resolves → empty COMMIT). A genuinely uncaught throw → `withTenant` ROLLBACK, β1.5 discards buffer, 500, `tenant_wrap_handler_failed`. |
| **Outer COMMIT fails** (connection death/failover) | `withTenant` rejects; buffer discarded; 500; `tenant_commit_failed` (durability incident — distinct signal). |
| **Post-flip, findings sub-write without GUC** (only if route left unwrapped) | `findings` `WITH CHECK` rejects (org = NULL) → POST fails. The wrap is what supplies the GUC → prerequisite for the flip (§4.0). |
| **γ.0 guard trips** (future non-bare control stmt added to the tx) | `TenantWrapUnrewriteableStatementError` before it reaches `ctx.client` → 500. Inert today. |

---

## 7. Rollout

Same discipline as γ.1/γ.2: implement on a branch off develop → CI 7/7 (lint includes the γ.0 rule scoping the newly-wrapped handlers) → squash-merge to develop → promote develop→main via `chore/promote-pr-gamma3-to-main` with **`gh pr merge --merge` (never squash)** — the **16th** CLI `--merge` branch-sync → **prod-verify before declaring the γ track done**: engine prod `/version` = new SHA; POST `/vendor-assessments` still 201 with persisted assessment+finding; `vendors.current_risk_score` still updates post-POST (the §2.1 fix); no `tenant_commit_failed`/`tenant_wrap_handler_failed` on vendor-assessment traffic; no `client.query while already executing` warnings.

**γ.3 is the LAST γ sub-PR. After γ.3 promote, the γ wrap track (the β1 dispatcher arc: findings + risks + posture + vendorAssessments) is COMPLETE.** The next A04-G1 work is the δ track (streaming/export + LLM), the plain-CRUD sweep (vendors-rest, vendorReviews, riskTreatments, links, settings), then the phase-2 RLS batch sweep (A–G) and the phase-3 `DATABASE_URL` flip — all gated as in `project_a04_g1_pr7_flip_reconcile`.

**Behavioral change on prod:** γ.3 is **FUNCTIONALLY INERT** (the β2/γ.0/γ.2 pattern). The 3 routes have no client-observable change; there is **no serialization latency change** (zero concurrent-query sites). The §2.1 fire-and-forget fix is runtime-inert pre-flip (the recompute already worked on pooled connections; it now runs on its own scoped client/elevated channel — same result). **Zero RLS effect** (engine still owner-cred). Unlike γ.1, no atomicity behavior change.

---

## 8. Out of scope

- **The deferred vendor families** — `vendors.ts` (incl. `/vendors/export.csv` streaming → δ), `vendorReviews.ts`, `vendorAssessmentAnalysis.ts` (LLM → δ), `vendorAssuranceDocuments.ts` and the vendor-link/upload routers → post-A04-G1 plain-CRUD / δ sweeps. Named with rationale in §1.0.
- **The phase-3 RLS-policy migrations** — `vendor_assessments` (Batch C), `vendors` (Batch A). After the cook.
- **The γ-umbrella's own structural rewrite** — γ.3 makes the three targeted corrections in §2.umbrella; it does NOT rewrite the umbrella wholesale.
- **`riskTreatments.ts`** and other non-dispatching explicit-tx CRUD — plain-CRUD sweep (umbrella §6).

---

## 9. Operator-decision questions (decide before implementation)

1. **§2.1 fire-and-forget fix channel.** The `setImmediate` recompute must move off the ambient tenant proxy. Recommend **(a) its own `withTenant(orgId, …)`** (RLS-faithful for the single-org `vendors`/`findings` tenant-table work; requires importing `withTenant`). Alternative **(b) `pgElevated`** (β1 precedent, simplest, but owner-channel → bypasses RLS post-flip, relies on `WHERE org`). **Recommendation: (a).** This is also an audit BLOCKER + a structural change → it needs your explicit nod regardless of channel.
2. **Umbrella doc-sync delivery.** Recommend **(a) land the §2.umbrella corrections in γ.3's PR as a second modified file** (`docs/A04-G1-pr-gamma-design.md`) — one PR, one merge, the correction lands with the work that triggered it. Alternative **(b) follow-up doc-sync commit/PR.** **Recommendation: (a)** (γ.1/γ.2 explicitly deferred this to γ.3; there is no later γ to fold it into). Note the correction now includes a **factual fix** (the umbrella's wrong fire-and-forget PASS for vendorAssessments), not just RLS-framing — see Flags.
3. **Concurrent-query serialization (a) vs (b):** **N/A — no concurrent-query site in γ.3.** No decision needed (recorded for symmetry with γ.1/γ.2).
4. **Atomicity behavior change (γ.1-style):** **None found** (§3.2 post-commit-ambient-query clear). No "pin the real atomic behavior" gate needed. (Recorded for symmetry; if you disagree with the read, the savepoint-nesting test still pins the in-tx error path.)

---

## 10. Summary

- **Scope is unambiguous:** γ.3 = `vendorAssessments.ts` only — 1 explicit-tx write (POST) + 2 reads. The other vendor files are the umbrella's named δ/CRUD-sweep deferrals.
- **One audit BLOCKER, fixed in-PR:** the POST's `setImmediate` background risk-score recompute issues 3 ambient `pg.query` → use-after-release when wrapped. §2.1 moves it to its own `withTenant`/pgElevated. This is γ.3's β1, and it is the **only structural change** (no inner-`withTenant`, no serialization).
- **Other audits:** streaming PASS (0 hits), concurrent-query PASS (**0 sites — no serialization, unlike γ.1/γ.2**), post-commit-ambient-query CLEAR (**no γ.1-style atomicity change**; assessments are immutable, no review handler).
- **Savepoint-safe by construction** — inline tx, bare BEGIN/COMMIT/ROLLBACK; in-tx errors recover via `ROLLBACK TO SAVEPOINT` (atomic).
- **Load-bearing RLS nuance:** the POST writes `findings` (already policy-enforced); the wrap supplies the GUC the findings `WITH CHECK` needs → γ.3 is a **flip prerequisite** for this route, though INERT pre-flip.
- **γ.3 certifies transaction-shape, NOT RLS isolation** — `vendor_assessments` (Batch C) / `vendors` (Batch A) are policy-less; deferred.
- **Umbrella correction (option a): 3 edits** — fix the wrong §4.1 fire-and-forget verdict (factual), the §7.2 RLS-framing (two-axis split), and add the 3rd/4th audit axes to §4. Does NOT affect γ.1/γ.2 landed code.
- Files (anticipated at implementation): `vendorAssessments.ts` (3 wraps + §2.1 setImmediate fix + import), `docs/A04-G1-pr-gamma-design.md` (umbrella 3-edit correction), `test/isolation/vendorAssessmentsTenantWrap.test.ts` (new), `test/isolation/testDb.ts` (+`seedVendor` helper), and this design doc. **No unit-test file, no `vendorAssessmentValidation`/helper change, no migration.**

**STOP — design only. No route files touched, no umbrella file touched. This is the last γ; nothing beyond γ.3 started.**

---

## 11. Cross-PR follow-ups

1. **[RESOLVED BY γ.3 — option (a)] The γ-umbrella RLS-framing correction** (carried from γ.1 §11-item-1, deferred by γ.2) lands in γ.3's PR (§2.umbrella). Since γ.3 is the last γ, there is no later γ to defer to.
2. **[NEW — surfaced in this design pass] The umbrella's §4.1 fire-and-forget verdict for `vendorAssessments` was factually wrong** (missed the `setImmediate` recompute → marked PASS instead of BLOCKED-until-fixed). Folded into the same §2.umbrella correction. Does **not** affect risks/posture verdicts (those were correct) — so γ.1/γ.2 landed work is unaffected.
3. **[carried, satisfied at memory level]** The 3rd/4th audit axes are standing-rule memories; the remaining work is the umbrella's §4 list fold-in (item 1, §2.umbrella-3).
4. **[forward, post-γ]** With γ.3 the γ wrap track is complete. Anything still queued migrates to the δ track (streaming/export + LLM), the plain-CRUD sweep, or the phase-2 RLS batch docs — tracked in [[project_a04_g1_pr7_flip_reconcile]].

---

## Flags (per the γ.3 gate)
- **Scope-disambiguation decision:** γ.3 = `vendorAssessments.ts` only (3 routes). The umbrella was unambiguous and the empirical file map confirmed it; γ.3 does not expand into the CRUD sweep. No operator decision needed on scope.
- **Route BLOCKED by an audit:** **YES — POST `/vendor-assessments` is BLOCKED by the fire-and-forget audit** (the `setImmediate` background recompute, §2.1). The fix lands **in γ.3's PR** (it's a small, localized, same-file change — no separate prerequisite PR like β1 needed). This is γ.3's only structural change. **Needs your §9-Q1 decision on the fix channel ((a) withTenant vs (b) pgElevated) before implementation.**
- **γ.1-style post-commit-ambient-query atomicity change:** **NONE.** No awaited ambient `pg.query` after COMMIT before response; assessments are immutable (no review/approval handler). No "pin the real atomic behavior" gate needed.
- **Unexpected fire-and-forget channel:** **YES — the `setImmediate` risk-score recompute** (the BLOCKER above). The umbrella missed it. `writeAuditEvent`/`dispatchWebhookEvent` are pgElevated-safe.
- **Structural change beyond mechanical wraps + serialization:** **YES — exactly one:** the §2.1 `setImmediate` fire-and-forget fix. No inner-`withTenant` (γ.2-style) and no serialization (γ.1/γ.2-style) in γ.3.
- **γ-umbrella correction surfaced unanticipated breadth:** **YES — surfaced, not a hard STOP.** The correction must fix a **factual error** (the umbrella's wrong fire-and-forget PASS for vendorAssessments), not just the planned RLS-framing. **It does NOT affect γ.2's (or γ.1's) already-landed framing or code** — only the umbrella's vendorAssessments row/forward-looking test plan. Flagged here for your read; the design pass handled it (§2.umbrella). If you want the umbrella fix split out from γ.3's code PR, choose §9-Q2 option (b).
