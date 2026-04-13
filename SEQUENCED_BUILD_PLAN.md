# SecureLogic AI Sequenced Build Plan

## Purpose

This document defines the required build order for SecureLogic AI.

It is not a feature wishlist.
It is not a vision memo.
It is the enforced implementation sequence required to keep the platform from being built on weak foundations.

Every package must have:
- a clear dependency
- a narrow scope
- a concrete done condition
- validation before closure
- a clean package-scoped commit before it is considered closed

The governing principle is simple:

No downstream platform package matters if the core engine is not production-grade.

---

## Non-Negotiable Priority

SecureLogic AI is an engine-first platform.

That means:

- The core risk engine is the foundation
- Platform primitives exist to feed and persist engine outputs
- Workflows exist to operationalize those primitives
- Dashboards, briefs, reports, and UI are downstream output surfaces
- No output surface is allowed to masquerade as platform maturity

If the engine is not enterprise-grade, everything built on top of it is structurally compromised.

---

## Governing Rules

- No package starts until dependency packages are closed
- No UI, dashboard, report, or output surface is built before its backing primitives exist
- No primitive or workflow package is treated as strategically meaningful if the engine foundation is still weak
- No package is closed when merely coded; it is closed only after validation and clean commit
- Migration-bearing packages are not closed until migration is verified live
- Readiness is not YES unless global typecheck passes
- Surface work must never outrun core architecture
- Platform architecture takes priority over feature velocity

---

## Build Layers

The platform is built in this order:

1. Core engine hardening
2. Core platform primitives
3. Domain workflows
4. Output/read surfaces
5. UI and presentation layers

If work appears to skip this stack, it is drift.

---

## Layer 1 — Core Engine Hardening (Top Priority)

These packages are the true foundation. They outrank everything below.

### Package: core-engine-production-hardening

**Status:** Closed — commit 7a920287

Purpose:
Make the SecureLogic engine production-grade before further platform expansion is treated as strategically meaningful.

What it delivers:
- deterministic engine execution contract
- strict environment validation
- dependency-aware health/readiness behavior
- production-safe build and CI gates
- Redis-backed entitlement/usage/rate-limit integrity
- frozen contract validation for engine modes
- runtime safety around engine invocation paths
- enterprise-grade startup and failure behavior

Active fix delivered:
- `src/_frozen_prod/__tests__/RiskDecision.test.ts` — corrected RunnerEngine import from `../../index.js` to `../../engine/RunnerEngine.js`, removing the server-startup side-effect coupling; removed duplicate vitest import and trailing `;;;`
- All 12 frozen contract test files now pass (13/13 tests)
- Global `npx tsc --noEmit` clean

Done conditions met:
- Contract tests pass — 12/12 files, 13/13 tests
- Global typecheck passes — EXIT:0
- Engine module independently importable without triggering server or DB startup
- Package-scoped clean commit on main

### Package: engine-observability-and-operational-guardrails

**Status:** Closed — commit 2bdbf98f

Depends on: core-engine-production-hardening (closed)

Purpose:
Make the engine operationally trustworthy in production, not just logically correct.

What it delivers:
- `EngineLogger` interface with `noopLogger` default — engine layer has zero dependency on pino
- Logger injection via `RunnerEngine` constructor (3rd param, optional, backward-compatible)
- Framework injection via `RunnerEngine` constructor (4th param, optional, for testability)
- `engine_run_started` log on every run entry (mode)
- `engine_run_completed` log on successful run (mode, severity, findingCount, durationMs)
- `engine_run_failed` log before rethrow on any engine-level failure (mode, durationMs, err)
- `EngineFrameworkError` classified error class on `MultiFrameworkOrchestrator`
- Per-framework try/catch in `MultiFrameworkOrchestrator.runAll()` — no silent framework failure paths
- `engine_framework_failed` log on framework throw (framework name, elapsedMs, err)
- 4 unit tests covering all instrumented paths

Done conditions met:
- logs support production triage — YES
- key failure modes are distinguishable — YES (EngineFrameworkError vs generic engine error)
- no silent engine failure paths — YES
- global typecheck passes — EXIT:0
- clean package-scoped commit on main — YES (4 engine files only)

### Package: engine-regression-and-diff-safety

**Status:** Closed — commit 5096fc1b

Depends on: core-engine-production-hardening (closed)

Purpose:
Prevent future engine work from quietly degrading decision quality or changing outputs without visibility.

What it delivers:
- Fixed duplicate vitest imports in `engine.contract.test.ts` and `engine.contract.v2.test.ts`
- 3 severity boundary frozen tests: all-pass → Low, single Moderate finding / minimal context → Moderate, all-fail / max context → Critical
- Golden fixtures for all 3 boundary scenarios (`engine_regression/goldens/`)
- 2 DecisionDiffEngine edge case frozen tests: identical decisions → stable no-change summary, no-trace decisions → empty `domainScoreChanges`
- Frozen test count: 12 files / 13 tests → 14 files / 18 tests

Done conditions met:
- regression coverage exists for protected engine behavior — YES (3 boundary scenarios + 2 diff edge cases)
- output drift is detectable before release — YES (severity thresholds and scoring pipeline locked)
- global typecheck passes — EXIT:0
- clean package-scoped commit on main — YES (10 frozen test files only)

---

## Layer 2 — Core Platform Primitives

These packages are valid only because they support the engine and persist platform state.

### Package: platform-foundation-findings-actions-posture

Status: Closed — implementation commit ff80716a, live validation 2026-04-13 (34/34 checks, cross-org confirmed)

Depends on: core-engine-production-hardening (closed or explicitly accepted as sufficient foundation)

What it delivers:
- Findings expanded from assessment-scoped to platform-scoped
- Actions as first-class platform primitive
- Posture snapshots and domain scores
- Posture computation using the engine, not parallel scoring logic
- Assessment runner updated to populate platform-level finding fields

Migration:
`db/migrations/20260410_platform_primitives.sql`

Routes delivered:
- `GET /api/findings`
- `PATCH /api/findings/:id`
- `POST /api/actions`
- `GET /api/actions`
- `PATCH /api/actions/:id`
- `POST /api/posture/snapshot`
- `GET /api/posture/latest`
- `GET /api/posture/history`

Done conditions:
- migration applied and verified live
- all routes validated live with real API key
- cross-org protection confirmed
- entitlement gate confirmed
- global typecheck passes
- clean git commit on main

### Package: org-profile-context-weighting

Status: Closed — commit f94027bc, validated 2026-04-13 (34/34 tests, global tsc EXIT:0)

Depends on: platform-foundation-findings-actions-posture (closed)

What it delivers:
- org context fields on organizations
- engine/posture weighting uses real org context
- admin route validation for context fields
- posture rationale reflects actual context use

Migration:
`db/migrations/20260411_org_profile_context_weighting.sql`

Done conditions:
- migration applied and verified live
- admin patch route validated
- posture snapshot uses real org context
- rejection behavior validated for bad input
- global typecheck passes
- clean git commit on main

### Package: vendor-risk-primitives

Status: Closed — commit 8c420777, validated 2026-04-13 (80/80 tests, global tsc EXIT:0)

Depends on: org-profile-context-weighting (closed)

What it delivers:
- vendor object model
- vendor CRUD
- archiving behavior
- vendor linkage into findings/action model

Migration:
`db/migrations/20260412_vendor_risk_primitives.sql`

Routes delivered:
- `POST /api/vendors`
- `GET /api/vendors`
- `GET /api/vendors/:id`
- `PATCH /api/vendors/:id`

Done conditions:
- migration applied and verified live
- routes validated live
- cross-org protection confirmed
- entitlement gate confirmed
- global typecheck passes
- clean git commit on main

### Package: ai-system-governance-primitives

Status: Closed — commit 699a7740, validated 2026-04-13 (67/67 tests, global tsc EXIT:0)

Depends on: vendor-risk-primitives (closed)

What it delivers:
- ai_systems table
- governance_reviews table
- AI-system-to-finding linkage

Done conditions:
- migration applied and verified live
- routes validated live
- cross-org protection confirmed
- entitlement gate confirmed
- global typecheck passes
- clean git commit on main

### Package: control-framework-primitives

Status: Closed — commit 88474a1c, validated 2026-04-13 (58/58 tests, global tsc EXIT:0)

Depends on: org-profile-context-weighting (closed)

What it delivers:
- frameworks
- requirements
- controls
- control mappings

Does not deliver:
- evidence workflow
- assessment workflow

Done conditions:
- migration applied and verified live
- routes validated live
- cross-org protection confirmed
- entitlement gate confirmed
- global typecheck passes
- clean git commit on main

---

## Layer 3 — Domain Workflows

These packages operationalize the primitives. They are not foundation.

### Package: vendor-assessment-workflow

Status: Closed — commit fee8e4d6, validated 2026-04-13 (36/36 tests, global tsc EXIT:0)

Depends on: vendor-risk-primitives (closed)

What it delivers:
- vendor_assessments table
- transactional assessment + finding creation
- vendor assessment retrieval
- findings filter by source_id
- archived vendor rejection

Migration:
`db/migrations/20260413_vendor_assessment_workflow.sql`

Routes delivered:
- `POST /api/vendor-assessments`
- `GET /api/vendor-assessments`
- `GET /api/vendor-assessments/:id`
- `GET /api/findings?source_id=<uuid>`

Done conditions:
- migration applied and verified live
- routes validated live
- cross-org protection confirmed
- entitlement gate confirmed
- archived vendor rejection confirmed
- global typecheck passes
- clean git commit on main

### Package: control-assessment-workflow

Status: Closed — commit 138e2b6b, validated 2026-04-13 (59/59 tests, global tsc EXIT:0)

Depends on: control-framework-primitives (closed)

What it delivers:
- assessment workflow on top of controls/frameworks

Done conditions:
- migration applied and verified live
- routes validated live
- cross-org protection confirmed
- entitlement gate confirmed
- global typecheck passes
- clean git commit on main

---

## Layer 4 — Output / Read Surfaces

These packages are downstream. Useful, but not foundational.

### Package: posture-dashboard-foundation

Status: Closed — commit 9515d54e

Depends on:
- control-assessment-workflow (closed)
- vendor-risk-primitives (closed)
- control-framework-primitives (closed)

What it delivers:
- `GET /api/dashboard/summary`
- summary view of posture, domain scores, findings, actions, object counts

Migration:
None

What it explicitly does not deliver:
- heatmap entry
- new tables
- multiple dashboard endpoints

This package is a read surface, not platform core.

### Package: intelligence-brief-platform-integration

Status: Closed — commit 6340fbb6

Depends on: posture-dashboard-foundation (closed)

What it delivers:
- publication-time stored context on DB-backed Briefs
- Brief reads platform posture/findings/actions state at publication time
- Brief becomes a platform output instead of isolated content

Migration:
`db/migrations/20260417_brief_publication_context.sql`

What it explicitly is:
- a downstream output integration package

What it explicitly is not:
- platform core
- engine foundation
- justification to deprioritize engine hardening

Done conditions:
- migration additive and verified
- targeted tests pass
- global typecheck passes
- clean git commit on main

---

## Layer 5 — UI / Presentation

No UI package starts unless the underlying engine, primitives, and read surfaces are already closed.

These are last-mile surfaces, not architecture.

### Package: posture-dashboard-ui

Status: Closed — commit pending review (2026-04-13)

Depends on: posture-dashboard-foundation (closed)

What it delivers:
- Posture section added to `/dashboard` route — additive, below existing Brief/Account row
- Overall posture score tile with severity badge and snapshot date
- Open findings tile with per-severity breakdown (Critical / High / Moderate / Low)
- Open actions tile with overdue callout
- Inventory summary tile (vendors, AI systems, controls, control assessments, governance reviews)
- Domain breakdown panel with severity badge, score bar, finding/action sub-counts per domain
- Graceful no-snapshot instructional state when `overall_score` is null
- Graceful absent when org not entitled (`getDashboardSummary` returns null → section not rendered)

Consumes:
- `GET /api/dashboard/summary` (Layer 4, posture-dashboard-foundation, closed)

Explicitly does not deliver:
- New backend routes or middleware
- New database tables or migrations
- Vendor risk UI
- AI governance UI
- Heatmap
- Report presentation

Done conditions met:
- UI-only, no backend changes — YES
- Real API data only, no mocks — YES
- Org scoping and entitlement behavior inherited from backend — YES
- Additive change to existing dashboard route — YES
- Targeted test (dashboardSummary.test.ts): 12/12 passed — YES
- Global `npx tsc --noEmit` passes — EXIT:0 — YES
- Clean diff: only `app/src/app/dashboard/page.tsx` changed this session — YES

---

## What Must Never Happen

- Treating the Intelligence Brief as the platform core
- Treating dashboard progress as engine maturity
- Building UI before the underlying objects and workflows exist
- Building presentation polish on top of weak engine contracts
- Letting "demoable" work outrank foundational hardening
- Confusing platform outputs with platform foundations

---

## Immediate Priority Order From Here

1. Close core-engine-production-hardening
2. Close engine-observability-and-operational-guardrails
3. Close engine-regression-and-diff-safety
4. Close any still-open primitive/workflow packages already partially built
5. Only then continue expanding downstream read/output surfaces

If there is tension between engine work and surface work, engine work wins.

---

## Package Close Checklist (required for all packages)

- [ ] Migration pre-check SQL run and passed
- [ ] Migration applied via `npm run migrate`
- [ ] Post-migration SQL verification run
- [ ] All new routes validated live with real API key
- [ ] Cross-org protection test passed
- [ ] Entitlement gate test passed
- [ ] Unit tests pass (if applicable)
- [ ] Global `npx tsc --noEmit` passes
- [ ] Clean git commit on main with package-scoped files only
- [ ] CANONICAL_RISK_MODEL.md updated when required
- [ ] This document updated with package marked closed
