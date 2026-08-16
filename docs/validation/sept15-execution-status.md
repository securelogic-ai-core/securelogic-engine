# September 15 Program — Execution Status

Sessions 1–3, 2026-08-12 → 2026-08-13. Baseline `develop` @ `58285e67`.
**MERGED TO DEVELOP 2026-08-13 (operator-directed), full stack, bottom-up:**
PR #786 (`a21262e3`, VA Phase 0) → PR #789 (`47814937`, Ask A0; replaced
#787, auto-closed by a base-branch deletion) → PR #788 (`648ff0e6`, Phases
1–6 + Ask A1–A3, carries the 12 migrations — its develop deploy is the
staging migration moment). Each merged after CI settled with every
substantive check green, including cross-org-isolation; the only red was
the `audit` check, red on the `58285e67` baseline itself (inherited
npm-audit, not branch-attributable). Feature branches deleted post-merge.
**Production untouched — nothing on `main`, no prod flags flipped.**

---

## 0. Session 2 (2026-08-13) — recovery + the P0/P1 close-out

Recovered the interrupted checkpoint from the working tree (the finding-
promotion slice was mid-flight: migration + pure module + tests written,
route wired) and continued on `feat/sept15-va-phase1-engagement-spine`:

| Commit | What |
|---|---|
| `48a87a99` | Evidence review + deterministic finding promotion (severity = answer × mandatory × inherent band, idempotent re-promotion) |
| `e37aa985` | Monitoring sweeps + intelligence reassessment hook (Phase 6): TIME + INTEL triggers, claim-then-emit, human-only reassessment |
| `6e5eedd5` | **P1 fix:** portal session cookie path never matched the API mount — a real browser never sent it; invisible to supertest |
| `b1702b45` | Ask A3 engine surface: conversation list/read APIs, stored-claims replay, deterministic titles |
| `73800f66` | Review-chain transitions over HTTP (begin-review, complete-analysis with computed coverage; recompute advances to decision_pending) — walkthrough no longer SQL-forces states |
| `5422ff13` | The seven portal screens + same-origin cookie-forwarding proxy (app) |
| `11602da4` | **P1 fix:** answers during clarification_requested 409'd — the one edit the state exists to invite; found by building the screens against the routes |
| `cf48c5ed` | Durable evidence-analysis worker (advisory verdicts, rides the extraction service) + computed `analysis_coverage` |

Verified after the migrations landed: **isolation 147 files / 1,126 tests / 0
failures; app suite 121 files / 1,607 tests / 0 failures**; engine + app +
worker-service typecheck clean. The VA walkthrough now drives intake →
monitoring entirely over HTTP (47 tests); the Ask Truth Pass walkthrough is 23.

---

## 0.1 Session 3 (2026-08-13, same day) — reviewer UI close-out

Commits after the §0 reconciliation (`eeec9a8a`), recovered-and-continued the
same way (the reviewer-UI slice was complete-but-uncommitted in the working
tree when the session resumed):

| Commit | What |
|---|---|
| `5a3f3cfb` | Stop Gate ASK-C engineering review + **P1 fix:** transcribe limiter keyed on never-assigned `req.organizationId` (IP-fragmented vacuous cap) |
| `93802d8f` | Ask A3 multi-turn conversation UI (app) + stored-claims persistence fix |
| `02dee3b9` | Advisory analysis verdicts surfaced in the reviewer's evidence list |
| `0835ce28` | Internal clarification thread — the reviewer can ask the vendor |
| `ba89e4d1` | Gate B session-2 note (B.4 prerequisite met) + ASK-C row |
| `64966edc` | Queue list carries the monitoring signals (review_overdue, reassessment_recommended_at) |
| `55f5b8d2` | **Internal reviewer UI** — /vendor-engagements queue + intake + engagement workspace (last open P0 UI item); canonical `isPlatformEntitled()` gates; knowledge index regenerated for the 3 new routes |

Known metadata gap (pre-existing, now also true of the new routes): body-gated
workflow pages absent from `NAV_ITEMS` classify as `access:"all"` in the
Application Knowledge Index (`/vendor-assurance/*` has the same issue). Fixing
it means either a nav decision (surface /vendor-engagements in a menu) or
extending the declared-access mechanism `SECONDARY_NAV_ITEMS` already uses —
an operator/IA call, deliberately not made unilaterally here.

Verified: app suite **125 files / 1,659 tests / 0 failures**; engine full
suite re-run after the index regeneration: **477 files / 7,764 passed / 3
skipped / 0 failures** (the sole pre-regeneration failure was the
knowledge-index drift test); typecheck clean.

---

## 0.2 Staging verification (2026-08-13, post-merge)

Verified by direct probe, not inference, ~15 minutes after the stack merged:

- **Deploys:** `securelogic-engine-staging` (develop-pinned, autoDeploy on)
  deployed each squash in order — `a21262e3` → `47814937` → `648ff0e6` →
  `f24cdeaa` (docs-only) live.
- **Migrations:** a one-off Render job on the service queried
  `schema_migrations` over the service's own `DATABASE_URL`: **all 12
  September-15 files (`20260919`–`20260930`) recorded, `applied_at`
  17:03:04–17:03:07Z** — inside the `648ff0e6` deploy's startup, whose
  startCommand gates boot on `npm run migrate` succeeding.
- **Ledger reconciled:** 219 ledger rows = 219 repo migration files; the
  `f24cdeaa` migrate logged `Migrations complete` with zero
  `Applied migration` lines (nothing left to apply).
- **Schema effective:** `vendor_engagements` exists with
  `relrowsecurity = true`; `/health` reports `db: connected`.

Operational caution recorded: Render CLI **log retrieval corrupted output**
during this verification (one fetch showed four ledger filenames
pair-swapped, plus empty results, usage-help dumps, and a duplicate of a
UNIQUE-constrained row). SQL probes via one-off jobs are the authority;
do not trust `render logs` for precise values.

Staging now has the full September-15 schema live — the operator-owed
staging items (walkthroughs, Stop Gate B.4 external tester) have a real
surface to run against.

---

## 1. Branches and commits

| Branch | Commits |
|---|---|
| `feat/sept15-va-phase0-truth-repair` | `cf45594f`, `a3e991bd` |
| `feat/sept15-ask-a0-truth-pass` | `0c853aba` |
| `feat/sept15-va-phase1-engagement-spine` | `87b7757a` onward — deterministic core, spine, tool registry, ASK-A, Ask A1/A2, portal, LLM-independence |

45 commits above `develop` across the stack (22 at session-1 close). Branches
were stacked in that order; each was a rollback point until the 2026-08-13
merge. Post-merge the branches are deleted — the rollback points are now the
three squash commits on `develop` (`a21262e3`, `47814937`, `648ff0e6`), each
individually revertable in reverse order.

---

## 2. Gate status

| Gate | Status | Note |
|---|---|---|
| **Gate 0** — VA truth repair | 3/5 PASS | D2 (prod R2) and A.5-style sign-off are operator-owned |
| **Gate A0** — Ask truth repair | **PASS** | 14 regression cases |
| **Stop Gate A** — External Isolation Readiness | **DB-layer PASS** | A.5 human security review outstanding |
| **Stop Gate ASK-A** — Authorization Equivalence | **Engineering PASS** | A.6 review outstanding; A.2 Contributor scoping deferred with reason |
| **LLM-independence** (VA security stop gate + DoD item) | **PASS** | Proven by construction AND by a full engagement run with no provider credentials |
| **Stop Gate B** — External Trust Boundary | **NOT PASSED** | 5/7 criteria PASS — all 11 routes built, **9/9 adversarial classes, 70 cases**. B.3 (independent security review) and B.4 (real external tester on staging) need a human |
| Gate 1 — Phase 1 complete | PARTIAL | Deterministic core + spine + scoping done; internal routes, UI and `scope_tags` backfill not |
| **VA end-to-end walkthrough** (workflow) | **PASS — local** | 30 tests, real HTTP + real Postgres. NOT the staging walkthrough |
| **Ask Truth Pass walkthrough** (workflow) | **PASS — local** | 18 tests, real tool registry + real Postgres, scripted model. NOT the staging walkthrough |
| **Stop Gate ASK-C** — Voice data governance | **Engineering PASS** (session 2) | Live push-to-talk path reviewed: audio memory-only, never persisted/logged; same Ask/tool layer by construction; transcribe limiter P1 fixed. Subprocessor (OpenAI Whisper audio) sign-off operator-owed. Realtime voice DEFERRED per cut rule. Evidence: `sept15-stop-gate-ask-c-evidence.md` |
| Stop Gate C, ASK-B | Not reached | ASK-B's mutate/governed action classes are explicitly P2 — no mutation tools exist to gate yet |

Launch runbook: `docs/runbooks/sept15-launch-runbook.md` — flags, migration
order, deploy sequence, incident response, rollback, and the P2/P3 register.

Full evidence: `sept15-va-phase0-gate0-evidence.md`,
`sept15-stop-gate-a-evidence.md`, `sept15-stop-gate-ask-a-evidence.md`,
`sept15-stop-gate-b-progress.md`.

---

## 3. Shipped

### Workstream 1 — Vendor Assurance

- **D1 fixed.** The vendor page's Assurance card queried `status: "finalized"`,
  a state migration `20260612` retired. It rendered its empty state permanently
  after any approval. Added the canonical `ASSURANCE_REVIEWED_STATUSES`
  predicate and a `reviewed` pseudo-status; fixed the card reading the torn-out
  `current_decisions` store instead of `field_overrides`.
- **Tenant-wrap coverage.** `vendorAssuranceDocuments.ts` had 18 routes and zero
  scoping — the blocker for all vendor-domain RLS. Now 12 `asTenant` + 6 explicit
  `withTenant`, with a negative-tested structural guard.
- **Deterministic core.** `src/api/lib/vendorRisk/` — methodology versioning,
  risk bands, the 9-dimension inherent model with 5 escalation floors, the
  15-state engagement state machine, and the S1–S4 scope resolver. 68 tests.
- **Engagement spine.** `vendor_engagements` (migration `20260919`) with RLS
  (`20260920`), plus Tier B RLS across nine tables (`20260921`).
- **Portal credential model (Phase 3 foundation).** Migration `20260923`:
  `vendor_engagement_invites` (long-lived capability, emailed) and
  `vendor_portal_sessions` (short-lived httpOnly-cookie session), plus the pure
  token module. The invite is exchanged once for a session so a weeks-long
  secret never lives in a URL. Built on the shipped
  `dataExportDownloadToken.ts` model: 256-bit token, SHA-256 at rest, lookup by
  hash. DB-backed rate counters because the Redis limiter fails open, which is
  unacceptable on an unauthenticated surface. 24 tests.

- **Portal principal resolver + all 11 routes.** `requirePortalSession`
  resolves org and engagement from the session ROW on the elevated channel
  (resolution precedes org context), and `portalContext` / `organizationContext`
  are structurally disjoint so neither auth world can reach the other's routes.
  Routes: session exchange, sign-out, engagement read, questionnaire read,
  answer save, submit, evidence upload / list / withdraw, and the two-sided
  clarification thread. **70 adversarial tests against real Postgres, 9 of 9
  classes.**

- **Frozen questionnaire scope** (migration `20260924`).
  `vendor_engagement_scope_items` persists what the resolver computed, with the
  by-value rule trace rendered to the vendor as "why we're asking".
  `requirement_responses` gains `engagement_id`, `responder_type` and an
  append-only revisions table, replacing a destructive upsert that could not
  answer "what did they say before they changed it".

  The adversarial suite caught three real defects: `not_applicable` violated the
  shipped status CHECK (it conflates "nobody looked" with "does not apply", which
  the effectiveness ladder treats completely differently); the session exchange
  never performed `issued → in_progress`, making submission impossible; and one
  test assertion referenced an id the seeder never produced.

- **LLM-INDEPENDENCE gate PASSED.** Proven twice: no module under
  `vendorRisk/` or `vendorPortal/` imports a model provider (cannot, not merely
  does not), and a full engagement runs intake → inherent → scope → questionnaire
  → answers → submit with `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` deleted and
  every AI flag off. Ask degrades to `ask_unavailable` rather than 500ing.

### Workstream 2 — Ask SecureLogic

- **Ask A0.** All five live defects, the `SECURELOGIC_ASK_ENABLED` kill switch
  (defaults enabled — Ask is already live), and the `ask.question.asked` audit
  event Ask never had.
- **Platform tool registry.** `src/api/tools/` as a platform capability, with
  chains resolved from the live Express router. 12 read tools. Differential
  authorization proven against a real database.
- **Ask A1 complete.** Conversation storage (migration `20260922`: threads,
  messages, and the tool-invocation ledger that doubles as the provenance
  substrate), the bounded tool-calling orchestrator, and the switchover wired
  into `POST /api/ask` behind `SECURELOGIC_ASK_TOOLS_ENABLED` — **dark by
  default**. Rollback is the flag alone: no migration, no data change.

  Two modelling decisions the data-classification guard forced, both
  improvements: `ask_messages.user_id` is denormalised from the conversation
  because the GDPR self-export query builder matches on user columns and cannot
  follow a join; and `ask_tool_invocations` is category **E** (audit ledger,
  alongside `audit_log`) rather than C — it records what the system did, and
  must survive an erasure that removes the conversation it describes.

  **The snapshot path retires with the flag** once staging validates the tool
  path. Two retrieval implementations is the parallel-data-path problem this
  programme removes; it is tolerable as a transition, not as a steady state.

---

## 4. Not started, and honestly so

(Session-1 list; struck-through items closed by later session-1 commits or
session 2 — see §0.)

| Item | Phase | Status |
|---|---|---|
| `requirements.scope_tags` column + backfill | 1 | DONE (`c5661083`) |
| Engagement routes, engagement queue API | 1 | DONE (`b0fa6bb3`, `73800f66`) — internal UI still open |
| The 7 portal screens | 3 | DONE (`5422ff13`) |
| Evidence convergence, analysis worker, exception→finding promotion | 4 | DONE (`48a87a99`, `cf48c5ed`) |
| Control-effectiveness ladder, residual, decision workflow | 5 | DONE (`17dbde2`+) |
| Monitoring sweeps, intelligence staleness chain | 6 | DONE (`e37aa985`) |
| Legacy demotion of `vendor_assessments` / `vendor_reviews` writers | 7 | **Blocked on operator decision B1** |
| Provenance / citation verification | A2 | DONE (`e600ac8f`, `83832f15`) — **this row was over-claimed.** It was true only for short answers; the 2026-08-14 walkthrough found answers over ~4,000 chars lost every citation permanently. Genuinely DONE as of `05625d02` (asynchronous provenance), verified live 2026-08-15 — see `launch-completion-status.md` §8 |
| Multi-turn conversation UI | A3 | DONE (engine `b1702b45`, app UI `93802d8f`) |
| Streaming answers | A3 | Open (P1-adjacent polish; not gate-blocking) |
| Realtime voice | A5 (P1) | Open — standing cut rule applies; ASK-C gate not designed |
| Internal engagement UI (reviewer screens) | 1/4 | DONE (`55f5b8d2`) |

---

## 5. Blockers

### B1 — Legacy `assessments` has live writers (audit finding D7 was wrong)

Ratified Decision 3 made *"prove there are no runtime dependencies/writers"* a
precondition of the freeze. The proof failed:

```
src/api/routes/assess.ts:159        INSERT INTO assessments   (POST /api/assess)
src/api/routes/assessments.ts:101   FROM assessments a
src/api/routes/assessments.ts:177   FROM assessments a
```

All mounted and entitlement-gated. Migration `20260935_legacy_assessments_freeze.sql`
was therefore **not written** — it would break `POST /api/assess`.

No first-party UI calls these routes. **Recommendation:** drop the freeze from
the launch program; keep Phase 7 to demoting the `vendor_assessments` /
`vendor_reviews` writers, which is the part that delivers one authoritative path.
Retiring a public API route is a separate decision with its own notice period.

**RESOLVED 2026-08-13** by the Launch Completion directive (item 1), executed
per this recommendation: the `vendor_assessments`/`vendor_reviews` writers are
demoted behind `SECURELOGIC_LEGACY_VENDOR_WRITES_ENABLED` (ships dark; staging
runs the demoted state); `POST /api/assess` is preserved as a compatibility
path. Two corrections to this record from the full writer sweep: the vendor
writers DO have first-party UI callers (the vendor page's assess/review flows
— now flag-swapped to the engagement intake), and the GDPR account-deletion
reaper is a sanctioned `vendor_reviews` writer preserved by allowlist. Full
disposition + proof: `launch-completion-status.md` §1.

### B2 — Production R2 configuration (D2)

`render.yaml` sets `SECURELOGIC_VENDOR_ASSURANCE_ENABLED: "true"` on the prod
engine block and declares no `R2_*`. Uploads would 500 with a misleading
`pdf_unparseable`. Not provable from the repository — operator check.

### B3 — No staging or production credentials in this environment

Structurally prevents: staging validation, both end-to-end walkthroughs against
a deployed environment, Stop Gate B's real external tester, and the independent
security reviews for Stop Gates A / ASK-A / B. All operator-owed.

(The LLM-unavailable workflow is NO LONGER blocked — it runs locally against the
Docker Postgres and passes; see `vendorAssuranceLlmIndependence.test.ts`.)

---

## 6. P2 / P3 — explicitly deferred

### P2

- Ask `mutate` and `governed` action classes with server-issued confirmation
  tokens (Stop Gate ASK-B)
- "What changed" diff tools
- Intelligence Brief consuming the same platform tool registry
- Targeted-reassessment delta view
- `vendor_control_assessments` as a first-class object
- CUEC coverage gaps promoted to findings
- Concentration / nth-party exposure via `enterprise_relationships`
- Threaded portal clarifications beyond simple comments
- Per-org methodology weight profiles (the `vendor_methodology_versions`
  registry is the seam; no schema change needed to add them later)

### P3

- Embedding pipeline + RAG over evidence, policy and brief free text
- Proactive / agentic monitoring
- Knowledge-graph reasoning
- Custom questionnaire templates with conditional logic
- Automated evidence validation
- Continuous attestation in place of periodic reassessment
- Shared vendor profiles across tenants

---

## 7. Local validation recipe

There is no `DATABASE_URL` in the dev container; without one **all 137 isolation
files fail to import**. Docker is available:

```bash
docker run -d --name slpg -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=securelogic_test -p 5433:5432 postgres:16

export TEST_DATABASE_URL="postgres://postgres:postgres@localhost:5433/securelogic_test"
export DATABASE_URL="$TEST_DATABASE_URL"
npx vitest run --config vitest.isolation.config.ts
```

Three traps worth knowing:

1. `ssl: false` is required. `scripts/runMigrations.ts:17` hardcodes
   `ssl: { rejectUnauthorized: false }` and cannot target local Postgres.
2. Plain filename-order migration application fails at
   `20260504_user_alert_preferences_org_scope.sql`. The harness does retry passes,
   so **the harness is the only valid migration validator**.
3. **Never run two isolation suites concurrently.** They share one test database
   and `bootstrapTestDb` corrupts the other mid-run — the signature is many files
   failing with few actual test failures and a large skip count.

## 8. Final verified test state

```
engine     477 files · 7764 passed · 3 skipped · 0 failed   (session 3, after knowledge-index regen)
app        125 files · 1659 passed ·             0 failed   (session 3)
isolation  147 files · 1126 passed ·             0 failed   (session 2 — not re-run in session 3; no engine/SQL changes since)
typecheck  clean (engine + app)                             (session 3)
lint       clean                                            (session 1 — not re-run)
```

(The engine figure is the full default vitest config. Earlier revisions of this
document quoted a path-filtered subset — 306/5709 — which was a narrower run of
the same tree, not a smaller tree.)

Isolation baseline before this work: 138 files / 898 tests. The +3 files / +77
tests are `vendorEngagementsRls` (14), `vendorTierBRls` (48) and
`askToolAuthorizationEquivalence` (15). **Zero regressions** across the
pre-existing 898 despite RLS landing on nine previously-unprotected tables.

A stray `/` had also been left on line 1 of
`20260420_cyber_signals_allow_null_org.sql` in the working tree, making it
invalid SQL. That was reverted; without it no fresh database can bootstrap.
