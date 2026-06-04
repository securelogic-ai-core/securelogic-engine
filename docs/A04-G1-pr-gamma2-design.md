# A04-G1 PR γ.2 — Design: wrap the `posture` family in `asTenant()`

**Status:** Design only. No implementation. No branch, no route files touched. The read is the gate (same discipline as β1.5 / γ.0 / γ.1).
**Base:** main @ `188d503e` (γ.1 risks family landed + prod-verified).
**Scope:** second of three γ sub-PRs — γ.1 risks ✅ → **γ.2 posture** → γ.3 vendorAssessments. Smallest by route count (4) but carries the umbrella §2.3 inner-`withTenant` refactor.
**References:** `docs/A04-G1-pr-gamma-design.md` (umbrella; §2.3 refactor + §3 inventory — **carries stale RLS-certifying framing, corrected here, see §4.0 + §11**), `docs/A04-G1-pr-gamma1-design.md` (the shape this mirrors), `docs/A04-G1-rls-rollout-plan.md` (batch classification), the **four** standing pre-wrap rules `feedback_route_wrap_{fire_and_forget,streaming_guard,concurrent_query,post_commit_ambient_query}.md`.

All line numbers are point-in-time against `posture.ts` (360 ln) and `postureSnapshot.ts` (358 ln) at `188d503e`; **re-anchor at implementation time** — route+method/symbol is the durable anchor.

---

## 1. Scope — the 4 `posture` routes (verified line-by-line)

`posture.ts` registers exactly 4 routes. The explicit transaction is **not** in any route handler — it lives in the shared helper `computeAndSavePostureSnapshot` (`postureSnapshot.ts:60`), which POST calls.

| # | Route | Decl. line | Class | Detail |
|---|---|---|---|---|
| 1 | POST `/posture/snapshot` | 99 | **write (via helper)** | wraps helper in inner `withTenant` `:114` → **§2.2 refactor target**; dispatch `:118` (`.catch`); res 201 `:128`. Handler itself issues no `pg.query`/BEGIN — the tx is inside the helper. |
| 2 | GET `/posture/latest` | 156 | read | **2 sequential** `pg.query` (`:171` snapshot, `:198` domain_scores) — not `Promise.all`, no concurrent-query issue. |
| 3 | GET `/posture/history` | 249 | read | single `pg.query` `:269`. |
| 4 | GET `/posture/compliance-summary` | 308 | read | **`Promise.all` of 2 concurrent `pg.query` `:323`** (obligations `:324` + obligation_assessments `:333`) ⚠️ → **§2.1 serialization**. |

**Count: 1 write + 3 reads = 4.** Cross-reference vs umbrella §3 (`posture.ts` POST `:99` write, GET latest `:156`, GET history `:249`, GET compliance-summary `:308`): ✅ **MATCH.**

**`computeAndSavePostureSnapshot` (`postureSnapshot.ts:60`) — the actual explicit-tx writer.** Two call sites:
- `posture.ts:115` — the route (today wrapped in an inner `withTenant`).
- `services/posture-worker/src/index.ts:49` — the cron worker: `await withTenant(orgId, () => computeAndSavePostureSnapshot(orgId))`. **NOT a route, no `asTenant`** — its `withTenant` is the legitimate scope-establisher for the background path and **γ.2 MUST NOT touch it** (see §8).

Helper transaction shape (verified): a read phase (org profile `:64` + **7 sequential reads** `:112–189`) on the ambient `pg` proxy, then a write phase in an explicit transaction — `pg.connect()` `:255`, `BEGIN` `:257`, INSERT `posture_snapshots` (upsert) `:259`, `DELETE domain_scores` `:291`, INSERT `domain_scores` `:316`, `COMMIT` `:326`; catch `ROLLBACK` `:352`; finally `client.release()` `:355`.

---

## 2. The wrap mechanism — what changes per route

Identical to γ.1/β2: wrap each handler in `asTenant(async (req, res) => { … })`, inheriting β1.5 commit-before-respond. **No change** to `asTenant`, `withTenant`, `createSavepointClient`, the γ.0 guard, the dispatcher, `auditLog`, **or `computeAndSavePostureSnapshot` itself** (see §2.2 — the helper is already wrap-ready). `asTenant` sits after `attachOrganizationContext`, innermost around the handler.

The 3 GET routes + the POST route are all wrapped. Two of them carry a non-mechanical change (§2.1 compliance-summary, §2.2 POST refactor); `/posture/latest` and `/posture/history` are **pure mechanical wraps** (opener/closer only, no body change — latest's two queries are already sequential).

### 2.1 Serialize `GET /posture/compliance-summary` (concurrent-query axis — option (a), the γ.1 precedent)
The one `Promise.all`-on-the-tenant-client site in posture. Under the wrap both queries route to one `ctx.client` (can't multiplex → pg 8.20 `DeprecationWarning`, pg@9 throws; fires on wrap, not on flip). Serialize:
```js
// BEFORE (:323):
const [obligationResult, assessmentResult] = await Promise.all([
  pg.query(/* obligations GROUP BY status */),
  pg.query(/* obligation_assessments GROUP BY status */),
]);
// AFTER:
const obligationResult = await pg.query(/* obligations … */);
const assessmentResult = await pg.query(/* obligation_assessments … */);
```
`buildComplianceSummary(...)` call + response shape unchanged; query text byte-identical. Latency: ~+1 RTT (**~+1–3 ms**, two independent SELECTs) — same band as γ.1's `/risks/:id/history`.

### 2.2 Remove the inner `withTenant` in `POST /posture/snapshot` (umbrella §2.3) — and the finding that it's the *only* change needed
**Before (`:114-116`):**
```js
const result = await withTenant(organizationId, () =>
  computeAndSavePostureSnapshot(organizationId)
);
```
Under `asTenant`, the outer wrap already opened `withTenant(orgId, …)`. `withTenant` does **not** detect nesting — a second `withTenant` opens a **second, independent** pool client + transaction, so the snapshot would COMMIT on that inner client **before** the outer wrap commits (defeating β1.5 commit-before-respond) and burn two connections per request.

**After:**
```js
const result = await computeAndSavePostureSnapshot(organizationId);
```
The helper uses the ambient `pg` proxy for its reads (→ routes to the outer wrap's `ctx.client`) and `pg.connect()` for its write tx (→ returns `createSavepointClient(ctx)`, nesting its `BEGIN/COMMIT` as a savepoint inside the request tx; see §3). So it runs correctly inside the outer scope on one connection. Also: drop `withTenant` from the `posture.ts` import (`:17` `import { pg, withTenant }` → `import { pg }`; it has no other use in the file — verified) and add `import { asTenant }`.

**FINDING (surfaced, not papered over — §9-Q3 / §11): the helper is ALREADY wrap-ready; γ.2's helper-side work is ZERO.** The umbrella (§2.3 + §5) frames the refactor around a live **"7-query `Promise.all` fan-out"** in `computeAndSavePostureSnapshot` that would collide on the tenant client. **That fan-out was already serialized by PR 6** — `postureSnapshot.ts:95-111` documents the `Promise.all`→sequential conversion done when the worker's `withTenant` wrap landed, precisely to remove the single-tenant-client collision. So the concurrent-query hazard the umbrella anticipated **inside the helper is already closed**; the helper's explicit tx is already savepoint-safe (bare control statements, §3). **γ.2's entire non-mechanical surface is the two route-level edits above — there is no helper restructuring.** This is the γ.2 analogue of γ.1's "smaller/cleaner than the umbrella implied" finding (positive, not a blocker). The umbrella §5's "verify the 7-query fan-out" note is overtaken by events.

---

## 3. Savepoint-safety verification (the explicit tx lives in the helper)

Once §2.2 removes the inner `withTenant`, `computeAndSavePostureSnapshot` runs inside the route's `asTenant` scope, so its `pg.connect()` (`:255`) returns `createSavepointClient(ctx)`. Walk:

### 3.0 Preconditions
1. **Connects via the `pg` proxy.** `postureSnapshot.ts:10` `import { pg }`; `:255` `await pg.connect()` — not `pgRaw`, not a direct pool. ✅
2. **Bare control statements only.** `:257` `"BEGIN"`, `:326` `"COMMIT"`, `:352` `"ROLLBACK"` — all the exact single-arg form. No `BEGIN ISOLATION LEVEL`, no `SET TRANSACTION`, no advisory lock, no `LISTEN/NOTIFY`, no `COPY`. γ.0's runtime guard would throw on future drift; nothing trips it today. ✅

### 3.1 Stack walk (single `pg.connect()` → one savepoint client, its own `stack`)
`ctx.savepoint.n` starts at 0 (outer `withTenant` did the real `BEGIN` on `ctx.client`).

| Path | Statements | Stack | Outer-tx outcome |
|---|---|---|---|
| **Success** | BEGIN→`SAVEPOINT sp_1` (push); INSERT snapshot; DELETE domain_scores; INSERT domain_scores; COMMIT→`RELEASE sp_1` (pop) | `[sp_1]`→`[]` | writes folded into outer tx (not yet durable); helper returns → route dispatches (pgElevated) + buffers 201 → handler resolves → **outer COMMIT durably persists** → flush 201. ✅ commit-before-respond intact |
| **In-tx error / null-row throw `:288`** | BEGIN (push); a query errors *inside* sp_1 (or the `snapshotRow` null-check throws); catch runs ROLLBACK→`ROLLBACK TO sp_1; RELEASE sp_1` (pop); `throw err` re-raised | `[sp_1]`→`[]` | `ROLLBACK TO SAVEPOINT` **recovers** the outer tx from the aborted savepoint (25P02 cleared); helper re-throws → route `catch` logs `posture_snapshot_failed`, sends 500, **resolves** → outer COMMIT succeeds on the healthy tx, commits nothing posture-related. **500 + nothing persisted (atomic).** ✅ |

Exactly one BEGIN, depth ≤ 1, no nested BEGIN, `release()`→no-op under the wrap (outer `withTenant` owns the real client; on the no-org fall-through the helper isn't reached — the route 403s first). ✅

### 3.2 Post-commit-ambient-query (4th axis) — **does NOT apply to posture** (run-and-clear)
The review-POST atomicity quirk (γ.1 §3.3) needs an **ambient `pg.query` AFTER the savepoint RELEASE and before the response**, where there is no savepoint left to roll back to, so a thrown error aborts the connection and the outer `COMMIT` silently becomes a `ROLLBACK`. **Posture has no such query:**
- In the helper, everything after `COMMIT` `:326` is `logger.info` + `return` — no `pg.query`.
- In the route, after the helper returns, `dispatchWebhookEvent` is **pgElevated** (separate pool, not the tenant client) and `.catch()`-swallowed; then `res` (buffered). No ambient tenant-client query post-release.

So posture POST's error atomicity comes entirely from the **ordinary savepoint `ROLLBACK TO`** path (§3.1 row 2) — a clean recover-and-rollback, **not** the aborted-tx-silent-rollback mechanic. **There is no γ.1-style "behavior change vs today" to label** for posture: pre-refactor the inner `withTenant` already made the snapshot atomic on its own client; post-refactor it's atomic on the outer client. Either way an error → 500 → nothing persisted. The 4th-axis audit is **run and clear**, recorded here so it's on the record (not skipped).

---

## 4. Test plan

Harness: role-simulation suite under `app_request` (β2/γ.1 precedent). New file: `test/isolation/postureTenantWrap.test.ts`.

### 4.0 The two certification axes — what this file CAN and CANNOT prove for posture (mirrors γ.1 §4.0; the umbrella conflates them)
The β2 findings isolation tests are meaningful **only because `findings` carries the phase-2 pilot RLS policy**. **No posture table has an RLS policy** — verified: the only `ENABLE ROW LEVEL SECURITY`/`CREATE POLICY` in the migration set is `20260619_findings_rls_pilot.sql`. Per the rollout plan, the posture tables land RLS in **different phase-3 batches**:

| Table | Batch | Note |
|---|---|---|
| `posture_snapshots` | **Batch A** (rollout-plan `:297`) | with `risks`, after the post-γ wrap 7-day cook |
| `domain_scores` | **Batch G** (`:303`, "small remainder") | **split from `posture_snapshots`** — its RLS lands later/separately |
| `obligations` | later batch (read by compliance-summary) | no policy today |
| `obligation_assessments` | **Batch C** (`:299`, `*_assessments`) | no policy today |

| Axis | Property | Certified by | In γ.2? |
|---|---|---|---|
| **Transaction-shape** | savepoint safety, commit-before-respond, single-connection (post-refactor), serialization order, dispatch survival | **γ.2** (this file) | ✅ yes |
| **RLS isolation** | NULLIF fail-closed, cross-org policy-enforced visibility, GUC-driven scoping | **Phase-3 Batch A/C/G** migrations | ❌ deferred |

γ.2 certifies transaction-shape only. Cross-org isolation today is the handlers'/helper's `WHERE organization_id = $1`, **not** the DB. The wrap *prepares* the routes for the future policy.

### 4.1 Isolation/shape suite (`test/isolation/postureTenantWrap.test.ts`) — all RLS-independent
**Functional-under-`app_request` (proves the wrap + refactor don't break CRUD under the non-owner role; catches a missing Tier-A grant):**
- POST `/posture/snapshot` → 201; snapshot row + its domain_scores readable back by the same org (owner-pool poll).
- GET latest / history / compliance-summary → 200 with expected shape.

**Transaction-shape (the γ.2-specific content):**
- **single-transaction / commit-before-respond** — the headline refactor test: POST `/posture/snapshot` persists the snapshot **as part of the outer request tx** (assert via the β2-style owner-pool poll that the row appears only after the response resolves), proving the inner `withTenant` is gone (one connection, one commit). Optionally assert connection-count/no-second-scope via a spy if cheap.
- **savepoint-nesting** — the helper's `BEGIN/COMMIT` (now `SAVEPOINT/RELEASE`) commits inside the outer request tx; an induced in-tx error (e.g. force the `domain_scores` INSERT to fail) → `ROLLBACK TO sp_1` recovers, helper re-throws → **500 + neither snapshot nor domain_scores persisted** (atomic via savepoint, §3.1 row 2). This is posture's analogue of γ.1's review/PATCH rollback tests — **and it pins the §3.2 "no aborted-tx silent rollback" property** (assert `tenant_commit_failed` does NOT fire and the write is absent).
- **dispatch-survives** — seed org-A `webhook_endpoint`, POST, poll `webhook_deliveries` for `posture.snapshot_created` → proves the non-awaited dispatch fired on pgElevated *after* the wrap committed.

**Cross-org tripwires (labeled "WHERE-clause isolation — RLS certification deferred to Batch A/C/G"):** org-A cannot read org-B's snapshot/history/compliance rows.

### 4.2 Unit suite deltas
- **compliance-summary serialization-order guard** — spy `pg.query`, assert obligations query is issued and settled **before** obligation_assessments (pins §2.1, catches a regression back to `Promise.all`).
- **aggregate-equivalence** — compliance-summary returns byte-identical body before/after serialization.
- `buildComplianceSummary` is pure and already unit-tested (unchanged). The helper's read-serialization already shipped in PR 6 with its own coverage — γ.2 adds nothing there.
- Estimate: **~2 unit** + **~7–9 isolation**; unit/iso baselines to be re-counted fresh at implementation (do not assume).

### 4.3 No post-COMMIT-throw pinning test (contrast with γ.1 §4.3)
γ.1 needed a dedicated atomicity-pinning test because review-POST had a post-commit-ambient-query. **Posture has none (§3.2)**, so there is **no atomicity behavior-change to pin** — the savepoint-nesting test in §4.1 already covers the in-tx error path. Recorded so the absence is deliberate, not an oversight.

---

## 5. What this catches vs. what it doesn't (honest residuals)

**Catches (transaction-shape — validated by the role-sim harness):** on POST `/posture/snapshot` — savepoint safety of the helper's tx nested in the request tx, **single-connection commit-before-respond** (the refactor's payoff), in-tx error atomicity, dispatch survival; on compliance-summary — serialization correctness. All four routes prepared for the future RLS policy.

**Does NOT catch / out of γ.2's reach:**
- **RLS cross-org isolation** for `posture_snapshots` (Batch A), `domain_scores` (Batch G), `obligations`/`obligation_assessments` (later/Batch C) — no policy exists; deferred to the phase-3 batch migrations. Same shape as γ.1/risks.
- **Fire-and-forget channel** — `dispatchWebhookEvent` runs on **pgElevated**, deliberately outside the tenant scope; not RLS-isolated by this wrap (by design; β1 owns that channel). Dispatch-survives proves it fires, not that it's tenant-scoped.
- **The dead webhook retry loop** — unchanged, orthogonal.

**4th-axis (post-commit-ambient-query) audit result: run and CLEAR for posture** — no handler or the helper issues an ambient `pg.query` after its (savepoint) COMMIT and before the response. So unlike risks review-POST, **γ.2 introduces no atomicity behavior change** beyond commit-before-respond. (§3.2.)

**Concurrent-query audit result:** one site (compliance-summary) — fixed by §2.1. The helper's former fan-out was already fixed by PR 6.

---

## 6. Failure modes

| Event | Outcome |
|---|---|
| **Helper in-tx error / null-row throw** | helper `ROLLBACK TO sp_1` recovers the outer tx + re-throws → route `catch` → 500 `posture_snapshot_failed`, resolves → outer COMMIT (empty) → atomic, nothing persisted. No `tenant_commit_failed`. |
| **Handler throws (uncaught)** | the posture handlers catch internally and send their own 5xx → they *resolve*, so the request tx COMMITs (empty on the error path). A genuinely uncaught throw → `withTenant` ROLLBACK, β1.5 discards buffer, 500, `tenant_wrap_handler_failed`. |
| **Outer COMMIT fails** (connection death / failover) | `withTenant` rejects; buffer discarded; 500; `tenant_commit_failed` (durability incident — distinct signal). Write not persisted. |
| **γ.0 guard trips** (future drift adds a non-bare control stmt in the helper) | `TenantWrapUnrewriteableStatementError` thrown before it reaches `ctx.client` → 500. Inert today. |
| **No org context** | handler runs unwrapped (no scope, real `res`); its own `organization_context_missing` 403 fires; helper never reached. |

---

## 7. Rollout

Same discipline as γ.1: implement on `feat/a04-g1-pr-gamma2-posture-wrap` off develop → CI 7/7 (lint includes the γ.0 rule scoping the newly-wrapped handlers) → squash-merge to develop → promote develop→main via `chore/promote-pr-gamma2-to-main` with **`gh pr merge --merge` (never squash)** — the **15th** CLI `--merge` branch-sync → **prod-verify before γ.3 starts**: engine prod `/version` = new SHA; no `tenant_commit_failed`/`tenant_wrap_handler_failed` on posture traffic; no `client.query while already executing` warnings on `/posture/compliance-summary`; POST `/posture/snapshot` still 201 with a persisted snapshot.

---

## 8. Out of scope

- **γ.3 (vendorAssessments)** — next and last γ wrap PR.
- **The posture RLS policy migrations** — `posture_snapshots` (Batch A), `domain_scores` (Batch G), `obligations`/`obligation_assessments` (Batch C/later). Phase-3, after the cook.
- **`services/posture-worker/src/index.ts:49` `withTenant(orgId, …)`** — **explicitly NOT touched.** It is the cron path's legitimate scope-establisher (no `asTenant` there); the helper must keep working under both an `asTenant` scope (route) and a `withTenant` scope (worker). Removing it would leave the worker unscoped. The §2.2 refactor is route-only.
- **The umbrella doc edit** (§11) — needs its own PR (umbrella is on main); not done in this posture-code PR.

---

## 9. Operator-decision questions (decide before implementation)

1. **compliance-summary serialization (§2.1).** Recommend **option (a) — serialize in γ.2**, exactly as γ.1 resolved its `Promise.all`s. Confirm (or defer the route, leaving posture partially wrapped — not recommended, breaks the coherent-family pattern).
2. **Umbrella correction (§11-item-1, carried from γ.1).** The on-main umbrella still frames γ.2/γ.3 certifying tests in RLS terms and still describes the helper's now-removed fan-out. Options: (a) **standalone doc-sync PR** correcting the umbrella's RLS-framing + adding the 3rd/4th audit axes + striking the stale fan-out note *(recommended — keeps γ.2 code-scoped to posture)*; (b) fold the umbrella edit into γ.3's PR; (c) bundle a docs commit into γ.2. I recommend (a). Decide owner/timing.
3. **Informational, no decision needed:** `posture_snapshots` (Batch A) and `domain_scores` (Batch G) get their RLS policies in **different batches** — so even post-flip, posture isolation lands in two steps. Flagged so the Batch-A migration author knows `domain_scores` is not bundled with `posture_snapshots`.

---

## 10. Summary

- **Inventory matches** the umbrella: 4 routes = 1 write (via the shared helper) + 3 reads.
- **All four standing-rule audits PASS; no route BLOCKED.** Fire-and-forget: only `dispatchWebhookEvent` → pgElevated. Streaming: zero hits. Concurrent-query: one site (compliance-summary) → serialize (§2.1). Post-commit-ambient-query: **none** (§3.2, run-and-clear).
- **The explicit tx is in the helper** (`computeAndSavePostureSnapshot`), bare BEGIN/COMMIT/ROLLBACK, savepoint-safe; in-tx errors recover via `ROLLBACK TO SAVEPOINT` (atomic), **not** the aborted-tx mechanic — so **no γ.1-style atomicity behavior change**.
- **The §2.2 refactor is the only substantive change, and it's ~3 lines** (drop inner `withTenant`, fix imports): **the helper is already wrap-ready** (its fan-out was serialized by PR 6). The umbrella over-scoped this. The **worker's** `withTenant` is deliberately untouched.
- **γ.2 certifies transaction-shape, NOT RLS isolation** — `posture_snapshots`/`domain_scores`/`obligation_assessments` have no policy; deferred to Batch A/G/C.
- Files (anticipated at implementation): `posture.ts` (4 wraps + serialization + import fix), a new `test/isolation/postureTenantWrap.test.ts`, a unit serialization-order test, and this design doc. **No `postureSnapshot.ts` change, no worker change, no migration.**

**STOP — design only. No route files touched. γ.3 not started.**

---

## 11. Cross-PR follow-ups

1. **[CARRIED FORWARD from γ.1 §11-item-1, STILL PENDING — and now enlarged] Correct the γ-umbrella doc** (`docs/A04-G1-pr-gamma-design.md`, on main). It must: (a) replace the RLS-"certifying" framing for the γ-family tests with the **two-axis** split (transaction-shape certified by the γ wraps; RLS isolation by the phase-3 batch migrations) — derived independently here in §4.0; (b) record that **`posture_snapshots`/`domain_scores`/`vendor_assessments` have no RLS policy** (Batch A/G/C respectively), same as `risks`; (c) **strike the stale "verify the 7-query fan-out in `computeAndSavePostureSnapshot`" note** — already serialized by PR 6; (d) add the **3rd (concurrent-query)** and **4th (post-commit-ambient-query)** standing pre-wrap audit axes to the umbrella's audit list (memory rule files already exist: `feedback_route_wrap_concurrent_query.md`, `feedback_route_wrap_post_commit_ambient_query.md`). **Why not here:** umbrella is on main; editing it from a posture-code PR mixes scopes. **Recommendation:** standalone doc-sync PR (§9-Q2 option a), or fold into γ.3.
2. **[carried, satisfied at memory level]** The 3rd/4th audit axes are already standing-rule memories; the remaining work is only the umbrella-doc fold-in (item 1d).
3. **[new, informational]** `domain_scores` (Batch G) is split from `posture_snapshots` (Batch A) in the RLS rollout — the Batch-A author should not assume the two posture tables are bundled (§9-Q3).

---

## Flags (per the γ.2 gate)
- **No route blocked by any of the 4 audits.** All PASS.
- **No new explicit-tx atomicity edge.** Posture has **no post-commit-ambient-query** (§3.2); the helper's in-tx errors recover via `ROLLBACK TO SAVEPOINT` (clean, atomic), unlike review-POST's aborted-tx mechanic. Nothing β2/γ.1 didn't already cover.
- **No unexpected fire-and-forget channel.** Only `dispatchWebhookEvent` (pgElevated) — no audit write, no `setImmediate`/`setTimeout`, no other unawaited ambient-`pg` work.
- **Inner-`withTenant` refactor finding (surfaced, not papered over):** the umbrella §2.3/§5 anticipated a larger refactor including the helper's fan-out, but **the helper is already wrap-ready (PR 6 serialized the fan-out); γ.2's only change is the ~3-line route-level inner-`withTenant` removal.** This is a *positive* divergence from the umbrella (less work, cleaner), not a blocker — surfaced here and in §2.2/§9-Q2/§11 rather than silently absorbed.
