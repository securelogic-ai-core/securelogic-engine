# September 15 Launch Completion Program — Execution Status

Baseline: `develop` @ `bc53ae82` (master program merged: #786/#789/#788;
September-15 schema live and probe-verified on staging; production untouched).
Operator directive 2026-08-13: execute the six deferred items in priority
order, preserving the ratified architecture and every passed security gate.

Branch discipline: one branch per item (`feat/lc<N>-*`), separately reviewable
from the merged master program. Nothing in this program touches production
without explicit authorization; prod-affecting flags ship dark.

| # | Item | Branch | Status |
|---|---|---|---|
| 1 | B1 legacy VA demotion | `feat/lc1-b1-legacy-va-demotion` | **Built — validated** |
| 2 | Ask access truth | `feat/lc2-ask-access-truth` (stacked on LC-1) | **Built — validated** |
| 3 | Ask streaming | `feat/lc3-ask-streaming` (stacked on LC-2) | **Built — validated** |
| 4 | Realtime voice | — | Not started |
| 5 | Bounded agentic Ask | — | Not started |
| 6 | Platform convergence | — | Blocked on 1–5 |

---

## 1. B1 legacy Vendor Assurance demotion

**Operator decision B1 is resolved by the Launch Completion directive**: make
`vendor_engagements` the single canonical workflow writer; freeze/demote the
legacy writers; preserve compatibility/read paths; prove no competing writer.

### Scope ruling

The demoted set is `vendor_assessments` + `vendor_reviews` — exactly the set
the spine migration's own contract names (`20260919_vendor_engagements.sql:
25-28`). `assessments` / `POST /api/assess` is the generic assessment runner,
a public API **compatibility path preserved per the directive** — the Gate 0
record classifies its retirement as a separate decision with a notice period
(`sept15-va-phase0-gate0-evidence.md` §4). It does not compete with the vendor
workflow.

### Writer disposition (complete inventory, verified at bc53ae82)

| Writer | Table | Disposition |
|---|---|---|
| `POST /api/vendor-assessments` (`vendorAssessments.ts`) | vendor_assessments INSERT | **Demoted** — flag-gated 410 |
| `POST /api/vendor-reviews` (`vendorReviews.ts`) | vendor_reviews INSERT | **Demoted** — flag-gated 410 |
| `PATCH /api/vendor-reviews/:id` (`vendorReviews.ts`) | vendor_reviews UPDATE | **Demoted** — flag-gated 410 (before the assignment probe, so the demoted state cannot enumerate review ids) |
| App UI callers (`vendors/[id]/assess`, `/review`, page CTAs ×6, CompleteReviewSection) | via the above | **Demoted** — CTAs swap to the engagement intake (`/vendor-engagements/new?vendorId=…`), forms replaced by retirement notices, server actions refuse first |
| Account-deletion reaper (`accountDeletionReaper.ts`) | vendor_reviews UPDATE (reviewer_id scrub) | **Preserved** — GDPR erasure obligation, not a workflow writer (ADR-0005 precedent); allowlisted in the structural guard |
| Seed scripts (`seed-demo.ts`, `seed-walkthrough-org.ts`) + isolation-test fixtures | direct SQL | **Preserved** — operator/test data fixtures outside the product workflow and outside src/ |
| `POST /api/assess` (`assess.ts`) | assessments INSERT | **Out of scope** — compatibility path (see scope ruling) |

### Mechanism

- `SECURELOGIC_LEGACY_VENDOR_WRITES_ENABLED` — same name on engine and app
  (two-switch model). **Default ON; only the literal `"false"` disables**
  (these are live prod surfaces with first-party UI callers — the demotion
  ships dark per GATE B; the prod flip is an operator cutover step).
- Engine: 410 Gone with one canonical body (`legacyVendorWriteFlag.ts`) before
  any validation or DB work; every rejection writes a
  `*.legacy_write_rejected` audit event so the cutover runbook can watch for
  stragglers. Reads untouched.
- App: every legacy write CTA swaps to the engagement intake (with vendor
  preselect, validated against the picker list); `/assess` and `/review` pages
  render retirement notices; in-progress reviews show a read-only note.
- **Metric truth**: the ratified ASSESSED VENDOR definition is extended —
  `vendor_assessments` OR `vendor_engagements` existence (monotone; same
  existence-based no-status-qualifier stance as the 2026-08-09 ruling).
  Without this, every engagement-assessed vendor would report "never assessed"
  forever once legacy writes freeze. `assessment_count` /
  `latest_assessment_at` deliberately still count legacy records only
  (renaming/merging is item 6 convergence work).

### Proof of no competing writer

1. `legacyVendorWriterGuard.test.ts` — structural scan of `src/`: any
   INSERT/UPDATE/DELETE on the two tables outside the allowlist (three gated
   route sites + the reaper policy) fails the suite with file:line. The
   allowlist itself is asserted accurate, and the gated files are asserted to
   reference the flag.
2. `legacyVendorWriteDemotion.test.ts` — 410 + audit + no-DB-work on all three
   routes when demoted; pure passthrough when not; reads exempt.
3. The full writer inventory above (agent sweep of routes, workers, seeds,
   dead zones — evidence in this doc's table).

### Deferred within this item (deliberate)

- **DB-level freeze** (blocking trigger per the `20260725` WORM pattern +
  grant narrowing in `20260618`): correct only AFTER the prod flip — a
  trigger now would break live legacy writes while the flag still allows
  them, and it needs an erasure escape hatch for the reaper. Belongs to the
  cutover runbook as post-flip hardening.
- In-progress legacy reviews at flip time become permanently in_progress
  (read-only). Cutover guidance: flip when no reviews are in_progress, or
  accept the frozen state — rows stay visible either way.
- `assess_vendor.yaml` in the workflow registry (Ask's how-to corpus)
  describes the legacy assess/review flows — rewrite it around the engagement
  workflow AT the prod flip, or Ask will narrate a retired path. (Found
  during LC-2.)

### Validation (2026-08-13, at commit)

```
engine     480 files · 7791 passed · 3 skipped · 0 failed
app        126 files · 1671 passed ·             0 failed
isolation  147 files · 1135 passed ·             0 failed   (real Postgres; includes the tenant-wrap
                                                             suite POSTing through the new gate with the
                                                             flag defaulted — passthrough proven live)
typecheck  clean (engine + app)
```

New tests: 15 (route gating + audit + enumeration-resistance + structural
writer guard, engine) + 12 (flag semantics + CTA targets, app). Updated: the 8
`vendorsAssessmentCounts` SQL-shape assertions now hold the TWO-leg
never-assessed predicate (both legs org-scoped inside the correlation), and
the list/aggregate equivalence extractor walks the new `NOT (…)` span.

---

## 2. Ask access truth

**Defect**: body-gated pages absent from both navigations classified
`access:"all"` in the Application Knowledge Index, and Ask's prompt is
rendered from that index — so the assistant could route a customer to a
surface whose page-body guard bounces them to /dashboard. The sweep found
**12 misclassified routes** (`/vendor-engagements×3`, `/vendor-assurance×2`,
`/approvals`, `/evidence`, `/posture`, `/getting-started`,
`/settings/organization`, `/settings/security`, `/account/team` — the last
found by the new honesty test, not the manual sweep).

**Fix, reusing canonical primitives only (no parallel permission system):**

1. `ROUTE_ACCESS_DECLARATIONS` (navigation.ts) — declared body-gate access
   for nav-orphaned routes, exactly the mechanism `SECONDARY_NAV_ITEMS.access`
   already uses. Longest prefix wins; a declaration never overrides
   nav-derived access. Consumed by the index builder/generator/drift test.
2. `collapseEntitlementLevel()` — the entitlement collapse `requireEntitlement`
   always applied inline, now EXPORTED as the canonical class mapping and the
   middleware refactored onto it (no behavior change).
3. `renderProductKnowledge(requesterClass?)` — with a class, every
   destination and workflow the class cannot use is OMITTED from the prompt
   (nav items, secondary items, and workflows via their existing
   `permissions` field). Admin items stay annotated ("[admin only]") —
   admin is a role inside an org of any entitlement, which entitlement
   cannot decide. No class = full corpus (back-compat).
4. `ask.ts` — three memoized per-class system prompts (prompt caching stays
   effective); both the tool path and the snapshot path select by
   `collapseEntitlementLevel(organizationContext.entitlementLevel)`.

**Honesty enforcement**: a new test scans EVERY page.tsx for body-gate
patterns (`if (!isPlatform…`, admin-role redirects, `entitlement !==
"starter"`) and fails the build if a gated page classifies `"all"` —
the metadata can no longer silently rot. Plus per-class filtering tests
(starter sees no platform surface; professional sees premium but not
platform; premium = full corpus byte-identical to the unfiltered render).

### Validation (2026-08-13, at commit)

```
engine     480 files · 7856 passed · 3 skipped · 0 failed
app        126 files · 1671 passed ·             0 failed
isolation  147 files · 1135 passed ·             0 failed   (FRESH Postgres required — rerunning against
                                                             a database left over from a prior isolation
                                                             run reports ~39 file failures that are stale-
                                                             state artifacts, not code defects)
typecheck  clean (engine + app)
index      `npm run generate:knowledge-index` reproduces the committed
           artifact byte-identical (zero drift)
```

New tests: +65 in `applicationKnowledgeIndex.test.ts` (18 → 83): the access-
truth suite generates one test per body-gated page (so a new gated page is
automatically covered) plus the per-class filtering suite (starter/
professional/premium corpus expectations, premium ≡ unfiltered byte-identical,
admin-annotation preservation). The generated-index diff flips 13 access
values, every one a tightening (9 → platform, 2 → admin, 2 → premium);
no route loosened.

---

## 3. Ask streaming

**Item**: the A3 leftover "Streaming answers" (sept15-execution-status §4 —
P1-adjacent polish, not gate-blocking). A tool-path turn takes 10–30s of model
rounds and retrieval; the answer arrived as one JSON blob at the end.

**Shape — one turn implementation, two transports:**

1. `runAskOrchestration` gains an optional `onEvent` callback. With it, model
   turns run through the SDK's streaming API (`messages.stream`) and emit
   `round` / `delta` / `tool_call` events; without it, behaviour is
   byte-identical to before (every pre-existing orchestrator test passes a
   client with NO `stream` method — that is the proof).
2. `POST /api/ask/stream` (engine) — the tool-path turn logic extracted to
   `runAskToolTurn` and shared with the JSON route, so the SSE `final` event
   is byte-shape-identical to the JSON body (asserted by test). Identical
   middleware chain INCLUDING the same rate-limiter instance (one 20/min
   per-org budget across both endpoints). All validation answers plain JSON
   BEFORE the SSE upgrade; after it, failure is an `error` event with the 502's
   wording. Audit: same `ask.question.asked` event + `streamed: true|false`.
3. `app/api/ask/stream` (app) — same-origin proxy, iron-session → Bearer,
   pipes the SSE body through UNBUFFERED (`engineRes.body` handed to the
   Response; the vendor-portal proxy's arrayBuffer pattern would defeat it).
4. `AskClient` — `streamAsk()` fetch-reader consumer (chunk-boundary-safe SSE
   parser, separately unit-tested) rendering a preview bubble: retrieval
   activity line + accumulating deltas, reset per `round`, always REPLACED by
   `final` (the provenance pass may re-render prose after the last delta). A
   stream that ends without `final` is an error, never a success — a
   half-delivered preview cannot be mistaken for an answer.

**Flags (dark, two-switch):** `SECURELOGIC_ASK_STREAMING_ENABLED` on both
engine (404 when off, and streaming also requires `ASK_TOOLS` — no investment
in the retiring snapshot path) and app (page passes `streamingEnabled` at
render; a dark deployment costs zero probe requests; a 404 mid-session latches
a silent fallback to the server action). Rollback is the flag; no migration,
no schema change, no new SQL.

**Old blocker resolved by construction**: "asTenant throws on streaming" does
not bite — ask.ts never used the wrap; every `withTenant` scope commits before
the model round-trips, and the SSE handler documents it must never be wrapped.

### Validation (2026-08-13, at commit)

```
engine     483 files · 7889 passed · 3 skipped · 0 failed
app        126 files · 1689 passed ·             0 failed
typecheck  clean (engine + app)
isolation  NOT re-run — deliberate: LC-3 adds no SQL, no schema, no tenant-
           wrap change, and no new DB access path (the SSE route reuses
           runAskToolTurn's committed-before-model-call withTenant scopes);
           the LC-2 fresh-Postgres pass at this branch's base still covers
           the data layer.
```

New tests: 33 — engine 15 (SSE contract: dual-flag 404s, JSON-before-upgrade
validation, frame ordering, final ≡ JSON-body parity, error-event wording,
streamed:true|false audit; orchestrator: round/delta/tool_call emission,
denial events, throwing-listener immunity) + app 18 (chunk-boundary-safe SSE
parser incl. \r\n and multi-data frames; streamAsk outcome union — final,
fallback on 404/rewritten response, structured HTTP errors, terminal error
event, stream-without-final = error; proxy: 401 pre-engine, Bearer + body
forwarding, unbuffered pipe-through, status passthrough, 502 on unreachable).

One pre-existing test updated: `vendorEntitlementGate.test.ts`'s structural
census of `requireEntitlement("premium")` sites in ask.ts (3 → 4) — the
census caught the new gate exactly as designed.
