# September 15 Program — Execution Status

Session 1, 2026-08-12. Baseline `develop` @ `58285e67`.
**Nothing pushed, nothing merged, production untouched.**

---

## 1. Branches and commits

| Branch | Commits |
|---|---|
| `feat/sept15-va-phase0-truth-repair` | `cf45594f`, `a3e991bd` |
| `feat/sept15-ask-a0-truth-pass` | `0c853aba` |
| `feat/sept15-va-phase1-engagement-spine` | `87b7757a`, `ce52e26f`, `e7c612cd`, `310e3c75`, `59184617`, `6a306ca9` |

Nine commits. Branches are stacked in that order; each is a rollback point.

---

## 2. Gate status

| Gate | Status | Note |
|---|---|---|
| **Gate 0** — VA truth repair | 3/5 PASS | D2 (prod R2) and A.5-style sign-off are operator-owned |
| **Gate A0** — Ask truth repair | **PASS** | 14 regression cases |
| **Stop Gate A** — External Isolation Readiness | **DB-layer PASS** | A.5 human security review outstanding |
| **Stop Gate ASK-A** — Authorization Equivalence | **Engineering PASS** | A.6 review outstanding; A.2 Contributor scoping deferred with reason |
| Gate 1 — Phase 1 complete | PARTIAL | Deterministic core + spine done; routes, UI, `scope_tags` backfill not |
| Stop Gate B / C, ASK-B / ASK-C | Not reached | — |

Full evidence: `sept15-va-phase0-gate0-evidence.md`,
`sept15-stop-gate-a-evidence.md`, `sept15-stop-gate-ask-a-evidence.md`.

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

  **Not yet built:** the 11 portal routes, `requirePortalSession`, the 7 portal
  screens, and the Stop Gate B adversarial suite.

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

| Item | Phase |
|---|---|
| `requirements.scope_tags` column + backfill across 321 requirements | 1 |
| Engagement routes, internal UI, engagement queue | 1 |
| External vendor portal — 11 routes, `requirePortalSession`, 7 screens, adversarial suite (credential model done) | 3 |
| Evidence convergence, analysis worker, exception→finding promotion | 4 |
| Control-effectiveness ladder, residual calculation, decision workflow | 5 |
| Monitoring sweeps, intelligence staleness chain | 6 |
| Legacy demotion of `vendor_assessments` / `vendor_reviews` writers | 7 |
| Provenance / citation verification | A2 |
| Multi-turn conversation UI, streaming | A3 |
| Realtime voice | A5 (P1) |

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

**Operator decision required before Phase 7.**

### B2 — Production R2 configuration (D2)

`render.yaml` sets `SECURELOGIC_VENDOR_ASSURANCE_ENABLED: "true"` on the prod
engine block and declares no `R2_*`. Uploads would 500 with a misleading
`pdf_unparseable`. Not provable from the repository — operator check.

### B3 — No staging or production credentials in this environment

Structurally prevents: staging validation, both end-to-end walkthroughs, the
LLM-unavailable workflow run, and Stop Gate B's external tester. All operator-owed.

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
engine     306 files · 5709 passed · 3 skipped · 0 failed
isolation  141 files ·  975 passed ·             0 failed
typecheck  clean (engine + app)
lint       clean (1 pre-existing warning)
```

Isolation baseline before this work: 138 files / 898 tests. The +3 files / +77
tests are `vendorEngagementsRls` (14), `vendorTierBRls` (48) and
`askToolAuthorizationEquivalence` (15). **Zero regressions** across the
pre-existing 898 despite RLS landing on nine previously-unprotected tables.

A stray `/` had also been left on line 1 of
`20260420_cyber_signals_allow_null_org.sql` in the working tree, making it
invalid SQL. That was reverted; without it no fresh database can bootstrap.
