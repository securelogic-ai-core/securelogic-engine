# A04-G1 PR β — Design: close the fire-and-forget gap, then wrap findings POST/PATCH

**Status:** Design only. Uncommitted. Scratch branch `chore/a04-g1-pr-beta-design`.
**Base:** main @ `5e44c475` (PR α landed: `asTenant()` + findings GETs).
**Author path chosen by operator:** the *enterprise fix* — close the fire-and-forget gap properly, then wrap findings writes. **Not** the cheaper "skip findings writes, expand to another family" path.
**References:** `docs/A04-G1-request-scope-wrap-design.md` (§5 roadmap, §4.4 side-effect handling); `feedback_route_wrap_fire_and_forget.md` (the standing rule PR α surfaced).

---

## 1. Problem restatement

PR α wrapped the three findings **GET** routes in `asTenant()`. It deliberately left **POST** (`findings.ts:81`) and **PATCH** (`findings.ts:589`) unwrapped, with an inline comment (`findings.ts:66–80`) explaining why: both write handlers schedule **fire-and-forget** webhook dispatch that issues ambient `pg.query()` calls which are **not awaited**, so under a request-transaction wrap they would execute as continuations *after* the wrap commits and releases the tenant client — a **use-after-release** on the pooled connection.

The enterprise fix is to make the dispatcher own its own DB connection lifecycle, independent of the calling route's request transaction, so the write routes can be safely wrapped — and so that **every** future route family that dispatches webhooks (not just findings) is unblocked at once.

---

## 2. How the wrap and the scope actually interact (verified)

Read end-to-end this turn: `infra/postgres.ts`, `infra/tenantContext.ts` (via postgres.ts), `lib/webhookDispatcher.ts`, `lib/findingAlertTrigger.ts`, `lib/auditLog.ts`, `routes/findings.ts`.

### 2.1 The wrap (`asTenant` → `withTenant`)
`withTenant(orgId, fn)` (`postgres.ts:91`) unconditionally `pool.connect()`s a **fresh** client, runs `BEGIN` + `set_config('app.current_org_id', …, true)`, runs `fn` inside `tenantStorage.run(ctx, fn)` (AsyncLocalStorage), then `COMMIT` + `client.release()`. The `pg` proxy (`postgres.ts:71`) routes `pg.query()`/`pg.connect()` to `ctx.client` **iff** an ALS store is active, else to the raw `pool`.

**Key property:** `withTenant` does **not** detect nesting. A nested `withTenant` opens its **own** independent client + transaction; `tenantStorage.run` replaces the ALS store for the inner scope. This is what makes the two "safe" side-effects safe — see below.

### 2.2 The three side-effects in the findings write handlers
| Call site | Awaited? | DB channel | Verdict under a wrap |
|---|---|---|---|
| `writeAuditEvent(...)` (`findings.ts:181`, `:696`) | No (`void _writeAsync`) | **`pgElevated`** (`auditLog.ts:66`) | **SAFE** — owner pool, never touches the tenant client. The proxy is bypassed entirely. |
| `triggerFindingAlert(...)` (`findings.ts:192`) | No (`doTrigger().catch()`) | opens its **own** `withTenant(orgId, …)` (`findingAlertTrigger.ts:31`) | **SAFE** — the nested `withTenant` acquires a *fresh* client via `pool.connect()`; the parent client being released is irrelevant. Per-recipient email sends are themselves non-awaited and do no DB I/O. |
| `dispatchWebhookEvent(...).catch()` (`findings.ts:200`, `:710`) | No | ambient **`pg` proxy** (`webhookDispatcher.ts:19,60,122,132,168,181,186,196` — 8 sites) | **BLOCKED** — routes to whatever ALS store is active. Under the wrap, its continuations run after COMMIT/release → use-after-release. |

So the audit in `feedback_route_wrap_fire_and_forget.md` is confirmed exactly: auditLog safe (pgElevated), findingAlert safe (own withTenant), dispatcher blocked (ambient pg, not awaited).

### 2.3 Why the dispatcher is the *only* blocker, precisely
`dispatchWebhookEvent` (`webhookDispatcher.ts:18`) awaits a tenant-scoped `SELECT` from `webhook_endpoints`, then **fires `deliverWebhook(...)` per endpoint without awaiting** (`:46–50`). `deliverWebhook` then: `INSERT webhook_deliveries (status='pending')` → 10s network `fetch` → `UPDATE webhook_deliveries`/`webhook_endpoints`, with `scheduleRetry` issuing further `UPDATE`s. Every one of these uses the ambient `pg` proxy.

Today the findings write routes are **unwrapped**, so there is no ALS store when these run → the proxy falls through to the raw `pool` (owner) → it works. The moment the route is wrapped, the continuations inherit the wrap's ALS store and target the committed-and-released tenant client.

**Note — even `await dispatchWebhookEvent(...)` would not fix this**, because the inner `deliverWebhook(...)` calls are not awaited by the dispatcher itself (`:47`). Awaiting only the outer function still lets the DB-writing continuations escape. (This rules out the naive Option 1; see §4.)

---

## 3. Dispatcher side-effect inventory (Phase 3 answers)

**(a) What it does at the DB level.** Across `webhook_endpoints` (read) and `webhook_deliveries` (insert + update), plus `webhook_endpoints` failure-count updates. All via the ambient `pg` proxy. No explicit transaction — each statement is autocommit (matching the current no-scope/raw-pool behavior).

**(b) Tenant- or platform-scoped?** Both tables are **CUSTOMER-DATA, `organization_id NOT NULL`** (`table-classification.md:128–129`). *But*: every dispatcher query already **explicitly** filters/writes `organization_id` from the event payload — it never relies on an ambient GUC for correctness. And the classification doc already routes the sibling enumeration (`startupCheck.ts:87`, full `webhook_endpoints` scan at boot) through the **owner/elevated path** because it has no request context. The dispatcher is the same shape: infrastructure that runs **outside** the request transaction lifecycle. It is conceptually single-org per invocation but architecturally an out-of-band concern.

**(c) Failure-tolerance contract.** Best-effort. `findings.ts:200/710` call `.catch(() => {})`; `auditLog`/`alertTrigger` likewise swallow. Delivery bookkeeping (`webhook_deliveries` rows, attempt counts, endpoint auto-disable after 10 consecutive failures) is recorded but **never blocks or fails the originating request**. The 10s `fetch` timeout lives entirely off the request path today. **Any fix must preserve this:** the request must not start blocking on webhook network delivery.

**(d) Retry / queue / recovery.** `scheduleRetry` writes `status='retrying'` + `next_retry_at` to `webhook_deliveries`. **There is no consumer.** `next_retry_at` is read only by the display endpoint `webhooks.ts:538` (GET deliveries listing). No worker/cron re-fires scheduled retries (grep confirmed: the `intelligence-worker` "retrying" hits are pipeline retries, unrelated). So "retrying" is presently bookkeeping, not an active retry loop — there is **no out-of-band worker scope to coordinate with**, and no downstream SLA hanging off these rows. (Worth flagging to the operator as a separate gap; not in β scope.)

**Other callers of the dispatcher (blast radius of any fix):** `risks.ts:387,1429`, `posture.ts:118`, `vendorAssessments.ts:271`, `findings.ts:200,710` — and `deliverWebhook` directly from `webhooks.ts:483` (the awaited "send test event" route). **None of these routes are wrapped yet.** A dispatcher fix therefore unblocks *all* of these families' write paths for γ/δ, not just findings.

---

## 4. Design options

### Option 1 — Await the dispatcher inline (inside the wrap)
Await `dispatchWebhookEvent(...)` (and make it await each `deliverWebhook`) so all DB writes complete before COMMIT.
- **Pros:** conceptually simplest; everything runs in-scope on the live tenant client.
- **Cons:** **Breaks the fire-and-forget contract (3c).** It holds a DB transaction open across the per-endpoint 10s network `fetch`; a slow/hostile webhook endpoint now stalls the customer's HTTP request and pins a tenant connection for up to 10s × N endpoints. This is a latency + connection-pool regression and directly contradicts the design doc's §4.4 ("never hold a DB transaction across an external call"). **Rejected.**

### Option 2 — Move the dispatcher's DB work to `pgElevated` (RECOMMENDED)
Switch `webhookDispatcher.ts` from the ambient `pg` proxy to `pgElevated` for all 8 query sites. The network `fetch` stays exactly where it is (fire-and-forget, off the request path).
- **Pros:**
  - **Closes the use-after-release** completely: `pgElevated` is a separate pool; its `.query()` bypasses the proxy and the ALS store entirely, so the dispatcher's connection lifecycle is wholly independent of the calling route's request transaction.
  - **Preserves the fire-and-forget contract** (3c): the slow part (network) is untouched; DB writes remain autocommit single statements, exactly as today.
  - **Behavior-preserving today:** pre-flip `pgElevated` targets the same owner DB as `pool` (`elevatedUrl = MIGRATION_DATABASE_URL ?? DATABASE_URL`, currently unset → identical). And today the dispatcher already runs on the owner pool (unwrapped routes → raw pool). So this is a **runtime no-op now**, and post-flip it keeps the dispatcher on the owner channel instead of following a wrapped route's tenant scope.
  - **Durable & non-recurring:** uses the *exact established pattern* already applied to `auditLog` (`auditLog.ts:60–66`, "writes go through pgElevated … outside any tenant scope") and consistent with the classification doc routing webhook enumeration through owner. It fixes the dispatcher once for **all** caller families — findings, risks, posture, vendorAssessments — so γ/δ never re-solve it.
- **Cons:**
  - Post-flip the dispatcher bypasses any RLS that `webhook_endpoints`/`webhook_deliveries` might later get on the `app_request` channel. **Compensating control:** every query already filters explicitly by `organization_id`. This is the *same* accepted tradeoff as `security_audit_log` (also CUSTOMER-DATA-adjacent, also on `pgElevated`) and the startup enumeration. Acceptable and precedented; flag it in the rollout plan.
  - Requires confidence that `pgElevated` autocommit-per-statement matches today's semantics — it does (current ambient-no-scope path is also pool autocommit).

### Option 3 — Transactional outbox + worker
Write an `webhook_outbox` row inside the wrap (in-scope, safe); a new worker reads the outbox and dispatches with its own scope.
- **Pros:** most robust; true decoupling; real retry/recovery (which 3d shows is currently missing).
- **Cons:** **Disproportionate to β.** New table, new worker, picking/locking/dedup semantics, deployment wiring (a new Render service or a cron in an existing worker), backfill of the existing retry bookkeeping. This is its own PR sequence and arguably its own goal (A04-G-something "webhook delivery durability"), not a prerequisite for the RLS wrap. **Defer** — but note it as the natural home for fixing the dead `next_retry_at` retry loop (3d) later.

---

## 5. Recommendation

**Adopt Option 2 (`pgElevated` for the dispatcher), and split β into two PRs.**

Against the four criteria:
- **(a) Preserves fire-and-forget / no latency regression:** ✅ network stays off the request path; DB writes stay autocommit. Option 1 fails this; Option 2 and 3 pass.
- **(b) Closes use-after-release:** ✅ the dispatcher no longer touches the request's tenant client under any caller scope.
- **(c) Bounded scope:** ✅ Option 2 is an ~8-site, single-file channel swap plus tests. Option 3 is weeks.
- **(d) Durable, not a patch future families re-solve:** ✅ it fixes shared infra once for all five caller sites and mirrors the auditLog precedent. A per-route band-aid would not.

### Why two PRs (honest opinion)
The dispatcher is **shared infrastructure** consumed by four route families beyond findings. Changing its DB channel is a behavior-touching change whose blast radius is "all webhook dispatch," and it should be reviewed and tested *as an infra change in isolation* — not conflated with the findings-specific wrap. Therefore:

- **PR β1 — dispatcher → `pgElevated` (infra only).** No route wrapping. Runtime no-op today. Independently testable (dispatch is correct whether or not an ambient `withTenant` scope is active). Unblocks every webhook-dispatching route family for γ/δ.
- **PR β2 — wrap findings POST/PATCH.** Depends on β1. Wraps the two write handlers in `asTenant()`, removes the deferral comment, adds the integration test that proves the writes are tenant-isolated *and* that dispatch still fires cleanly under the wrap.

This matches the design doc's own philosophy (§5: "incremental … each step provably safe … small, reviewable"). If the operator prefers a single PR, β1+β2 can ship together — but the two-commit structure should be preserved for reviewability, and the test in β2 is what certifies β1 was correct.

---

## 6. Concrete PR scope

### PR β1 — dispatcher channel swap
- **Files changed:**
  - `src/api/lib/webhookDispatcher.ts` — replace the 8 `pg.query(...)` calls (`:19, :60, :122, :132, :168, :181, :186, :196`) with `pgElevated.query(...)`; swap the import (`pg` → `pgElevated`). Add a header comment mirroring `auditLog.ts:60` explaining the elevated-channel rationale + the explicit-org-scoping compensating control.
  - `src/api/__tests__/webhookDispatcher.test.ts` — extend: a test that calls `dispatchWebhookEvent` / `deliverWebhook` **inside an active `withTenant(orgId, …)` scope** and asserts the delivery row is written correctly (proving it used the elevated pool, not the tenant client). The existing SSRF tests must continue to pass unchanged.
- **Routes wrapped:** none.
- **Runtime impact:** zero today (owner == elevated pre-flip; dispatcher already on owner via unwrapped routes).
- **Size:** ~1 file substantive (≈8 line edits + header), 1 test file (+1–2 cases). Small / low complexity.

### PR β2 — wrap findings writes (depends on β1)
- **Files changed:**
  - `src/api/routes/findings.ts` — wrap the POST handler (`:86`) and PATCH handler (`:594`) bodies in `asTenant(async (req,res) => { … })` (matching the GET pattern at `:235/:441/:510`); delete the deferral comment block (`:66–80`).
  - `test/isolation/findingsTenantWrap.test.ts` — add write-path cases (see §6 tests below).
- **Routes wrapped:** `POST /api/findings`, `PATCH /api/findings/:id`. (After β2, all five findings routes are wrapped; findings is the first fully-wrapped family.)
- **Runtime impact:** zero today (engine still owner-cred → wrap GUC is a no-op, per PR α).
- **Size:** ~2 handler wraps + comment removal (small), plus ~3–4 test cases. Small / low complexity.

### Tests that would have caught the use-after-release
The canary must assert **positive completion** of the dispatcher's DB write, because the route swallows dispatch errors (`.catch(() => {})`) — a use-after-release would manifest as a *missing* `webhook_deliveries` row, not a thrown error.

1. **β1 dispatcher-level (deterministic):** within `withTenant(orgA, …)`, seed an active `webhook_endpoint` for `orgA`, call `dispatchWebhookEvent`/`deliverWebhook`, await it, assert a `webhook_deliveries` row exists for `orgA`. Against the *pre-fix* dispatcher this would route the INSERT to the tenant client; in the post-COMMIT continuation case (β2) that client is released → no row. β1's version proves the channel is independent of the active scope.
2. **β2 integration (under the role-simulation harness, like PR α's `findingsTenantWrap.test.ts` using `options=-c role=app_request`):**
   - POST a finding as `orgA`; assert 201 **and** that the finding row is visible only under `orgA`'s scope (RLS isolation of the write).
   - With an active `orgA` webhook endpoint seeded, POST and then poll `webhook_deliveries` (short timeout) for the delivery row — proving dispatch completed on a valid connection *after* the wrap committed. **This is the test that fails without β1.**
   - PATCH a finding's status as `orgA`; assert the `UPDATE` is org-scoped (cannot touch `orgB`'s finding) and dispatch fires.
   - Fail-closed control: an unscoped POST/PATCH (no GUC) writes nothing under `app_request` (NULLIF policy), consistent with `feedback_rls_policy_nullif.md`.

---

## 7. Open questions for the operator

1. **Fire-and-forget SLA.** §3c/§3d show delivery is best-effort with **no active retry consumer** (`next_retry_at` is written but never processed). Is that the intended contract, or is there a hidden expectation that scheduled retries actually re-fire? If the latter, that's a real gap (candidate for the Option 3 outbox/worker), independent of β.
2. **Other families opting in.** `risks`, `posture`, `vendorAssessments` also dispatch webhooks (§3) and are not wrapped. β1 unblocks them; do you want their write-path wraps folded into γ as a group, or sequenced per-family? (Recommendation: group them in γ now that the shared blocker is gone.)
3. **`webhook_endpoints`/`webhook_deliveries` RLS posture.** Both are CUSTOMER-DATA. Option 2 keeps the dispatcher on the owner channel (explicit org-filtering as the control), matching `security_audit_log`. Confirm you accept that these two tables are enforced by explicit query-scoping rather than RLS on the dispatch path (they can still get RLS policies for the *request-path* reads in `webhooks.ts`). 
4. **One PR or two?** §5 recommends β1 (infra) + β2 (wrap) as separate PRs for reviewability. Confirm, or request a single combined PR with the two-commit structure preserved.
5. **`deliverWebhook` test route.** `webhooks.ts:483` awaits `deliverWebhook` inside a request handler. After β1 it runs on `pgElevated`; if that route is later wrapped (it's a CUSTOMER-DATA surface), confirm the elevated dispatch is the desired behavior there too (it should be — same infra concern).

---

## 8. Summary

- The only thing blocking findings POST/PATCH wrapping is the webhook dispatcher's use of the ambient `pg` proxy in non-awaited continuations. `auditLog` (pgElevated) and `findingAlertTrigger` (own withTenant) are already safe.
- **Recommended fix: Option 2** — move the dispatcher to `pgElevated`, mirroring the established `auditLog` pattern. It preserves the fire-and-forget contract, closes the use-after-release, is a runtime no-op today, and durably unblocks all five webhook-dispatching call sites.
- **Recommended structure: two PRs** — β1 (dispatcher infra swap, no wrapping) then β2 (wrap findings writes + the integration test that certifies β1).
- Option 1 rejected (latency/contract regression and doesn't even fix the inner non-awaited delivery). Option 3 (outbox/worker) deferred — disproportionate to β, but the right future home for the missing retry loop.
