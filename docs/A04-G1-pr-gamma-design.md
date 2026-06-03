# A04-G1 PR γ — Design: extend the `asTenant()` wrap to the webhook-dispatching write families (risks, posture, vendorAssessments)

**Status:** Design only. No implementation. No branch, no code, no route files touched. The read is the gate (same discipline as β1.5).
**Base:** main @ `47f9aa0c` (PR β2 landed: findings family fully wrapped — 3 GETs + POST + PATCH — with β1.5 commit-before-respond live on all five routes).
**References:** `docs/A04-G1-pr-beta-design.md` (§3 dispatcher caller blast-radius, §7-Q2 "group risks/posture/vendorAssessments in γ"); `docs/A04-G1-request-scope-wrap-design.md` (§4.5 explicit-transaction handling, §5 roadmap); `docs/A04-G1-pr-beta1.5-design.md` (deferred-response shim); standing rules `feedback_route_wrap_fire_and_forget.md` + `feedback_route_wrap_streaming_guard.md`.

---

## 1. Problem restatement & why these three families now

PR α wrapped findings GETs. β1 moved the **shared** webhook dispatcher off the ambient `pg` proxy onto `pgElevated` (verified on main — `webhookDispatcher.ts:27` imports `pgElevated`; all query sites `:43,:84,:146,:156,:192,:205,:210,:220` use it). β1.5 made the wrap commit-before-respond. β2 wrapped findings writes.

β1 was built specifically to unblock the *other* webhook-dispatching write families. The β design named them explicitly (§3, "Other callers of the dispatcher"): **`risks.ts`, `posture.ts`, `vendorAssessments.ts`** (plus `findings`, now done). β2's §7-Q2 recommendation: *"group them in γ now that the shared blocker is gone."*

**γ closes that arc:** wrap the three remaining dispatcher-driven families end-to-end (reads + writes), so each becomes fully tenant-isolated like findings. This is a tight, defensible scope — it finishes the exact work β1 was the precursor for, and nothing more.

The broader `risk*`/`vendor*` CRUD surface (vendors, vendorReviews, riskTreatments, the link/settings routers) and the LLM route (`vendorAssessmentAnalysis`) are inventoried in §6 and **explicitly deferred** — they are not part of the dispatcher arc and carry their own considerations (a streaming export, an LLM split).

---

## 2. How the wrap and the scope interact for γ (verified this turn)

Read end-to-end: `infra/postgres.ts`, `infra/tenantContext.ts`, `middleware/asTenant.ts`, `lib/webhookDispatcher.ts`, `lib/postureSnapshot.ts`, and the handler bodies of all three families.

### 2.1 The new fact γ depends on: the savepoint client (`tenantContext.ts:135`)
β1/β2 only had to reason about *fire-and-forget* side-effects. γ adds families whose handlers **own an explicit `pg.connect()` + `BEGIN`/`COMMIT`/`ROLLBACK` transaction**. This is the §4.5 case, and the phase-1 machinery already handles it:

- `pg.connect()` under an active scope returns **`createSavepointClient(ctx)`** (`postgres.ts:58-62`), *not* a fresh pool client.
- That proxy rewrites the bare control statements: `BEGIN → SAVEPOINT sp_n`, `COMMIT → RELEASE SAVEPOINT sp_n`, `ROLLBACK → ROLLBACK TO SAVEPOINT sp_n; RELEASE …`, and **`release() → no-op`** (the outer `withTenant` owns the real client).

So an explicit-transaction handler nests **safely** inside `asTenant`'s transaction — its `BEGIN/COMMIT` become savepoints inside the request transaction; its `client.release()` in `finally` is inert. **Two preconditions** make this hold, and both were verified for every γ handler:
1. The handler connects via the **`pg` proxy** (not `pgRaw`, not a directly-imported pool). ✅ all four explicit-tx files `import { pg }` and call `await pg.connect()`.
2. The control statements are the **bare single-argument form** (`BEGIN`, not `BEGIN ISOLATION LEVEL …`; the rewrite only fires on the exact keyword — `tenantContext.ts:114-119`). ✅ all `BEGIN`/`COMMIT`/`ROLLBACK` sites grepped are bare.

### 2.2 Fire-and-forget side-effects (the β-era rule), re-audited for γ
| Helper | Channel | Verdict under a wrap |
|---|---|---|
| `dispatchWebhookEvent(...).catch(()=>{})` | `pgElevated` (β1, verified on main) | **SAFE** — separate pool, bypasses the ALS store entirely. This is precisely what β1 unblocked. |
| `writeAuditEvent(...)` (non-awaited) | `pgElevated` (`auditLog.ts`) | **SAFE** — owner pool, never touches the tenant client. |
| `computeAndSavePostureSnapshot(...)` | ambient `pg` + own savepoint-safe `pg.connect()` | **SAFE once posture's inner `withTenant` is removed** — see §2.3. |

No other non-awaited ambient-`pg` work exists in the three families (the validation/resolver/scoring helpers — `riskValidation`, `vendorAssessmentValidation`, `resolveOwnerUserSameOrg`, `computeVendorRiskScore`, `severityToPriority`, `resolveCadenceDays`, `postureComputation` — are awaited in-handler and either pure-compute or read via the ambient proxy, so they run on the wrap's tenant client).

### 2.3 The one real refactor γ requires: `posture.ts` POST already calls `withTenant`
`POST /api/posture/snapshot` (`posture.ts:99`) today does:
```js
const result = await withTenant(organizationId, () =>
  computeAndSavePostureSnapshot(organizationId)
);
dispatchWebhookEvent({...}).catch(()=>{});
res.status(201).json({...});
```
If we naively wrap this handler in `asTenant`, the inner `withTenant` **nests**, and `withTenant` does **not** detect nesting (β design §2.1): it opens a *second, independent* client + transaction. The snapshot would commit on that inner client **before** the outer wrap commits — defeating β1.5's commit-before-respond guarantee (an inner-committed row could survive an outer COMMIT failure that returns the client a 500). It also burns two connections per request.

**Fix (clean, and aligned with the function's own design intent):** remove the inner `withTenant` and call `computeAndSavePostureSnapshot(organizationId)` directly inside the `asTenant` wrap. The function is *built* to run inside one per-tenant transaction — its own header comment (`postureSnapshot.ts:97-108`) says so — and it uses the ambient `pg` proxy throughout plus one savepoint-safe `pg.connect()` (`:255`), so it routes onto the outer wrap's tenant client automatically. This is a net **simplification** (one fewer explicit `withTenant` call site), not added complexity.

---

## 3. Phase 1 — inventory of candidate families

`router` method/path, line, tag (read / write / streaming / admin). The three γ families first; the deferred set in §6.

### γ candidates
| File | Route | Line | Tag |
|---|---|---|---|
| `risks.ts` | POST `/risks` | 234 | **write** (dispatch `:387`, audit `:366`; no explicit BEGIN — plain ambient `pg`) |
| `risks.ts` | GET `/risks` | 418 | read |
| `risks.ts` | GET `/risks/summary` | 528 | read |
| `risks.ts` | GET `/risks/intelligence` | 701 | read |
| `risks.ts` | GET `/risks/:id` | 788 | read |
| `risks.ts` | GET `/risks/:id/history` | 866 | read |
| `risks.ts` | POST `/risks/:id/review` | 1029 | **write** (explicit BEGIN `:1083`, COMMIT `:1157`) |
| `risks.ts` | PATCH `/risks/:id` | 1220 | **write** (explicit BEGIN `:1254`, COMMIT `:1376`, dispatch `:1429`, audit `:1403`) |
| `posture.ts` | POST `/posture/snapshot` | 99 | **write** (inner `withTenant` `:114` → refactor §2.3; dispatch `:118`) |
| `posture.ts` | GET `/posture/latest` | 156 | read |
| `posture.ts` | GET `/posture/history` | 249 | read |
| `posture.ts` | GET `/posture/compliance-summary` | 308 | read |
| `vendorAssessments.ts` | POST `/vendor-assessments` | 80 | **write** (explicit BEGIN `:104`, COMMIT `:246`, dispatch `:271`, audit `:260`) |
| `vendorAssessments.ts` | GET `/vendor-assessments` | 337 | read |
| `vendorAssessments.ts` | GET `/vendor-assessments/:id` | 437 | read |

### Broader risk*/vendor* surface (inventoried, deferred — see §6)
| File | Routes | Notes |
|---|---|---|
| `vendors.ts` | POST `/vendors` (79), GET `/vendors` (183), GET `/vendors/summary` (300), **GET `/vendors/export.csv` (416 — STREAMING)**, GET `/vendors/:id` (529), PATCH `/vendors/:id` (583), GET `/vendors/:id/risk-score` (722), GET `/vendors/:id/findings` (813) | audit-only writes (pgElevated, safe); **no webhook dispatch**. Contains a streaming CSV export → family carve-out needed. |
| `vendorReviews.ts` | POST (118), GET (230), GET `/:id` (342), PATCH (425) | explicit-tx (BEGIN `:142`/`:459`), savepoint-safe; audit-only; no dispatch. |
| `riskTreatments.ts` | POST (97), GET (258), GET `/:id` (371), PATCH (432) | explicit-tx (BEGIN `:121`/`:466`), savepoint-safe; audit-only; no dispatch. |
| `riskControlLinks.ts` | POST (482), DELETE (490), GET (498), GET (506) | plain CRUD + DELETE; no dispatch/stream/explicit-BEGIN. |
| `riskObligationLinks.ts` | POST (472), DELETE (480), GET (488), GET (496) | plain CRUD + DELETE. |
| `riskScale.ts` | GET (44), GET `/presets` (118), PUT (163) | plain CRUD (PUT). |
| `riskScoringWeights.ts` | GET (221), PUT (229) | plain CRUD. |
| `riskSettings.ts` | GET (247), PUT (255) | plain CRUD. |
| `vendorSignalContext.ts` | GET `/vendors/:id/signal-context` (11) | read. |
| `vendorAssessmentAnalysis.ts` | POST `/vendor-assessments/analyze-document` (84) | **LLM route** (`analyzeAssessmentDocument` `:70`) → δ scoped-DB/unscoped-LLM split. |

---

## 4. Phase 2 — the two standing-rule audits

### 4.1 Fire-and-forget audit (`feedback_route_wrap_fire_and_forget.md`)
Per-route classification of every non-awaited side-effect in the three γ families:

| Route | Side-effect | Channel | Verdict |
|---|---|---|---|
| `risks` POST `/risks` | `dispatchWebhookEvent` (`:387`), `writeAuditEvent` (`:366`) | pgElevated / pgElevated | **PASS** |
| `risks` POST `/risks/:id/review` | `writeAuditEvent` (`:1170`); explicit tx via savepoint client | pgElevated; tenant client (savepoint) | **PASS** |
| `risks` PATCH `/risks/:id` | `dispatchWebhookEvent` (`:1429`), `writeAuditEvent` (`:1403`); explicit tx | pgElevated / pgElevated; savepoint | **PASS** |
| `posture` POST `/posture/snapshot` | `dispatchWebhookEvent` (`:118`); `computeAndSavePostureSnapshot` | pgElevated; ambient (after §2.3 refactor) | **PASS — conditional on §2.3 refactor** |
| `vendorAssessments` POST | `dispatchWebhookEvent` (`:271`), `writeAuditEvent` (`:260`); explicit tx | pgElevated / pgElevated; savepoint | **PASS** |
| all GET routes (8) | none | — | **PASS** |

**No route is BLOCKED by the fire-and-forget rule.** β1 retired the only blocker (the dispatcher). The single action item is the posture inner-`withTenant` removal (§2.3) — a refactor, not a deferral.

### 4.2 Streaming-guard audit (`feedback_route_wrap_streaming_guard.md`)
Grepped all three families for `res.write|pipe|send|end|setHeader|cookie|redirect|type`:

- **`risks.ts`, `posture.ts`, `vendorAssessments.ts`: zero hits.** Every handler terminates in a single `res.status(n).json(body)`. **All PASS.**
- The only streaming hit in the entire risk*/vendor* surface is **`vendors.ts:488-515`** (`/vendors/export.csv`: `res.setHeader` ×2 + `res.write` loop + `res.end`) — in a **deferred** family (§6), not a γ candidate. It is the same canonical counter-example class as `findingsExport.ts`: **must not be wrapped** without a commit-then-stream redesign.

---

## 5. Phase 3 — γ scope recommendation

### 5.1 In scope (PASS both audits)
All 15 routes of the three dispatcher families. Wrapping reads + writes makes each family fully isolated like findings.

### 5.2 PR structure — **three PRs, one family each (β2 precedent)**
β2 proved one-family-per-PR is clean and reviewable. The families are independent (different tables, no shared handler), so:

- **γ.1 — `risks`** (8 routes: 3 writes + 5 reads). Largest; includes two explicit-tx writes (review, patch) that exercise the savepoint path + a plain-CRUD POST + a dispatch+audit PATCH. Highest test value (covers every side-effect class in one family).
- **γ.2 — `posture`** (4 routes: 1 write + 3 reads). Carries the §2.3 inner-`withTenant` refactor — the one substantive code change in γ beyond mechanical wrapping. Worth its own PR so that refactor is reviewed in isolation.
- **γ.3 — `vendorAssessments`** (3 routes: 1 explicit-tx write + 2 reads). Smallest; mirrors the risks explicit-tx + dispatch + audit pattern.

Recommended order: **γ.1 → γ.2 → γ.3** (do the savepoint-heavy family first so its harness coverage de-risks γ.3; posture's refactor sits in the middle as its own reviewable unit). They have no inter-dependencies, so they may also land in parallel.

### 5.3 Rough diff estimates (from the β2 wrap pattern)
The wrap itself is mechanical — `asTenant(async (req, res) => { … })` around the existing body — so *substantive* change is small, but inlining re-indents the handler body (review with whitespace-ignored):

| PR | Substantive lines | Reindent churn | Test additions |
|---|---|---|---|
| γ.1 risks | ~16 (8 wraps × open/close) | large (handlers are long; `risks.ts` ~1460 ln) | ~120 (3 write paths × {positive, cross-org, dispatch/savepoint} + fail-closed) |
| γ.2 posture | ~10 (4 wraps) **+ ~6 net for the §2.3 refactor** (removes a `withTenant`) | moderate | ~50 (snapshot write under wrap + dispatch-survives + cross-org read) |
| γ.3 vendorAssessments | ~6 (3 wraps) | moderate | ~60 (explicit-tx write positive + cross-org + dispatch-survives + fail-closed) |

---

## 6. Out of scope (deferred — named individually with blocker)

| Family / route | Why not γ | Defer to |
|---|---|---|
| `vendors.ts` GET `/vendors/export.csv` (`:416`) | **Streaming-guard BLOCKED** — `res.setHeader` + `res.write` loop + `res.end`. Needs commit-then-stream redesign. | δ (streaming/export track) |
| rest of `vendors.ts` (POST/PATCH/JSON GETs) | Pass both audits, but the family has **no webhook dispatch** — not part of the β1 dispatcher arc; and it can only be wrapped *route-by-route* with the export carved out (like findings/`findingsExport`). | δ / plain-CRUD sweep |
| `vendorReviews.ts` (4 routes) | Pass both audits (explicit-tx, savepoint-safe; audit-only side-effect). No dispatch → outside γ's arc. | plain-CRUD sweep |
| `riskTreatments.ts` (4 routes) | Same as vendorReviews — savepoint-safe explicit-tx, no dispatch. | plain-CRUD sweep |
| `riskControlLinks.ts`, `riskObligationLinks.ts` (8 routes) | Plain CRUD incl. **DELETE** (verify DELETE terminator is `res.json`/`.status().json`, not `.send()`/`.end()`, before wrapping). No dispatch. | plain-CRUD sweep |
| `riskScale.ts`, `riskScoringWeights.ts`, `riskSettings.ts` (7 routes) | Plain CRUD (GET/PUT). No dispatch/stream/explicit-BEGIN. | plain-CRUD sweep |
| `vendorSignalContext.ts` (1 GET) | Read-only, no concerns. | plain-CRUD sweep |
| `vendorAssessmentAnalysis.ts` POST (`:84`) | **LLM route** (`analyzeAssessmentDocument`). Needs the §4.4 scoped-DB / unscoped-LLM split — never hold a tenant transaction across an LLM call. | δ (LLM track) |

> Note on the broader CRUD sweep: every deferred CRUD route here actually *passes* both audits today. The deferral is about **scope discipline and grouping**, not safety — they belong to the "plain CRUD families" the α §5 roadmap originally slotted, not the dispatcher arc γ completes. Folding them into γ would triple γ's surface for no architectural reason. Keep γ = the three dispatcher families; sweep the rest as a separate batch.

---

## 7. Mechanism, test plan, risks

### 7.1 Mechanism
Identical to β2: wrap each handler in `asTenant(...)`, inheriting β1.5 commit-before-respond. No change to `asTenant`, `withTenant`, the savepoint client, or the dispatcher. The only handler-body edit beyond the wrap is the posture §2.3 inner-`withTenant` removal.

### 7.2 Test plan (per family, under the role-simulation harness — `options=-c role=app_request`, like `findingsTenantWrap.test.ts`)
Mirror β2's certifying tests:
- **Positive:** write succeeds (201/200) and the row is visible **only** under the writer org's scope.
- **Cross-org:** a write/patch under `orgA`'s scope cannot read or mutate `orgB`'s row (RLS isolation of the write).
- **Dispatch-survives** (for the dispatching writes — risks POST/PATCH, posture POST, vendorAssessments POST): with an active `orgA` `webhook_endpoint` seeded, perform the write and poll `webhook_deliveries` for the delivery row — proving dispatch completed on the `pgElevated` channel *after* the wrap committed. This is the test that would catch a regression of the β1 fix.
- **Savepoint nesting** (for the explicit-tx writes — risks review/patch, vendorAssessments POST): assert the handler's inner `BEGIN/COMMIT` (now `SAVEPOINT/RELEASE`) commits correctly *as part of* the outer request transaction, and that a handler-internal `ROLLBACK` rolls back only its savepoint, not the whole request.
- **Fail-closed:** an unscoped write (no GUC) under `app_request` writes nothing (NULLIF policy — `feedback_rls_policy_nullif.md`).
- **posture-specific:** assert the snapshot row commits under the *outer* wrap transaction (proves the §2.3 refactor removed the inner `withTenant` correctly — only one transaction, one connection).

### 7.3 Risks
1. **posture inner-`withTenant` (§2.3)** — the one non-mechanical change. If missed, double-transaction + commit-before-respond defeated. Mitigation: the posture-specific test above; review γ.2 in isolation.
2. **Savepoint-rewrite dependency** — γ's explicit-tx handlers rely on `createSavepointClient` rewriting bare `BEGIN/COMMIT/ROLLBACK`. Verified all forms bare today. **Standing hazard:** any future edit introducing `BEGIN ISOLATION LEVEL …`, advisory locks, `LISTEN/NOTIFY`, or `COPY` in these handlers would pass through un-rewritten → a real nested `BEGIN` on the tenant client → error. The savepoint-nesting test pins current behavior; the escape hatch (`pgRaw` + manual `set_config`, `tenantContext.ts:44-53`) is the documented fix if one is ever needed.
3. **Shared-helper hazard** — none open. Dispatcher (pgElevated, β1) and auditLog (pgElevated) both verified. No new shared mutable-DB helper is introduced.
4. **Streaming** — none in the three γ families. The one risk*/vendor* streaming route (`vendors/export.csv`) is explicitly excluded (§6).
5. **`release()` under wrap** — explicit-tx handlers call `client.release()` in `finally`; under the wrap this is a savepoint-client no-op (correct), and on the no-org fall-through path (`asTenant` runs the handler unwrapped) it releases a real `pgRaw` client as today. Both paths verified consistent.

---

## 8. Prerequisites & open questions

**Prerequisites — all met:**
- β1 (dispatcher → `pgElevated`) on main — verified (`webhookDispatcher.ts:27`).
- β1.5 (deferred-response shim) on main — verified (`asTenant.ts:46-55,98-142`, `deferredResponse.ts`).
- β2 (findings writes wrapped) on main `47f9aa0c` — verified (memory ledger PR #149).

**Open questions for the operator:**
1. **γ scope confirmation.** Recommended γ = risks + posture + vendorAssessments only (the dispatcher arc), three PRs. Confirm, or do you want the broader CRUD sweep (vendors-minus-export, vendorReviews, riskTreatments, links, settings) folded into γ as additional per-family PRs? (Recommendation: keep γ tight; sweep separately.)
2. **posture refactor.** Confirm removing the inner `withTenant` in `POST /posture/snapshot` (§2.3) in favor of the `asTenant` wrap is acceptable — it is a simplification aligned with `computeAndSavePostureSnapshot`'s own design, but it does touch a handler beyond a pure wrap.
3. **PR cadence.** Three independent PRs may land sequentially (γ.1→γ.2→γ.3) or in parallel. Preference?
4. **vendors family timing.** `vendors` is the natural next CRUD family but needs the `export.csv` carve-out (wrap the JSON routes, leave the export unwrapped, like findings/`findingsExport`). Want that as the lead item of the δ/CRUD sweep, or pulled forward?

---

## 9. Summary

- The three families β1 was built to unblock — **risks, posture, vendorAssessments** — all **PASS both standing-rule audits**. No route is blocked by fire-and-forget (β1 retired the dispatcher) or streaming (none of the three streams).
- The explicit-transaction handlers (risks review/patch, vendorAssessments POST) are **savepoint-safe by construction** — they connect via the `pg` proxy and use bare `BEGIN/COMMIT/ROLLBACK`, which `createSavepointClient` rewrites to nest inside the request transaction. Verified, not assumed.
- The **one** non-mechanical change is removing `posture.ts` POST's inner `withTenant` (§2.3) so the wrap doesn't open a second, independently-committing transaction. This is a simplification.
- **Recommended structure:** three PRs, one family each (β2 precedent) — γ.1 risks, γ.2 posture (carries the refactor), γ.3 vendorAssessments.
- **Deferred, named individually (§6):** the `vendors/export.csv` streaming route (streaming-guard BLOCKED → δ), the LLM route `vendorAssessmentAnalysis` (→ δ split), and the non-dispatching CRUD families (vendors-rest, vendorReviews, riskTreatments, links, settings) — a separate plain-CRUD sweep, deferred for scope discipline, not safety.
- RLS remains **inert pre-flip** on all wrapped routes (engine still owner-cred); γ is a transaction-shape change validated by the harness, not a live isolation change until the operator `DATABASE_URL → app_request` flip (phase 3).
