# A04-G1 — Request-Scope Tenant Wrap: Design Document

**Status:** DRAFT for review — no code in this turn
**Author:** platform audit (Claude), 2026-06-02
**Branch:** `chore/a04-g1-request-scope-design` (scratch; design artifact only, uncommitted)
**Audited against:** `main` @ `ff69ce31`

---

## 0. Why this document exists

The `findings` RLS pilot (PR #140 / #141, migration `20260619_findings_rls_pilot.sql`) is on
main and **proven by the harness** (`test/isolation/findingsRls.test.ts`) but **inert in
production**: every one of the 6 services still connects as the DB owner, which bypasses RLS.

The pilot also surfaced the gap this document scopes. The RLS policy keys on the per-transaction
GUC `app.current_org_id`. That GUC is set **only** inside `withTenant(orgId, fn)`
(`src/api/infra/postgres.ts:91`). **Nothing in the request path currently calls `withTenant`.**
`attachOrganizationContext` loads `req.organizationContext` but does **not** open a tenant scope.

Therefore, the moment the operator repoints `DATABASE_URL` to the non-owner `app_request` role
(phase 3), **every org-scoped customer query would run with an unset GUC** and the
`NULLIF(current_setting('app.current_org_id', true), '')::uuid` policy would fail closed to
**0 rows** for every tenant. The `findings` routes — and the ~50 other org-scoped `pg.query`
call sites — would all return empty result sets. Customer-visible total outage of every
org-scoped read, plus `WITH CHECK` rejection of every write.

The fix is **platform-level, not per-route**: wrap every org-scoped customer request in
`withTenant` so the ambient `pg.query()` / `pg.connect()` route to a tenant client with the GUC
set. This is *also* the precondition for **every** future per-table RLS rollout (sweep batches
A–G), so it is worth getting right once.

This document does **not** write that code. It scopes it.

---

## 1. What already exists (verified)

The tenant plumbing is **already built and unit-tested** — it is simply not wired into the
request path. This is the single most important fact for sequencing: PR α is *wiring*, not
*new infrastructure*.

### 1.1 `src/api/infra/tenantContext.ts`
- `tenantStorage` — `AsyncLocalStorage<TenantContext>`.
- `currentTenantContext()` / `requireTenantContext()` — soft and fail-fast accessors.
- `createSavepointClient(ctx)` — a `Proxy` over the in-transaction client that rewrites
  `BEGIN → SAVEPOINT sp_n`, `COMMIT → RELEASE SAVEPOINT sp_n`,
  `ROLLBACK → ROLLBACK TO + RELEASE`, and makes `.release()` a no-op. **This is the mechanism
  that makes the ~24 explicit-`BEGIN` route files safe inside the wrap with zero edits** (see
  §3a).

### 1.2 `src/api/infra/postgres.ts`
- `pool` — the application `Pool`. **No `max` configured ⇒ pg default = 10 connections.** (§3e)
- `pgRaw` — the unwrapped pool (documented escape hatch; no routing, no rewriting).
- `pgElevated` — owner pool for legitimately cross-org code; reads
  `MIGRATION_DATABASE_URL ?? DATABASE_URL`.
- `pg` — the `Proxy` whose `.query()` / `.connect()` are **tenant-aware**: when a `withTenant`
  scope is active they route to the ALS client; otherwise they fall through to the raw pool
  **byte-identically to today**.
- `withTenant(orgId, fn)` — checks out a client, `BEGIN`, `set_config('app.current_org_id', orgId, true)`,
  runs `fn` inside `tenantStorage.run(...)`, `COMMIT` on success / `ROLLBACK` on throw, always
  `release()`.
- `withElevated(fn)` — runs `fn(client)` inside `tenantStorage.exit(...)` against `pgElevated`,
  **outside** any tenant scope.

### 1.3 The middleware reality (the central design constraint)
`attachOrganizationContext` is **NOT a single global middleware**. It is mounted **inline,
per-route-handler**, in **73 of 110** route files, in the canonical triple
`requireApiKey, attachOrganizationContext, requireEntitlement("standard")` (see
`findings.ts:71-76`, `findings.ts:220-225`, etc.). The org id is then read **inside** each
handler off `req.organizationContext.organizationId`, and most handlers early-return
`403 organization_context_missing` when it is null.

`src/api/routes/index.ts:386-389` documents this explicitly:
> *"Each router owns its own requireApiKey + attachOrganizationContext + requireEntitlement
> guards — mounted here for centralized routing."*

Consequence: **there is no single chokepoint after which "the request is authenticated and
org-scoped" is universally true.** Any wrap design must contend with this. (§4.1)

### 1.4 The harness (our safety net — confirmed)
`test/isolation/crossOrgIsolation.test.ts` drives the **real** `createApp()` over HTTP via
`supertest`, with two real orgs and two real API keys, asserting same-org 200 + cross-org 404
across 15 v1 resources. It imports the production app unchanged. **This means the wrap is
exercised end-to-end by CI the moment it lands** — if a wrapped route returns 0 rows to its own
org, the positive control fails loudly. This is the primary correctness gate for every PR below.
`findingsRls.test.ts` separately proves DB-layer enforcement under `SET ROLE app_request`.

---

## 2. The target behavior

For every request that is (a) authenticated to an org and (b) touches org-scoped tables:
the handler body runs inside `withTenant(organizationId, ...)`, so:
- `pg.query(...)` routes to the tenant client with `app.current_org_id` set;
- the whole request is one transaction (commit on 2xx/handler-return, rollback on throw);
- RLS policies (pilot today, sweep batches later) enforce isolation at the DB engine.

For every request that is legitimately org-less (login, signup, health, webhooks) or that
legitimately spans orgs (admin operator surface, cron workers): the request must **not** be
wrapped, and cross-org code uses `withElevated`/`pgElevated`.

---

## 3. Inventory of cross-cutting concerns (enumerated, not yet solved)

### (a) Routes with explicit `BEGIN` / `COMMIT` / `ROLLBACK` in the handler — 24 files

```
vendorAssuranceDocuments, cyberSignals, risks, requirements, signalMatchSuggestions,
emailProviderWebhook, dependencyAssessments, governanceReviews, teamInvites, dependencies,
evidence, controlAssessments, unsubscribe, obligationMappings, obligationAssessments,
riskTreatments, frameworkActivation, vendorReviews, customerAuth, assess, vendorAssessments,
frameworks, controlMappings, intelligenceBriefs, aiGovernanceAssessments
```

**Verified mechanism:** these acquire their client via `pg.connect()` (the tenant-aware proxy),
**not** `pgRaw`. Examples confirmed: `risks.ts:1081` (`const client = await pg.connect()`),
`assess.ts:144`, `intelligenceBriefs.ts:132`. Inside a `withTenant` scope, `pg.connect()`
returns a `createSavepointClient`, so their literal `BEGIN/COMMIT/ROLLBACK` are **rewritten to
savepoints** against the ambient request transaction. `.release()` becomes a no-op owned by the
wrap.

**So this category is, by construction, already handled — IF** (i) they go through `pg.connect()`
(confirmed for the spot-checks; must be confirmed for all 24), and (ii) none of them rely on a
true independent transaction for correctness — e.g. needing a sub-unit to **commit
independently of the request** (an outbox/audit row that must survive a later request rollback),
or `BEGIN ISOLATION LEVEL SERIALIZABLE`, advisory locks, `LISTEN/NOTIFY`, or `COPY`. Any such case
must use the `pgRaw` escape hatch. **This needs a per-file read before wrapping each family.**
Not a blocker, but the per-route audit cost is real.

> Note: `customerAuth.ts`, `emailProviderWebhook.ts`, `unsubscribe.ts` appear here but are
> **org-less / pre-auth** (see §3c) — they must be in the *no-wrap* set, so their BEGIN/COMMIT
> stays raw and is irrelevant to the savepoint concern.

### (b) Streaming / multipart / external-call routes — three sub-kinds

**(b.1) CSV / PDF exports — `res.write` loops:**
`findingsExport.ts` (CSV), `vendors.ts` (CSV), `auditPackage.ts` (PDF),
`gapReport.ts` (PDF), `executiveReport.ts` (PDF).
**Verified shape:** these **query first, render second**. All `pg.query` calls complete
(`findingsExport.ts:117`, then the `res.write` loop at `:164-183` iterates `result.rows`
already in memory; the PDF routes gather all rows then call `generate*PDF(data, res)` at the
end — `gapReport.ts:971`, `executiveReport.ts:809`). **No DB query is interleaved with the
stream.** Under a wrap the connection is held during render+flush but with **no external network
wait** — a bounded CPU/socket hold (PDF generation over in-memory data), not an idle-in-tx-across-network hold.

**(b.2) Multipart uploads — `multer`:**
`vendorAssuranceDocuments.ts` (multer memoryStorage + heavy DB), `transcribe.ts` (multer +
OpenAI), `vendorAssessmentAnalysis.ts` (multer + LLM). `multer` runs as **route middleware
before the handler**; the body is fully buffered into memory before any DB work. The design
question is purely *where the wrap sits relative to multer* (§4.1) — we do **not** want the
tenant transaction open during the multipart parse.

**(b.3) LLM-in-handler — the real pool-hold risk:**
`ask.ts`, `transcribe.ts`, `vendorAssessmentAnalysis.ts`, `intelligenceBriefs.ts` (generate).
**Verified for `ask.ts`:** 9 `pg.query` RAG-context reads at lines 152–328, **then** the
Anthropic call at `:437`, with no DB after. Under a naive whole-request wrap, the tenant client
would sit **idle-in-transaction for the entire LLM round-trip (potentially 10–60 s)**. With a
pool of 10, a handful of concurrent `ask`/brief-generate calls exhausts the pool and stalls
every other tenant. **This is the sharpest pool concern (§3e, §4.4).**

### (c) Pre-auth / no-org routes — MUST NOT be wrapped

Mounted in `routes/index.ts` **before** the per-route auth chains, with `organizationId`
legitimately null:
- `GET /health` (`index.ts:152`), `GET /version` (`:177`) — no DB scope / trivial `SELECT 1`.
- `POST /webhooks/stripe` (`app.ts:353`) — raw-body, signature-verified, cross-org by nature.
- `emailProviderWebhookRouter` (`/`), `unsubscribeRouter` (`/`) (`index.ts:198-199`).
- `publicBriefSignupRouter`, `accountRecoveryRouter`, `customerAuthRouter`, `mfaRouter`
  (mix of public + JWT), `ssoRouter` (public ACS/metadata + protected config) —
  `index.ts:202-216`.
- The entire `/admin/*` surface (`index.ts:245-275`) — operator, cross-org by design; uses
  `pgElevated` (the 7.a–7.e triage work). **Must stay on the elevated channel, never wrapped.**
- `customerApiKeysRouter`, `accountRouter` — own inline `requireApiKey`; `account` has org but
  free-tier-visible.

These are the **opt-out set**. The risk is *accidentally wrapping one of them* (e.g. a webhook),
which would force an org scope onto a legitimately org-less request and break it.

### (d) `pgElevated` / `withElevated` usage inside request handlers — already present

Route files already calling `pgElevated`: `adminSubscribers`, `adminApiKeys`,
`adminPromoteNewsletterIssue`, `customerAuth`, `adminOpsHealth`, `adminUpdateNewsletterIssue`,
`adminCreateNewsletterIssue` (plus lib: `auditLog`, `authAnomaly`, schedulers).

**Verified behavior:** `withElevated(fn)` wraps its body in `tenantStorage.exit(...)`
(`postgres.ts:120`), which **suspends the ALS scope** so the elevated client is the only handle
in play. **This is exactly the semantics we need:** if an org-wrapped request must, mid-handler,
do a legitimately cross-org read, `withElevated` correctly exits the tenant scope and runs on
the owner pool, then control returns to the tenant scope. **No change required** — but note the
admin routes are in the **no-wrap set** anyway (§3c), so the exit-re-enter path is mainly for
*customer* routes that legitimately need an elevated sub-query. Those are rare and should be
audited as they arise.

> One subtlety to verify during implementation: bare `pgElevated.query(...)` (NOT wrapped in
> `withElevated`) inside a tenant scope still goes to the elevated pool (it's a different Pool
> object), but it does **not** exit the ALS scope — harmless for a standalone elevated query,
> but if that elevated query itself calls back into `pg.query()` it would wrongly re-enter the
> tenant client. Prefer `withElevated` for any elevated work inside a potentially-wrapped path.

### (e) Connection pool sizing — the operational blocker

- **Current:** `new Pool({ connectionString, ssl })` with **no `max`** ⇒ **pg default 10** per
  service, per pool. `pgElevated` is a second pool (also default 10, lazy).
- **Today's behavior:** a request checks out a connection only for the duration of each
  individual `pg.query()` and releases immediately between queries. Effective concurrency is
  high because connections are shared rapidly.
- **Post-wrap behavior:** each wrapped request holds **one** connection **for its entire
  duration** (open transaction). Effective max concurrent *org-scoped* requests per service
  becomes the pool `max`. With `max=10` and an LLM route that holds for 30 s, **10 slow requests
  freeze the service.**
- **What the agent cannot determine and the operator must supply (§6):** prod peak concurrent
  request count, p99 request duration (esp. for `ask`/brief-generate), and the Postgres
  `max_connections` ceiling on the Render plan (so we know how high `max` can safely go across
  all 6 services × 2 pools without exhausting the server).

### (f) Test coverage that exercises the wrap — confirmed sufficient for correctness, thin for load

- **Correctness:** `crossOrgIsolation.test.ts` (HTTP, 15 resources, same-org-200 + cross-org-404)
  and `findingsRls.test.ts` (DB-layer `SET ROLE app_request`) **both run in CI** and **will catch
  a wrap that returns 0 rows to its owner** or that fails to set the GUC. The `cross-org-isolation`
  job is a required check on main. **This is our green light per PR.**
- **Gaps:** no load/concurrency test exists, so pool exhaustion (§3e) is **not** caught by CI —
  it must be validated on staging (§5, PR ε). No test currently asserts the *no-wrap* set stays
  unwrapped; PR α should add one (assert a webhook / health request runs with no active tenant
  scope).

---

## 4. Design proposals (options + a recommendation for review)

### 4.1 Where does the wrap go?

**Option A — modify `attachOrganizationContext` to open the scope and call `next()` inside it.**
Rejected. `AsyncLocalStorage` scope is established by `tenantStorage.run(ctx, fn)`; for the
scope to cover the *downstream* handler you would have to call `next()` **inside** the `run`
callback and keep the callback alive until the response finishes — i.e. turn the middleware into
a wrapper around the rest of the chain. Express middleware is not structured for that cleanly
(`next()` returns immediately; the handler runs after the middleware function has returned). You
also cannot `COMMIT/ROLLBACK` at the right time without hooking `res` finish/close. High risk of
leaking transactions on early `res.json()` returns.

**Option B — a dedicated "wrap the rest of the chain" middleware placed immediately after
`attachOrganizationContext`, using `res` lifecycle to close the transaction.**
This is the conceptually correct Express pattern: a middleware that does
`withTenant(orgId, () => new Promise(resolve => { res.on('finish', resolve); res.on('close', resolve); next(); }))`
— the tenant scope (and transaction) stays open across the whole downstream handler and commits
when the response finishes. But coupling `withTenant`'s commit/rollback to `res` events is
**subtle**: a handler that `throw`s after `res.headersSent` (streamed a partial body then failed)
must roll back the DB while the client already got a 200 prefix; and `withTenant` currently
commits on `fn` resolve, not on a deferred `res` signal. Adopting this requires either reworking
`withTenant` or adding a parallel `withTenantRequest` helper. Powerful but the most invasive.

**Option C — per-handler wrap helper applied at the route layer (`asTenant(handler)`).**
Provide a tiny adapter:
```ts
const asTenant = (h: RequestHandler): RequestHandler => async (req, res, next) => {
  const orgId = (req as any).organizationContext?.organizationId;
  if (!orgId) return next(); // or 403 — preserves each route's existing behavior
  try { await withTenant(orgId, () => Promise.resolve(h(req, res, next))); }
  catch (err) { next(err); }
};
```
applied as `router.get("/findings/:id", requireApiKey, attachOrganizationContext, requireEntitlement("standard"), asTenant(handler))`.
The wrap boundary is the **handler invocation** — the transaction opens just before the handler
and `withTenant` commits/rolls back exactly when the handler promise settles, which is the
semantics `withTenant` already implements. The await-the-handler-promise must be reconciled with
streaming handlers that resolve before `res.end()` (those need Option-B-style res-lifecycle
awaiting, or exclusion — see §4.3).

**Recommendation (for review):** **Option C as the default mechanism, with a small Option-B-style
variant for streaming handlers.** Rationale: C keeps the commit/rollback tied to the handler
promise (matching `withTenant` as built — no rework of the proven primitive), is **explicitly
opt-in per route** (so the no-wrap set is handled by simply *not* applying it — see §4.2), and
lets us roll out one route family at a time behind the harness. The cost is touching 73 route
files eventually; that cost is acceptable and reviewable because each change is mechanical and
the harness proves each batch. The downside vs. B (global) is that a *new* route could forget the
wrap — mitigated by a lint/grep guard in CI (assert every `attachOrganizationContext` handler is
`asTenant`-wrapped) added in a later PR.

### 4.2 Opt-in vs opt-out for the no-wrap set

With Option C the wrap is **opt-in by construction**: org-less routes (webhooks, health, admin,
auth) simply never call `asTenant`, so there is no "disable" marker to get wrong. This is safer
than a global wrap + opt-out, where forgetting to mark a webhook scopes it to a (nonexistent) org
and breaks it. **Recommendation: opt-in (Option C) — the no-wrap set needs zero changes and
cannot be accidentally wrapped.**

### 4.3 Streaming / export routes

These query-then-render (§3b.1). Two viable handlings:
- **C-stream variant:** wrap the **data-gathering** phase in `withTenant`, return the gathered
  rows, then render/stream **outside** the scope. Connection released before the (CPU-bound)
  PDF/CSV write. Cleanest for pool pressure, but requires splitting each export handler into
  "fetch" + "render", a non-trivial refactor per route.
- **Whole-handler wrap (plain Option C):** acceptable here precisely because there is **no
  external network wait** during the stream — the hold is bounded CPU + local socket flush.
  Simpler; slightly longer connection hold.

**Recommendation:** whole-handler wrap (plain C) for exports in the first pass — the hold is
bounded and these are low-QPS. Revisit the fetch/render split only if staging load (PR ε) shows
export routes contributing to pool starvation.

### 4.4 LLM-in-handler routes (`ask`, `transcribe`, `vendorAssessmentAnalysis`, brief-generate)

This is where a whole-handler wrap is **actively harmful** (idle-in-tx across a 10–60 s LLM
call). Options:
- **Split: scope the DB phases, exclude the LLM phase.** For `ask.ts`: wrap the RAG-context
  reads (`:152-328`) in `withTenant`, materialize the context, **then** make the Anthropic call
  (`:437`) outside any scope, then (if needed) wrap a final write. Connection released across the
  LLM round-trip. Requires restructuring each LLM handler into scoped/unscoped phases.
- **Leave LLM routes on raw `pg` + explicit org filters (no RLS reliance) for now.** They keep
  today's behavior (`pgRaw` escape hatch + `WHERE organization_id = $1`) and are explicitly
  excluded from the wrap until their per-table RLS lands. Lower immediate effort; defers the
  isolation hardening for those specific reads.

**Recommendation:** **split (scope DB phases, exclude the LLM call)**, but sequence it **last**
(PR δ) and treat each LLM route individually. Until then these stay on raw `pg` with their
existing explicit org filters — they are not part of the `findings` pilot's enforced set, so
deferring them does not regress anything that RLS currently enforces.

### 4.5 Explicit-`BEGIN` routes

By §3a the savepoint proxy already absorbs these **provided** they (i) go through `pg.connect()`
and (ii) don't need an independently-committing sub-transaction. **Recommendation:** do **not**
rewrite them preemptively. Wrap their family with `asTenant`, run the harness, and read each file
to confirm no independent-commit requirement. Only convert to the `pgRaw` escape hatch the
specific handlers (if any) that genuinely need their own transaction lifecycle. Most will need
**zero** changes.

### 4.6 Pool sizing

- Set `max` **explicitly** on both pools (it is currently the silent default 10).
- Size `max` per service from operator-supplied peak-concurrency + p99 (§6), with headroom, and
  **bounded so that `Σ(services × pools × max) < Postgres max_connections`** with margin for
  migrations and the operator's own connections.
- Add `connectionTimeoutMillis` (fail fast with a clear error instead of hanging when the pool is
  exhausted) and keep `statement_timeout` / the existing 30 s request timeout as backstops.
- **Recommendation:** do not pick a number from a desk. Land the wrap on a small allowlist
  (PR α), then **measure on staging under synthetic concurrency** (PR ε) before raising `max`
  and before any global enable. Verifying the ceiling empirically is the only way to avoid
  self-DOSing on the first wide deploy.

---

## 5. Implementation roadmap (proposed PR sequence)

The sequence is **incremental-by-route-family behind the harness**, because the harness gives a
per-batch correctness gate and the blast radius of a wrong wrap is "that family returns 0 rows."

- **PR α — the mechanism + a 1-resource allowlist.**
  Add `asTenant` helper (Option C) + unit tests. Apply it to **`findings` only** (the pilot
  table that already has RLS). Add a test asserting a no-wrap route (e.g. `/health`, a webhook)
  runs with **no** active tenant scope. Green = `crossOrgIsolation` + `findingsRls` pass.
  Tiny, reviewable, exercises the wrap on the one table where RLS is real.

- **PR β — expand the allowlist, one org-scoped family at a time.**
  Plain CRUD families with no explicit BEGIN and no LLM/stream: `vendors`, `risks` (read paths),
  `controls`, `obligations`, `aiSystems`, `policies`, `actions`, dashboard/posture/trends/
  insights reads, etc. Each batch: apply `asTenant`, run harness, manual smoke. Several small PRs,
  not one.

- **PR γ — explicit-`BEGIN` families.**
  `assess`, `vendorAssessments`, `controlAssessments`, `riskTreatments`, `dependencies`,
  `evidence`, `frameworks*`, `governanceReviews`, `aiGovernanceAssessments`, etc. Per file:
  confirm `pg.connect()` usage + no independent-commit requirement (§4.5); wrap; harness. Convert
  to `pgRaw` only the specific handlers that need their own transaction.

- **PR δ — streaming/export + LLM routes.**
  Exports (`findingsExport`, `vendors` CSV, `auditPackage`, `gapReport`, `executiveReport`):
  plain whole-handler wrap (§4.3). LLM routes (`ask`, `transcribe`, `vendorAssessmentAnalysis`,
  brief-generate): scoped-DB / unscoped-LLM split (§4.4), one at a time. Multipart routes: ensure
  the wrap sits **after** multer (§3b.2).

- **PR ε — pool sizing + staging load test.**
  Set explicit `max` + `connectionTimeoutMillis` on both pools across `render.yaml`. Run
  synthetic concurrency on staging (including a burst of slow LLM/export calls) to find the real
  ceiling. Tune `max` against operator-confirmed Postgres `max_connections`. **Gate before any
  global enable.**

- **PR ζ — CI guard + close-out.**
  Add a lint/grep CI check: every handler that mounts `attachOrganizationContext` must be
  `asTenant`-wrapped **or** be on an explicit allowlisted exception. This replaces the manual
  allowlist with an enforced invariant and prevents new unwrapped org-scoped routes. At this
  point the wrap is effectively global-by-enforcement without a risky big-bang `app.use`.

**Why not one big PR / a single global `app.use` wrap?** Because (a) the per-route inline auth
pattern (§1.3) means there is no single point where org context is universally present;
(b) LLM and streaming routes need different handling than CRUD; (c) pool sizing must be validated
empirically before the surface goes wide; (d) the harness gives a natural per-family gate that a
big-bang would squander. Incremental is slower but each step is provably safe.

> **Ordering note vs. operator flip:** all of PR α–ζ can land while production still connects as
> owner (RLS inert), so the wrap is a **no-op-until-flip** behavioral change at the DB layer but
> a **real** behavioral change at the transaction layer (every wrapped request now runs in one
> transaction). That transaction-shape change is what the harness + staging must validate. The
> operator `DATABASE_URL → app_request` flip (phase 3) must come **after** the org-scoped surface
> is fully wrapped — otherwise unwrapped org-scoped reads hit the 0-rows fail-closed path.

---

## 6. Open questions for the operator

1. **Pool sizing inputs.** What is prod peak concurrent request count per service, and p99
   request duration (call out `ask`/brief-generate/export separately)? Needed to size `max`
   (§3e, §4.6).
2. **Postgres `max_connections` ceiling.** What is the limit on the current Render Postgres plan,
   and can it be raised if sizing demands it? We must keep
   `Σ(6 services × 2 pools × max) + migrations + operator + headroom < max_connections`.
3. **Independent-commit requirements among the 24 explicit-`BEGIN` routes (§3a).** Do any of them
   need a sub-unit to commit independently of the request (outbox, audit row that must survive a
   later rollback), or `ISOLATION LEVEL` / advisory locks / `LISTEN/NOTIFY` / `COPY`? If "just
   inherited style," the savepoint proxy handles them for free; if not, they need the `pgRaw`
   escape hatch.
4. **LLM-route isolation appetite.** Are we comfortable leaving `ask`/`transcribe`/brief-generate
   on raw `pg` + explicit org filters until PR δ (and until their per-table RLS lands), or is
   DB-layer enforcement on those reads required sooner? (Drives whether δ moves earlier.)
5. **Staging fidelity for load (PR ε).** Is `securelogic-engine-staging` sized comparably enough
   to prod for a pool-exhaustion test to be meaningful, or do we need a separate load target?
6. **`email_provider_events` migration gap (adjacent).** Tracked separately, but it shares the
   phase-3 flip prerequisite — flagging so it's not forgotten when the flip is scheduled.

---

## 7. Summary for reviewers

- The plumbing (`withTenant`, the `pg` proxy, the savepoint proxy, `withElevated`) **already
  exists and is unit-tested.** This work is **wiring it into the request path**, not building it.
- The central constraint is that `attachOrganizationContext` is **per-route inline (73 files)**,
  not global — so the recommended mechanism is an **opt-in per-handler `asTenant` wrap** rolled
  out family-by-family behind the existing cross-org harness, not a single global `app.use`.
- The explicit-`BEGIN` routes are **mostly free** (savepoint proxy), the export routes are
  **bounded** (query-then-render), and the **real risk is LLM-in-handler routes holding a
  connection across the model call** — handled by a scoped-DB/unscoped-LLM split, sequenced last.
- The **operational gate is pool sizing**: post-wrap, one connection per in-flight request;
  current `max` is the silent default **10**. This must be sized from operator-supplied traffic
  data and **validated on staging before any global enable** to avoid self-DOS.
- The operator `DATABASE_URL → app_request` flip must come **after** the org-scoped surface is
  fully wrapped.

**No code was written or committed in this turn. Awaiting review of this design before any
implementation PR.**
