# A04-G1 PR γ.1 — Design: wrap the `risks` family in `asTenant()`

**Status:** Design only. No implementation. No branch, no route files touched. The read is the gate (same discipline as β1.5 / γ.0 — operator reads this doc, then authorizes implementation).
**Base:** main @ `ad8dc7c9` (γ.0 savepoint-safety guard landed; β2 findings family fully wrapped).
**Scope:** the first of three γ sub-PRs — **γ.1 risks → γ.2 posture → γ.3 vendorAssessments** — per the γ-umbrella scope doc `docs/A04-G1-pr-gamma-design.md`.
**References:** `docs/A04-G1-pr-gamma-design.md` (umbrella scope), `docs/A04-G1-pr-gamma0-design.md` (savepoint guard γ.1 leans on), `docs/A04-G1-request-scope-wrap-design.md` §4.5 (explicit-tx handling), `docs/A04-G1-pr-beta1.5-design.md` (deferred-response shim), standing rules `feedback_route_wrap_fire_and_forget.md` + `feedback_route_wrap_streaming_guard.md`, and the `project_a04_g1_pr7_flip_reconcile.md` **item-5** landmine (Promise.all on a single tenant client).

All line numbers are point-in-time against `risks.ts` @ `ad8dc7c9` (1460 lines) and **must be re-anchored at implementation time** — route+method is the durable anchor.

---

## 1. Scope — the 8 `risks` routes (verified line-by-line)

`risks.ts` registers exactly 8 routes. Classification per the umbrella's three buckets:

| # | Route | Decl. line | Class | Tx detail |
|---|---|---|---|---|
| 1 | POST `/risks` | 234 | **plain CRUD write** | no explicit BEGIN; single ambient `pg.query` INSERT `:294`; audit `:366`; dispatch `:387` |
| 2 | GET `/risks` | 418 | read | single `pg.query` `:487` |
| 3 | GET `/risks/summary` | 528 | read | **`Promise.all` of 6 concurrent `pg.query` `:550`** ⚠️ |
| 4 | GET `/risks/intelligence` | 701 | read | single `pg.query` `:719` |
| 5 | GET `/risks/:id` | 788 | read | single `pg.query` `:813` |
| 6 | GET `/risks/:id/history` | 866 | read | sequential ownership `pg.query` `:898`, then **`Promise.all` of 2 concurrent `pg.query` `:982`** ⚠️ |
| 7 | POST `/risks/:id/review` | 1029 | **explicit-tx write** | `pg.connect()` `:1081`; BEGIN `:1083`; COMMIT `:1157`; ROLLBACK `:1101` (404), `:1200` (catch); audit `:1170`; post-commit ambient SELECT `:1189`; `release()` `:1210` |
| 8 | PATCH `/risks/:id` | 1220 | **explicit-tx write** | `pg.connect()` `:1252`; BEGIN `:1254`; COMMIT `:1376`; ROLLBACK `:1271` (404), `:1334` (invalid owner), `:1445` (catch); audit `:1403`; dispatch `:1429`; `release()` `:1456` |

**Count: 3 writes (1 plain + 2 explicit-tx) + 5 reads = 8.**

**Cross-reference vs umbrella claim (3 writes + 5 reads):** ✅ **MATCH.** Umbrella §3 line numbers reconcile exactly (POST `/risks` :234, review :1029 BEGIN :1083 COMMIT :1157, PATCH :1220 BEGIN :1254 COMMIT :1376). No discrepancy — not stopping.

> The ⚠️ on routes 3 and 6 is **not** a count mismatch. It is a wrap-interaction finding (concurrent queries on the single tenant client) that the umbrella did not surface for the read routes. It does not change the inventory; it is raised as §6-risk-1 and **resolved by §2.1** (serialize, option a).

---

## 2. The wrap mechanism — what changes per route

Identical to β2: wrap each handler in `asTenant(async (req, res) => { … })`, inheriting β1.5 commit-before-respond. **No change** to `asTenant`, `withTenant`, `createSavepointClient`, the γ.0 guard, the dispatcher, or `auditLog`.

Registration shape today (every route):
```js
router.post("/risks", requireApiKey, attachOrganizationContext,
  requireEntitlement("standard"), async (req, res) => { … });
```
becomes:
```js
router.post("/risks", requireApiKey, attachOrganizationContext,
  requireEntitlement("standard"), asTenant(async (req, res) => { … }));
```
`asTenant` must sit **after** `attachOrganizationContext` (it reads `req.organizationContext.organizationId`) and is the innermost wrapper around the handler body. The handler body is **unchanged** except for re-indentation (review with whitespace ignored).

**Per-route effect:**
- The handler body now runs inside `withTenant(orgId, …)` → one transaction on one dedicated client, `SET LOCAL app.current_org_id`, ALS scope. Every ambient `pg.query` / `pg.connect()` routes onto that single tenant client.
- The handler's own `res.status(n).json(body)` is buffered by the β1.5 deferred-response proxy and flushed **only after COMMIT** succeeds.
- No-org requests fall through unwrapped (each handler keeps its `organization_context_missing` 403 — verified present in all 8).

### 2.1 The one non-mechanical change γ.1 carries — serialize the two `Promise.all` read handlers (DECIDED: open question 1 → **option (a)**)

This is the γ.1 analogue of the posture §2.3 refactor γ.2 carries: a route-internal restructuring *caused by* the wrap's single-transaction model, reviewed in the same PR that introduces the cause. Deferring it (option b/c) would either leave the risks family partially wrapped (breaking β2's "each family lands as a coherent unit" pattern) or defeat the single-transaction guarantee for those reads. Both serializations execute **inside the `asTenant` wrap, on the savepoint-rewritten tenant client — one connection, ordered**.

**(i) GET `/risks/summary` (`:550`) — 6-query `Promise.all` → 6 sequential `await`s.**
```js
// BEFORE (concurrent on the single tenant client → DeprecationWarning under the wrap):
const [byStatusResult, byRatingResult, byDomainResult,
       byInherentRatingResult, byResidualRatingResult, overdueReviewResult]
  = await Promise.all([ pg.query(/* status */), pg.query(/* rating */),
      pg.query(/* domain */), pg.query(/* inherent */),
      pg.query(/* residual */), pg.query(/* overdue */) ]);

// AFTER (sequential — one in-flight query at a time on ctx.client):
const byStatusResult         = await pg.query(/* status   */ …);
const byRatingResult         = await pg.query(/* rating   */ …);
const byDomainResult         = await pg.query(/* domain   */ …);
const byInherentRatingResult = await pg.query(/* inherent */ …);
const byResidualRatingResult = await pg.query(/* residual */ …);
const overdueReviewResult    = await pg.query(/* overdue  */ …);
```
The downstream `buildRiskSummary(...)` call and the response shape are **unchanged** — only the result *binding* changes from array-destructure to six `const`s. No query text changes.

**(ii) GET `/risks/:id/history` (`:982`) — 2-query `Promise.all` → 2 sequential `await`s.** Note: the current code assigns `eventsPromise` (`:915`) and `countPromise` (`:955`) as eager promise variables — *those `pg.query(...)` calls start executing the moment the variables are bound*, so the concurrency begins before the `Promise.all` line. Serialization therefore means **removing the eager promise variables** and awaiting inline:
```js
// BEFORE: eager promises (both queries already in flight before Promise.all):
const eventsPromise = pg.query(/* events */ …);
const countPromise  = pg.query(/* count  */ …);
const [eventsResult, countResult] = await Promise.all([eventsPromise, countPromise]);

// AFTER (events then count, sequential):
const eventsResult = await pg.query(/* events */ …);
const countResult  = await pg.query(/* count  */ …);
```
The ownership pre-check (`:898`) is already a sequential `await` and is unaffected.

**Latency impact (honest, structural — no instrumented per-query timings were taken this pass; numbers below are round-trip-bounded estimates, not measured).**
- Cost model: `Promise.all` ≈ `max(query_i) + 1 RTT`; sequential ≈ `Σ query_i + N·RTT`. The delta is dominated by `(N−1)` extra client↔DB round-trips.
- **summary:** the 6 queries are all simple single-table `GROUP BY`/`COUNT` aggregates over `risks WHERE organization_id = $1` — small, org-indexed, individually sub-millisecond-to-low-ms. Serial cost ≈ 6 round-trips instead of 1. On the same-region Render↔Postgres path (low-single-digit-ms RTT) this is a bounded **~+5–15 ms** added wall-time per request, all of it round-trip overhead, not query work. Acceptable for an aggregate summary endpoint. **Caveat:** if any one aggregate ever becomes slow (e.g. the `risks` table grows large and an aggregate goes unindexed), serial execution makes that route's latency the *sum* rather than the *max* — flagged as the regression to watch (§5). The serialization-order test (§4.2) does not measure latency; if latency becomes a concern post-flip, the correct fix is query-level (composite index / a single combined aggregate query), not re-parallelizing on one client.
- **history:** only 2 queries → ≈ 1 extra round-trip, **~+1–3 ms**. Negligible.

**This is the only handler-body change in γ.1 beyond the mechanical wrap + re-indent.** All other 6 routes are pure `asTenant(async (req,res)=>{ …unchanged… })` wraps.

---

## 3. Savepoint-safety verification (load-bearing — the part γ.0 was built to protect)

Under `asTenant`, `pg.connect()` returns `createSavepointClient(ctx)` (`postgres.ts:58-62`), which rewrites bare `BEGIN→SAVEPOINT sp_n`, `COMMIT→RELEASE SAVEPOINT sp_n`, `ROLLBACK→ROLLBACK TO sp_n; RELEASE sp_n`, and `release()→no-op` (`tenantContext.ts:191-257`). Two preconditions and several edge paths verified for **both** explicit-tx handlers.

### 3.0 Preconditions (both handlers)
1. **Connects via the `pg` proxy.** Both `import { pg }` (`:21`) and call `await pg.connect()` (review `:1081`, PATCH `:1252`) — not `pgRaw`, not a directly-imported pool. ✅
2. **Bare control statements only.** Every control statement grepped is the exact single-arg form: `client.query("BEGIN")`, `"COMMIT"`, `"ROLLBACK"`. **No** `BEGIN ISOLATION LEVEL`, no `SET TRANSACTION`, no advisory locks, no `LISTEN/NOTIFY`, no `COPY`. The only locking is `SELECT … FOR UPDATE` (review `:1096`, PATCH `:1266`) — a row lock inside an ordinary `SELECT`, which is **not** a control statement and is correctly passed through untouched (it does not match `txControlKeyword` nor `isUnrewriteableStatement` — the latter only matches `SELECT PG_ADVISORY_`). ✅
   → γ.0's runtime guard would throw on any *future* drift into those forms; today **nothing in either handler trips it**. Verified, not assumed.

### 3.1 POST `/risks/:id/review` — stack walk
`ctx.savepoint.n` starts at 0 (outer `withTenant` did the real `BEGIN` on `ctx.client` directly, not via the proxy). One `pg.connect()` → one savepoint client with its own local `stack`.

| Path | Statements | Stack | Outer-tx outcome |
|---|---|---|---|
| **Success** | BEGIN→`SAVEPOINT sp_1` (push); UPDATE; COMMIT→`RELEASE sp_1` (pop) | `[sp_1]`→`[]` | UPDATE merged into outer tx (not yet durable); post-commit ambient SELECT `:1189` on `ctx.client`; res 200 buffered → handler resolves → **outer COMMIT durably persists** → flush 200. ✅ commit-before-respond intact |
| **404 not-found `:1101`** | BEGIN (push); SELECT 0 rows; ROLLBACK→`ROLLBACK TO sp_1; RELEASE sp_1` (pop) | `[sp_1]`→`[]` | nothing risk-specific; res 404 buffered → resolve → outer COMMIT (empty) → flush 404. ✅ |
| **catch `:1200`** | BEGIN may/may-not have run; ROLLBACK in `try{}` | see 3.3 | res 500, **no re-throw** → handler resolves → outer COMMIT. See 3.3 for the post-COMMIT sub-case. |

Exactly **one** BEGIN, terminal depth returns to 0, no nested BEGIN. ✅

### 3.2 PATCH `/risks/:id` — stack walk
Same shape, **three** ROLLBACK sites (two early-return + one catch):

| Path | Statements | Stack | Outer-tx outcome |
|---|---|---|---|
| **Success** | BEGIN (push); SELECT…FOR UPDATE; UPDATE; COMMIT→`RELEASE sp_1` (pop) | `[sp_1]`→`[]` | merged → audit/dispatch (pgElevated) → res 200 buffered → resolve → outer COMMIT durable → flush. ✅ |
| **404 `:1271`** | BEGIN (push); 0 rows; ROLLBACK (pop) | `[sp_1]`→`[]` | res 404 → resolve → outer COMMIT (empty). ✅ |
| **invalid owner `:1334`** | BEGIN (push); row found; owner resolve fails; ROLLBACK (pop) | `[sp_1]`→`[]` | res 400 → resolve → outer COMMIT (empty). ✅ |
| **catch `:1445`** | ROLLBACK in `try{}` | see 3.3 | res 500, no re-throw → resolve → outer COMMIT. |

All four paths balanced; depth ≤ 1; no nesting. ✅ Note `resolveOwnerUserSameOrg(client, …)` `:1328` is passed the **savepoint client** explicitly and is awaited inside the savepoint tx — correct.

### 3.3 The post-COMMIT throw case + the mismatched-pop guard (the crux)
In **both** handlers the success path is `… COMMIT (RELEASE sp_1, stack now []) → [non-tx work] → res.json`. Everything between the inner COMMIT and `res.json`:
- **review** `:1158-1194`: `logger.info`; `writeAuditEvent` (non-awaited, pgElevated); **`await pg.query(fullResult)` `:1189`** (ambient → `ctx.client`, **CAN throw** on a DB error); `res.status(200).json`.
- **PATCH** `:1377-1442`: `logger.info`; pure-compute diff loop `:1393-1401`; `writeAuditEvent` (non-awaited); `dispatchWebhookEvent().catch()` (non-awaited); `res.status(200).json`. (No awaited ambient query here — lower throw surface than review.)

If anything in that range throws (realistically only review's `:1189` SELECT), control enters the handler's own `catch`, which runs `await client.query("ROLLBACK")`. **At this point the savepoint stack is already empty** (the inner COMMIT popped `sp_1`). So:

```
txControlKeyword("ROLLBACK") === "ROLLBACK"  →  stack.pop() === undefined
                                            →  return Promise.resolve(EMPTY_RESULT)   // tenantContext.ts:225-226
```

**The bare ROLLBACK never reaches `ctx.client`** — the mismatched-pop guard correctly prevents the stray catch-ROLLBACK from corrupting the outer tx, and that load-bearing safety property is intact. **But the guard cannot un-abort an already-poisoned connection.**

→ **CORRECTED (empirically verified by the §4.3 test — supersedes the original "write persists" claim, which was wrong).** Under the wrap, a real PG error on review's post-commit refresh SELECT puts `ctx.client`'s transaction into Postgres's **aborted state (25P02)**. The handler catches, sends 500, resolves. `withTenant` then runs `COMMIT` on the aborted tx; **Postgres silently turns `COMMIT`-on-aborted into `ROLLBACK` and returns the `ROLLBACK` tag without error.** The UPDATE is **atomically rolled back**. The mismatched-pop guard (γ.0) correctly prevents the stray bare ROLLBACK from corrupting the outer tx — that load-bearing safety property is intact. What γ.0 **cannot** do is un-abort an already-poisoned connection; that is a **Postgres mechanic, not a wrap mechanic**.

This is a **behavior change** versus today's unwrapped path (today the inner COMMIT at `:1157` was durable on the dedicated connection *before* the refresh, so a refresh error left the write **persisted**). The wrap **makes the request atomic for review** — which is the **correct** semantics: the client gets a 500 and the review UPDATE is rolled back, so a retry is safe and there is no phantom row. Today's "500 despite a persisted write" quirk is **fixed by the wrap as a structural side effect**, not as a deliberate handler change. The original "preserve-not-fix" framing (§9 decision 2) was based on this now-corrected analysis. Verified by §4.3; observability nuance (query-error mode is a silent rollback, no `tenant_commit_failed`; connection-death mode fires it) in §5.

> Note: PATCH `:1377-1442` has **no awaited ambient query** after its inner COMMIT (pure-compute diff + pgElevated fire-and-forget), so PATCH cannot abort its outer tx this way — review is the **only** affected route.

### 3.4 Serialized reads (summary, history) introduce no transaction/savepoint concern
The §2.1 serialization touches only the **read** routes, which issue **no** `pg.connect()`, no `BEGIN`, and no savepoint — they run plain `SELECT`s on the ambient `pg` proxy. Under the wrap those become sequential reads on `ctx.client` inside the wrap's single read-mostly transaction. Sequential `await`s on one client are the **simplest possible case** for the proxy: one query in flight at a time, no concurrent-query landmine, no savepoint stack interaction (the stack is only touched by the explicit-tx writes in §3.1–3.3). The savepoint-safety analysis above is **unchanged** by the serialization — it concerns only review/PATCH, and neither is modified by §2.1. ✅

### 3.5 `release()` consistency
Both handlers call `client.release()` in `finally` (review `:1210`, PATCH `:1456`). Under the wrap → savepoint-client no-op (outer `withTenant` owns the real client). On the no-org fall-through → real `pgRaw` client released as today. Both paths verified consistent (umbrella §7.3-risk-5). ✅

---

## 4. Test plan

Harness: the role-simulation suite (`test/isolation/findingsTenantWrap.test.ts` precedent — startup GUC `options=-c role=app_request`). New file: `test/isolation/risksTenantWrap.test.ts`.

### 4.1 Isolation suite — new tests (RETARGETED — see §4.0 below)

#### 4.0 The two certification axes — what this test file CAN and CANNOT prove for risks
The β2 findings isolation tests are meaningful **only because `findings` carries the phase-2 pilot RLS policy** (`20260619_findings_rls_pilot.sql`). **`risks` has no RLS policy and RLS is not enabled on it** — verified: the only `ENABLE ROW LEVEL SECURITY` / `CREATE POLICY` in the entire migration set is on `findings`. Per the rollout plan (`A04-G1-rls-rollout-plan.md:294,297`), the `risks` policy is a **Phase-3 Batch-A** deliverable — a separate migration with its own staging gate, landing *after* the phase-2 wrap work has cooked on main for 7 days. The wrap track (α/β/γ) and the per-table RLS-policy track are **two separate tracks**; findings only got both at once because it was the pilot.

Consequently the γ.1 test file separates **two axes the original test plan conflated**:

| Axis | Property | Certified by | In γ.1? |
|---|---|---|---|
| **Transaction-shape** | savepoint safety, commit-before-respond, serialization order, post-COMMIT-throw handling, fire-and-forget survival | **γ.1** (this file) | ✅ yes |
| **RLS isolation** | NULLIF fail-closed, cross-org policy-enforced visibility, GUC-driven row scoping | **Phase-3 Batch-A** risks RLS migration (after the post-γ.1 7-day cook) | ❌ no — deferred |

**γ.1 certifies transaction-shape properties (savepoint safety, commit-before-respond, serialization). It does NOT certify RLS isolation for `risks`** — that certification lands with the Batch-A `risks` RLS policy migration. Until then, cross-org isolation on these routes is enforced by the handlers' `WHERE organization_id = $2` clauses, **not** by the database. The wrap *prepares* every route for the future policy.

**Dropped from the original plan (RLS-dependent — cannot be written truthfully against `risks` today):**
- ~~positive-control "a 200 proves `asTenant` set the GUC"~~ — vacuous with no policy reading the GUC (a 200 is returned regardless).
- ~~cross-org 404 *via RLS*~~ — the 404 comes from the `WHERE` clause, not a policy; reframed as a tripwire below.
- ~~no-GUC fail-closed write (NULLIF policy)~~ — `app_request` has full INSERT grant on `risks` with no `WITH CHECK`, so an unscoped write **persists**; the assertion would actively fail.
- ~~unscoped read sees zero rows~~ — no policy → an unscoped `SELECT risks` sees **all** rows; the assertion would actively fail.

#### Retargeted isolation/shape suite (`test/isolation/risksTenantWrap.test.ts`)
Harness identical to β2 (role-simulation under `app_request`, owner seeding pool). Every test below is RLS-independent — it asserts transaction shape, functional correctness under the non-owner role, or WHERE-clause isolation as a tripwire.

**Functional-under-`app_request` (proves the wrap doesn't break ordinary CRUD under the non-owner role — also catches a missing Tier-A grant):**
- POST `/risks` → 201, row readable back by the same org.
- POST `/risks/:id/review` → 200; the inner BEGIN/COMMIT commits *as part of* the outer request tx (assert the row is updated, via owner-pool poll like β2's commit-before-respond wait).
- PATCH `/risks/:id` → 200; change persists (owner-pool poll).

**Transaction-shape (the risks-specific savepoint + fire-and-forget content γ.1 actually certifies):**
- review **404-rollback** — review a non-existent id → inner `ROLLBACK` pops only `sp_1`, outer tx still commits cleanly, no leakage.
- PATCH **invalid-owner-rollback** — the `:1334` early `ROLLBACK` path balances the stack; outer tx commits an empty tx → 400, nothing persisted.
- **dispatch-survives** — seed org-A `webhook_endpoint`, POST `/risks`, poll `webhook_deliveries` for the `risk.created` row → proves the non-awaited dispatch fired on pgElevated *after* the wrap committed (and the same for PATCH → `risk.updated`).
- **audit-survives** — non-awaited `writeAuditEvent` on review lands on pgElevated.
- **post-COMMIT-throw** (review-specific): see §4.3.

**Cross-org tripwires (labeled "WHERE-clause isolation — RLS certification deferred to Batch A"):**
- GET `/risks`, `/risks/:id`, `/risks/intelligence`, `/risks/:id/history`: cross-org list/get returns only the caller org's rows / 404. **These pass today via the handler's `WHERE organization_id = $2` clause, not RLS.** They exist as **tripwires**: if a future refactor drops a `WHERE org` clause before Batch A lands, the test still catches the cross-org regression. Each test comment states explicitly that it is WHERE-clause isolation, not a policy proof.
- review / PATCH on org B's risk under org A's key → 404 / unchanged (same tripwire character).
- GET `/risks/summary`, `/risks/:id/history`: cross-org tripwire **plus** the §6-risk-1 regression assertion — after serialization (§2.1) assert **no** `client.query while already executing` warning is emitted under the wrap. (This assertion is RLS-independent — it is a single-tenant-client concurrency property and is part of what γ.1 certifies.)

**Estimate: ~6–9 isolation/shape tests, down from the original ~14** (the ~5 RLS-certification assertions are removed; the cross-org probes are retained but reclassified as tripwires).

### 4.2 Unit suite deltas — including the serialization-order guard tests (DECIDED Q1 → option a)
`buildRiskSummary` / `buildRiskIntelligenceList` are pure and already unit-tested; the wrap doesn't touch them. The serialization (§2.1) adds these **required** tests so a future refactor back to `Promise.all` (which would re-introduce the single-client concurrency hazard) is caught:

- **summary serialization-order guard** — spy on `pg.query` (or the handler's client-`query`), invoke GET `/risks/summary`, and assert the 6 aggregate queries fire **sequentially in order** (call N resolves before call N+1 is issued — e.g. assert no second `query` call starts before the first's promise settles, or assert exact call-order against the 6 known SQL fragments). This pins "one in-flight query at a time," which is the property that removes the DeprecationWarning. It is a *structural* assertion (call ordering), **not** a latency assertion.
- **history serialization-order guard** — same spy approach: assert the events query is issued and settled **before** the count query (and that neither is an eagerly-started promise). Pins the §2.1(ii) eager-promise removal specifically.
- **aggregate-equivalence** — assert summary/history return byte-identical response bodies before vs after serialization (guards against an accidental query-text or binding change during the refactor).

Existing route tests run unchanged (the wrap is transparent to response contracts). Estimated total: **~6–9 isolation/shape (§4.1, retargeted) + ~5 unit** (~3 serialization-guard + ~2 equivalence), ~140 LOC.

### 4.3 The post-COMMIT-throw pinning test — atomicity-on-post-commit-failure (the wrap's structural improvement)
**A new, risks-specific test is required, and (revised) its job is to PIN the REAL behavior the wrap produces — request atomicity — NOT the "preserve" outcome the original analysis wrongly assumed.** β1.5's headline test forces a **COMMIT failure** (durability path → `tenant_commit_failed`). β2's tests cover findings writes whose success path ends in a single `res.json` immediately after the wrap's COMMIT — findings has **no post-COMMIT ambient query that can throw**. review's `:1189` post-commit SELECT is a **new shape** β2 never exercised: a handler-internal throw *after* the inner savepoint COMMIT but *before* the wrap's outer COMMIT.

**Empirically verified (2026-06-03):** when the refresh throws a real PG error, the wrap **atomically rolls back** the review UPDATE (§3.3 corrected). The mismatched-pop guard keeps the stray bare ROLLBACK off the outer tx, but the aborted connection makes the outer `COMMIT` a silent `ROLLBACK`.

**Pinning test (required):** force `:1186` (re-anchored; the post-commit refresh `SELECT ${RISK_SELECT} FROM risks WHERE id=$1 AND organization_id=$2`) to throw a real PG error — induced by dropping a `RISK_SELECT`-only column (e.g. `treatment`, which the ownership SELECT and the UPDATE do **not** reference, so the inner tx work succeeds and only the refresh errors) — then assert the **real, atomic** outcome:
- (a) the response is **500** (`risk_review_failed`);
- (b) the review row is **NOT** persisted (`last_reviewed_at IS NULL` after) — the wrap rolled the UPDATE back atomically (today's "write persists despite 500" quirk is **fixed** by the wrap);
- (c) **no** `tenant_commit_failed` event fires — this is the **query-error mode**: the aborted-tx `COMMIT` becomes a no-error `ROLLBACK`, so COMMIT does not throw. The only error logged is the handler's own `risk_review_failed`. (The test comment documents the two failure modes: **query error → silent rollback, no event**; **connection death → `tenant_commit_failed` fires**. This test pins the **query-error mode** specifically.)

This test pins the **atomicity improvement** the wrap delivers and will fail loudly if a future change re-introduces the persist-despite-500 quirk (e.g. moving the refresh pre-COMMIT or running it on a separate connection) — making that a conscious, reviewed change. This is the single highest-value new test in γ.1.

---

## 5. What this catches vs. what it doesn't (honest residuals)

**Catches (γ.1 — validated by the role-simulation harness):** the per-request **transaction shape** on all 8 risks routes — every ambient `pg.query`/`pg.connect()` routed onto one tenant client — plus **commit-before-respond** durability on the three writes, **savepoint safety** on the two explicit-tx writes, and **serialization correctness** on summary/history. γ.1 does **NOT** make risks RLS-isolated (see the first "does not catch" bullet). It *prepares* every route for the future Batch-A policy.

**Catches — request atomicity on the review POST (a structural improvement, verified §4.3).** A real PG error on review's post-commit refresh SELECT now **atomically rolls back** the review UPDATE: today's "write persists despite 500" quirk is **fixed by the wrap as a side effect**, not as a deliberate feature. This is a **behavior change** from today's unwrapped path and is the **more correct** semantics — the client gets a 500 with no persisted row, so a retry is safe (no duplicate review, no phantom row). See §3.3 (corrected mechanism) and §9 decision 2 (rewritten).

**Does NOT catch / out of γ.1's reach:**
- **RLS cross-org isolation for `risks`** — the `risks` table has **no RLS policy yet** (scheduled for phase-3 Batch A; the only policy in the migration set today is the findings pilot). The wrap *prepares* the route for the future policy; isolation **certification** lands with the Batch-A migration after the post-γ.1 7-day cook. Under `app_request` as it currently stands, cross-org isolation on these routes is enforced by the handlers' `WHERE organization_id = $2` clauses, **not** by the database. This is the same shape **every** wrap-track PR will have until Batch A enables RLS per-table — see §4.0. Even *after* the operator flips `DATABASE_URL → app_request`, the GUC `asTenant` sets has **no** database-level effect on `risks` until that Batch-A policy exists.
- **Fire-and-forget channels** — `dispatchWebhookEvent` and `writeAuditEvent` run on **pgElevated** (owner pool), deliberately *outside* the tenant scope. They are not RLS-isolated by this wrap (by design; β1 + auditLog own that channel). The dispatch-survives tests prove they still fire post-commit, not that they are tenant-scoped.
- **The dead webhook retry loop** (`finding_webhook_retry_loop_dead.md`) — unchanged; orthogonal.
- **(was listed here as out-of-reach) The "500 despite persisted write" quirk** on review's post-commit SELECT — **now FIXED by the wrap** (atomic rollback, §3.3 corrected / §9 decision 2). Moved into "Catches" above; no longer a residual.
- **`Promise.all` parallelism** on summary/history — under the wrap these serialize on the single tenant client regardless (§6-risk-1). γ.1 makes them *correct* (§2.1, option a) but cannot make them *parallel* inside one transaction.
- **Failure-mode observability gap (post-commit-ambient-query paths).** A **query-mode** failure on a post-commit-ambient-query path (review's refresh) produces a **silent rollback** at the wrap: Postgres turns the aborted-tx `COMMIT` into a no-error `ROLLBACK`, so **no `tenant_commit_failed` fires** (COMMIT did not throw). The only signal is the handler's own error log (`risk_review_failed` here). A **connection-death** failure on the same path **does** fire `tenant_commit_failed` (the `COMMIT` itself throws). Document this two-mode asymmetry; do not paper over it. The write is lost (atomically) in **both** modes — only the operator-visible signal differs.

**Residual — `Promise.all`-on-a-single-tenant-client is a GENERAL hazard for every future wrap, not a risks-only quirk.** The standing pre-wrap audits today are **fire-and-forget** (connection lifecycle) and **streaming-guard** (response lifecycle). This γ.1 pass surfaced a **third** axis the umbrella's per-family audit did not enumerate: **concurrent in-flight queries on the wrap's single tenant client** (query-concurrency lifecycle). It bit `postureSnapshot.ts` first (the item-5 landmine in `project_a04_g1_pr7_flip_reconcile.md`), and `risks.ts` here; γ.2 (posture) and γ.3 (vendorAssessments), plus the whole deferred CRUD sweep, must be checked for it too. Any handler that (a) issues `Promise.all([...pg.query...])`, or (b) binds eager `const p = pg.query(...)` promises and awaits them together, or (c) calls a shared lib that fans out concurrently (e.g. `computeAndSavePostureSnapshot`'s 7-query fan-out — relevant to γ.2), will serialize-with-warning under pg 8.x and **throw under pg@9**.
  → **Action to fold into the γ-umbrella doc when γ.1 lands:** add a **"concurrent-query audit"** as the third standing pre-wrap check (alongside fire-and-forget and streaming-guard), with the grep heuristics above and the remediation (serialize inside the wrap, or push the fan-out behind a single combined query / a `pgElevated` read if it is legitimately cross-cutting). Promote it to a standing-rule memory (`feedback_route_wrap_concurrent_query.md`) sibling to the existing two route-wrap feedback rules. *(This doc update is the record; the umbrella/memory edits happen at γ.1-land time, not now.)*

---

## 6. Failure modes

| Event | What happens to the request / tx / response |
|---|---|
| **Handler throws** (uncaught) | `withTenant` ROLLBACKs the outer tx; β1.5 discards the buffer; `res.headersSent` still false → `errorHandler` sends 500; logs `tenant_wrap_handler_failed`. (Most risks handlers catch internally and send their own 5xx → they *resolve*, so the request tx COMMITs — for the catch paths that already ROLLBACKed their savepoint, the outer COMMIT is empty.) |
| **Outer COMMIT fails** (connection death / Render failover / deferred constraint) | `withTenant` rejects; buffer discarded; 500 sent; logs `tenant_commit_failed` (**durability incident** — distinct signal, `ops_signal_tenant_commit_failed.md`). The write did **not** persist. |
| **Inner savepoint ROLLBACK** (404 / invalid-owner / catch paths) | Rolls back only `sp_1`, not the request tx (mismatched-pop guard protects the empty-stack case). Outer tx commits whatever non-savepoint work remains (nothing risk-mutating on these paths). |
| **γ.0 guard trips** (future drift introduces a non-bare control statement on the savepoint client) | `TenantWrapUnrewriteableStatementError` thrown synchronously before the statement reaches `ctx.client` → handler throws → ROLLBACK → 500. Inert today (none of the 8 handlers contain such a statement). |
| **No org context** | Handler runs unwrapped with the real `res` (no buffering, no scope); its own `organization_context_missing` 403 fires. |

**§6-risk-1 — concurrent queries on the single tenant client (NEW; not flagged by the umbrella for reads).** Wrapping GET `/risks/summary` (6-query `Promise.all` `:550`) and GET `/risks/:id/history` (2-query `Promise.all` `:982`) routes every concurrent `pg.query` onto the **single** `ctx.client`. node-postgres cannot run concurrent queries on one client. This is the exact **item-5 landmine** documented in `project_a04_g1_pr7_flip_reconcile.md` (originally found on `postureSnapshot.ts`'s 7-query fan-out). Behavior:
- **Today (pg 8.20.0):** the queries are queued and serialized, emitting `DeprecationWarning: Calling client.query() when the client is already executing a query … will be removed in pg@9.0`. Functionally correct, but the `Promise.all` parallelism becomes illusory and prod logs gain a warning per such request.
- **Under a future pg@9 bump:** this **throws** — the two routes would 500.

Crucially, **this fires the moment the route is wrapped, pre-flip** — it is a property of the single-client `withTenant` scope, *not* of RLS, so unlike the isolation change it is **not** inert until the flip. Wrapping summary/history without addressing it would start emitting DeprecationWarnings in engine prod logs on γ.1 deploy. → **RESOLVED: §2.1 serializes both (option a).** The prod-verify step (§7) asserts the warning is absent on live risks traffic.

---

## 7. Rollout

Same discipline as β1.5 / β2 / γ.0:
1. Implement on a feature branch off `develop` (`feat/a04-g1-pr-gamma1-risks-wrap`).
2. Land on `develop` via PR; CI must pass all 7 gates (typecheck, lint, test, audit, build, cross-org-isolation, tenant-coverage). The lint gate now includes γ.0's `no-unrewriteable-stmt-in-tenant-wrap` rule, which will scope-check the newly-`asTenant`-wrapped risks handlers.
3. Promote `develop → main` via a dedicated `chore/promote-pr-gamma1-to-main` branch, **`gh pr merge --merge` (never squash)** (`feedback_branch_sync_merge_strategy.md`).
4. **Prod-verify before γ.2 starts:** engine prod `/version` reflects the new SHA; engine prod + staging logs show **no** `tenant_wrap_handler_failed` / `tenant_commit_failed` on live risks traffic, and **no** `client.query while already executing` warnings (the §6-risk-1 regression signal). γ.2 (posture) does not begin until γ.1 is prod-verified.

γ.1 → γ.2 → γ.3 are independent (different tables, no shared handler) and *may* land in parallel, but the recommended order does risks first so its savepoint + dispatch harness de-risks γ.3.

---

## 8. Out of scope

- **The `risks` RLS policy migration (ENABLE RLS + NULLIF tenant policy)** — **Phase 3 Batch A**, a separate migration with its own staging gate, landing *after* a 7-day cook of the phase-2/γ wrap work on main (`A04-G1-rls-rollout-plan.md:294,297`). γ.1 is wrap-only and deliberately does **not** add it; bundling it here would pull Batch-A work into the wrap track and break the per-batch staging-gate discipline. RLS isolation for `risks` is certified by that migration, not by γ.1 (§4.0, §5).
- **γ.2 (posture)** — including the §2.3 inner-`withTenant` removal in `POST /posture/snapshot`. γ.1 **does not touch `posture.ts`** (confirmed: no posture import or route in `risks.ts`). The posture refactor is γ.2's reviewable unit.
- **γ.3 (vendorAssessments)** — its explicit-tx POST mirrors the risks pattern; separate PR.
- **The broader risk\*/vendor\* CRUD sweep** (`vendors` minus `export.csv`, `vendorReviews`, `riskTreatments`, `riskControlLinks`, `riskObligationLinks`, `riskScale`, `riskScoringWeights`, `riskSettings`, `vendorSignalContext`) — pass both audits but carry no webhook dispatch; deferred to the plain-CRUD sweep (umbrella §6).
- **`vendors/export.csv`** (streaming-guard BLOCKED) and **`vendorAssessmentAnalysis`** (LLM split) — δ track.
- ~~The pre-existing review post-commit-SELECT "500 despite persisted write" quirk~~ — **no longer out of scope: the wrap FIXES it** (atomic rollback on refresh failure, §3.3 corrected / §9 decision 2 / §4.3). Kept here struck-through as a pointer for anyone arriving from the old plan.
- **The dead webhook retry loop** — its own ticket.

---

## 9. Operator decisions (RESOLVED — pinned 2026-06-03)

1. **[NEW — not anticipated by the umbrella] The two `Promise.all` read routes (summary `:550`, history `:982`) collide on the single tenant client under the wrap (§6-risk-1, the item-5 landmine).** → **RESOLVED: option (a) — serialize both `Promise.all`s into sequential `await`s as part of γ.1.** Rationale (operator): this is the read-route analogue of γ.2's posture refactor (route-internal restructuring to fit the wrap's transaction model); option (b) defers leave the family partially wrapped, violating β2's "each family lands as a coherent unit" pattern; option (c)'s separate pg checkout defeats the single-transaction guarantee for those reads, which is the point of the wrap. Specified in **§2.1** (exact sequential code shape + latency note) and guarded by the order-assertion tests in **§4.2**.
   - *(rejected) (b) wrap all 8, accept the DeprecationWarning* — relies on pg 8.x queuing; hard 500 under any pg@9 bump.
   - *(rejected) (c) defer summary + history to a later PR* — leaves two risks reads un-isolated after γ.1.

2. **[Savepoint edge β2 did not exercise] The review post-COMMIT-throw path (§3.3).** → **RESOLVED (revised 2026-06-03 after empirical verification): γ.1 makes the review POST atomic on post-commit refresh failure.** This is a **behavior change** from today (today the write persisted despite the 500). The wrap's atomicity is the **correct** semantics — atomic-on-error is a security/correctness improvement: today's "500 to client + silently persisted write" leaves a client unable to safely retry (retry → duplicate review; no retry → phantom row); under γ.1 the write is rolled back, so a retry is safe. The original **"preserve-not-fix"** framing was based on a §3.3 analysis that **missed Postgres's aborted-tx `COMMIT`-becomes-`ROLLBACK` mechanic** (verified: a real PG error on the refresh aborts `ctx.client`, and the outer `COMMIT` silently rolls back). **No handler-level change is needed — the wrap delivers the improvement structurally.** Empirically verified by the rewritten **§4.3 pinning test**, which pins the real (atomic) behavior so any future change to it is conscious and reviewed.

3. **[No unexpected fire-and-forget] Confirmation only — noted, no decision needed.** The fire-and-forget audit found **only** the two known channels — `writeAuditEvent` and `dispatchWebhookEvent`, both pgElevated, both verified by β1/auditLog. **No queue enqueue, no metric emit, no `setImmediate`/`setTimeout`, no other unawaited ambient-`pg` work** in any of the 8 handlers. No route is BLOCKED by either standing-rule audit.

---

## 10. Summary

- **Inventory matches** the umbrella exactly: 8 routes = 3 writes (1 plain POST + 2 explicit-tx) + 5 reads. No stop condition.
- **Both standing-rule audits PASS for all 8 routes.** Fire-and-forget: only `writeAuditEvent` + `dispatchWebhookEvent`, both pgElevated. Streaming: zero `res.write/pipe/send/end/setHeader/cookie/redirect/type` hits; every handler ends in a single `res.status(n).json()`.
- **Both explicit-tx writes are savepoint-safe by construction** — `pg` proxy + bare `BEGIN/COMMIT/ROLLBACK`, depth ≤ 1, all early-return paths balance the stack. The **review post-COMMIT-throw path is atomic-on-error**: the mismatched-pop guard keeps the stray bare ROLLBACK off the outer tx, and a real PG error on the refresh aborts the connection so the outer `COMMIT` cleanly rolls the request back (today's "persist despite 500" quirk is **fixed** — §3.3 corrected; pinned by §4.3).
- **One NEW finding the umbrella missed:** the summary/history `Promise.all`s collide on the single tenant client (item-5 landmine), and they fire **pre-flip** on wrap — **RESOLVED (option a): §2.1 serializes both** into sequential awaits, guarded by §4.2 order-assertion tests. Generalized in §5 as a recommended third standing "concurrent-query audit" to fold into the umbrella when γ.1 lands.
- **γ.1 certifies transaction-shape, NOT RLS isolation, for `risks`.** What γ.1 catches: savepoint safety + commit-before-respond on the 2 explicit-tx writes, serialization correctness on summary/history, and **review request atomicity on post-commit refresh failure** (the wrap fixes the "persist despite 500" quirk — pinned by §4.3). What γ.1 does **NOT** catch: **RLS cross-org isolation for `risks` — deferred to Phase-3 Batch A** (no `risks` policy exists; the only policy is the findings pilot). The two test-certification axes (transaction-shape vs RLS-isolation) are separated in §4.0; the original §4.1 plan conflated them. This is the shape **every** wrap-track PR has until its table's Batch-A RLS migration lands.
- **γ.1 touches only `risks.ts`** (+ a new isolation/shape test). No posture, no infra, no `asTenant`/savepoint changes, **no `risks` RLS migration** (Batch A — §8). The wrap is inert today (owner-cred), and for `risks` it stays isolation-inert even post-flip until the Batch-A policy exists.

**STOP — design only. No route files touched. γ.2 not started.**

---

## 11. Cross-PR follow-ups (queued — do NOT action in γ.1)

1. **γ-umbrella doc carries the same false framing for γ.2 and γ.3.** `docs/A04-G1-pr-gamma-design.md` (on `main` as of `ad8dc7c9`) describes the γ-family certifying tests in RLS terms (`:172` cross-org "RLS isolation of the write", `:175` "Fail-closed … NULLIF policy", `:209` "inert pre-flip … live isolation change … after the flip"). **Neither `posture_snapshots` nor `vendor_assessments` has an RLS policy either** — both are Phase-3 sweep tables (`posture_snapshots` in Batch A alongside `risks`; `vendor_assessments` matches `*_assessments` → Batch C — distinct from the `vendor_assurance_*` suite in Batch D), same situation as `risks`. So γ.2 and γ.3 will hit this **identical** conflict: the wrap is a transaction-shape change; RLS isolation is certified later, per-table, by the Batch A/D migrations. The umbrella's "certifying" framing must be corrected to separate the **transaction-shape** axis (certified by the γ wrap PRs) from the **RLS-isolation** axis (certified by the phase-3 batch migrations) — the §4.0 distinction in this doc, lifted up to the family level.
   - **Why not fix it here:** the umbrella is on `main`; editing it needs its own PR. γ.1 cannot touch it.
   - **Action owner:** fold the correction into **γ.2's design pass** (it must re-derive the same finding for `posture.ts` anyway) **or** a standalone doc-sync PR — whichever lands first. Until then, this §11 is the durable record so the finding is not re-discovered from scratch three times.
2. **Third standing pre-wrap audit axis — "concurrent-query audit."** Per §5, fold the single-tenant-client concurrent-query check into the umbrella as the third standing audit (alongside fire-and-forget and streaming-guard) and promote it to a `feedback_route_wrap_concurrent_query.md` memory, sibling to the existing two route-wrap rules. Same "happens at γ.1-land time, not now" note as §5.
3. **Fourth standing pre-wrap audit axis — "post-commit-ambient-query audit" (generalizes the §3.3 atomicity finding).** Any handler that issues an ambient `pg.query` **AFTER** its explicit COMMIT but **BEFORE** the wrap's outer COMMIT will have its write **atomically rolled back** if that post-commit query throws — because of Postgres's aborted-tx `COMMIT`-becomes-`ROLLBACK` mechanic (§3.3), **not** anything wrap-specific. This is correct behavior, but it is a **wrap-level property** that γ.2 (posture) and γ.3 (vendorAssessments) — and the deferred CRUD sweep — must audit for. Add a **fourth** standing pre-wrap audit axis to the umbrella when γ.1 lands (alongside fire-and-forget, streaming-guard, and concurrent-query) and promote to `feedback_route_wrap_post_commit_ambient_query.md`. The audit asks: **does this handler issue any `pg.query` after its explicit COMMIT and before the response?** If yes, document that the write is now atomic-on-error (an improvement); flag any case where today's persisted-despite-500 behavior is actually load-bearing for a client expecting that semantic (none expected — but the audit forces the check). For risks, **only `POST /risks/:id/review`** has this shape (verified; PATCH's post-commit work is pure-compute + pgElevated fire-and-forget).

**STOP — design only. No route files touched. No implementation started. γ.2 not started.**
