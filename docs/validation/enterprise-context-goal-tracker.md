# Enterprise Context / Risk Intelligence — Goal Tracker

Living tracker for the multi-slice mission to complete the Enterprise Context / Risk
Intelligence workstream on `develop`. Re-read the goal + `BUILD_SEQUENCE.md` + the P5
foundation docs at the start of each session, then resume from the item table below.

**Governing invariants (never violated):** `main` FROZEN at `512cfa5a`; everything DARK
behind flags (default off, additive-only); branch off `origin/develop`; feature PRs
squash-merge + delete branch, CI 8/8 green; tenant scoping + inert RLS + `dataClassification`
on every new table; operator-only actions go to the ledger, never performed here; prod
enablement is out of scope (GATE B).

**Merge-strategy note:** PRs #464/#465 were merged with **merge-commits** (operator-directed
at the time, pre-goal). From Slice 3 onward, feature PRs **squash-merge + delete branch**
per the goal.

Last updated: 2026-07-03 (Items 1–2 DONE; Item 3/S4 DONE — 4a+4b merged, 4c writer pending merge; next Item 4/S5 Explainability).

---

## Item status

| # | Item | Status | PRs / SHAs | Flags | Ledger refs |
|---|---|---|---|---|---|
| 1 | Pre-merge audit of #464/#465; fix Critical/High; merge | **DONE** | #464 (merge `1f308e61`), #465 (merge `7843cf62`); branches deleted | `SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED` (off) | L-1, L-2 |
| 2 | Slice 3 — CSV/spreadsheet import (assets, vendors, apps, AI systems, data stores) | **DONE** | #467 (squash `17627ac7`) + prereq dep-fix #468 (squash `205c39ef`); branches deleted | `SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED` (declared in render.yaml, off) | L-3 |
| 3 | Slice 4 — Applicability Engine (deterministic decision fn) | **DONE** — 4a pure fn (`2a9e4b96`) + 4b WORM persistence (`e4b63b5e`) + 4c writer (this PR). Reproducible + test-locked. Live enqueue/fan-out worker (4d) delivered under S7/Item 6 (reassessment). | #469 (4a); #470 (4b); this PR (4c) | `SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED` (declared, off) | — |
| 4 | Slice 5 — Explainability surface | **DONE (pending merge)** — pure render layer over stored decision | this PR (S5) | none (pure, inert — no callers) | — |
| 5 | Slice 6 — Workflow automation (findings/risk/tasks/notifications) | **core DONE (pending merge)** — pure recommendation-derivation + idempotency; live dispatcher adapter TODO | this PR (S6 core) | none (pure, inert — no callers) | — |
| 6 | Slice 7 — Signal→platform linkage (dependency, reassessment, drift) | **core DONE (pending merge)** — pure reassessment triggers + drift detection; live worker adapter TODO | this PR (S7 core) | none (pure, inert — no callers) | — |
| 7 | UI/CX — context screens, graph view, dashboards | TODO | — | — | L-4 (app build via CI) |
| 8 | Connectors (ServiceNow/Defender/CrowdStrike/Wiz/Tenable/cloud/identity) — dark, mock-tested | TODO | — | per-connector flags | L-5.. (per-connector creds) |
| 9 | Enterprise gating (after GATE A ruling) | **BLOCKED — GATE A** | — | AD-17 capability grant | L-1 |
| 10 | Scale validation (recursive load, EXPLAIN, partitioning) | TODO | — | — | L-6 (staging load env) |
| 11 | Governance docs → as-built (CANONICAL, arch, runbooks, rollback) | IN-PROGRESS | this PR (scaffolding) | — | — |

### Decision gates
- **GATE A** (before Slice 9): Platform-vs-Enterprise access model + AD-17 capability-grant shape + entity/edge caps. **Simmee ruling required.** Prepare options/tradeoffs, then STOP and ask. Not yet reached (Slices 3–8 come first).
- **GATE B** (absolute): nothing enabled in production under this goal, ever. GA enablement is outside this goal's authority.

---

## Item 1 — Pre-merge audit (DONE)

**Scope:** independent architecture + security audit of PRs #464 (ECL Slice 1) and #465
(ECL Slice 2 + 2b: relationship graph + resolver), before merge to `develop`.

**Findings + resolution (all fixed on-branch before merge):**
- **C1 (Critical, governance):** `BUILD_SEQUENCE.md` still read docs-only / P4-gated while the
  code was built. Reconciled with a BUILD AUTHORIZATION block recording the operator's
  explicit ECL S1/S2 build authorization + P4-gate waiver.
- **F1 (High):** DELETE handlers returned `204 + res.send()`; under `asTenant` the
  buffering proxy throws on `send()` → rollback + false audit event. Fixed → `200 + json`.
- **F3 (Medium→fixed):** the live app-layer defense (handler org-scoping) had no test — the
  isolation tests only exercised raw SQL (which is why F1 slipped). Added 16 handler-level
  cross-org negative-path tests (entities, relationships, graph seed → 404; DELETE → 200 JSON).
- **No Critical security findings; no cross-tenant leak.** RLS shape, grants, flag gating,
  SQL-injection surface, and graph-traversal isolation all verified correct.

**Deferred to prod-enable gate (NOT merge blockers — recorded in BUILD_SEQUENCE + ledger):**
- **H1:** companion edge cap on `enterprise_relationships` (edge write path unmetered).
- **H2:** graph resolver load test at enterprise fan-out (per-path recursive-CTE blow-up risk;
  materialized-adjacency fallback designed, not built).
- **AD-17:** `requireEntitlement("premium")` reaches every rank-4 org (can't distinguish
  Enterprise from Platform/Team) → GATE A.

**Result:** both PRs merged to `develop`, flag-inert; branches deleted; `main` unchanged.

---

## As-built on develop (Slices 1–2)
- **Slice 1:** `enterprise_entities` header + `enterprise_data_stores` typed child (migrations
  `20260717`–`20260719`) + `organizations.max_enterprise_entities` cap (separate counter) +
  inert RLS + `app_request` grant; flag/metering/validator libs; org-scoped CRUD; tests;
  GDPR classification; CANONICAL registration.
- **Slice 2 + 2b:** `enterprise_relationships` edge (migrations `20260720`–`20260721`) + inert
  RLS + grant; edge CRUD (two-endpoint same-org pre-flight, soft-delete); read-time bounded
  graph resolver `GET /api/enterprise-graph` (repo's first `WITH RECURSIVE`; AD-13 union of
  generic edges + `ai_system_vendor_dependencies`).

## Slice 3 — CSV/spreadsheet import (as-built)
- **Pure core** `enterpriseContextImport.ts` (`planImport`) — deterministic per-row plan
  (ok/invalid/duplicate_in_file/duplicate_in_db/cap_exceeded); dispatches all 5 types to the
  manual-create validators; cap-agnostic. 14 unit tests.
- **Parser** `enterpriseImportParser.ts` — CSV + XLSX via exceljs, lowercased headers, blank-row
  skip, `MAX_IMPORT_ROWS` guard. 3 round-trip tests.
- **Route** `POST /api/enterprise-context/import?entity_type=&mode=preview|commit` — multer
  memoryStorage (5 MB), flag-gated, asTenant; preview = dry-run plan, commit = insert `ok` rows
  in one tenant tx (`ON CONFLICT DO NOTHING`), audited. Enterprise types → `enforceEnterpriseEntityLimit`;
  vendor/ai_system → `enforceEntityLimit`. 8 handler tests (guards, preview, commit, cap).
- **v1 scope note:** import does NOT assign `owner_user_id` (IDOR-safe — no cross-org user refs);
  owners assigned post-import. No new table (synchronous preview+commit).
- **Flag now declared** in `render.yaml` (`= "false"`, 4 service blocks) — governance-hygiene item closed.

## Slice 4a — pure IAE applicability core (as-built)
- **Carve-out of the large S4** (design `ENTERPRISE_CONTEXT_ARCHITECTURE.md` §6–8). S4a = the pure,
  I/O-free reasoning core ONLY; **4b** (WORM/hash-chained `applicability_assessments` + `applicability_evidence`
  + `applicability_affected_entities` tables) and **4c/4d** (dedicated `applicability-worker` + sharded
  queue + fan-out pre-filter) follow as separate slices. Design brief produced by the architecture authority.
- **Module** `src/engine/applicability/v1/` mirroring `src/engine/scoring/v2/`:
  - `ApplicabilityEngineV1.assess(input, policy?)` — pure, deterministic, no clock/RNG/DB. **Consumes** matcher
    candidates + an already-resolved `GraphNeighborhood`; **does NOT re-walk the graph** (AD-13 keeps the resolver
    the single traversal authority) and **cannot query** (so it cannot leak across tenants — tenant scoping is the
    caller's job in a later slice).
  - Decision enum (AD-5) `affected | potentially_affected | not_affected | needs_review | unknown` + `confidence`
    0–100 + band; first-class ordered `reasoning_steps` (the explainability substrate a later slice hash-chains,
    AD-16); normalized `affected_entities` blast radius (in-memory BFS over the passed-in neighborhood).
  - `applicabilityPolicy.ts` = versioned typed rule corpus (`engine_version`/`schema_version` pin every decision);
    golden-case suite is the change-audit (AD-7-support) — a corpus edit that moves a golden requires the
    regenerated fixture + a version bump in the same PR.
- **Tests (22, database-free):** decision-matrix, blast-radius correctness, determinism (input/candidate/edge-order
  permutations deep-equal), confidence-range fuzz, version-pin, and a **purity/inertness** test (module imports no
  `pg`/postgres/resolver-runtime; only type-only resolver import) + 4 golden regression cases.
- **INERT by construction:** nothing in a live path imports it (verified `grep` → zero importers); no route, no
  worker, no migration, no flag wiring — inertness is guaranteed by absence of callers, stronger than a flag.
- **NEXT (S4b):** persistence tables (WORM, by-value evidence, hash chain) + `CANONICAL_DOMAIN_MODEL` registration
  (deferred here per design — nothing canonical to register until a table exists) + cross-org isolation test.

## Slice 4b — applicability persistence tables (as-built)
- **Three WORM tables** (empty/dark, no writer until 4c): `applicability_assessments` (header — decision +
  confidence + band + `reasoning_steps` JSONB by value + `content_hash`/`prev_hash` chain + version pins),
  `applicability_evidence` (by-value input snapshots), `applicability_affected_entities` (normalized blast
  radius). Migrations `20260722`–`20260726` (header → evidence → affected → WORM → RLS).
- **Immutability (AD-16):** `BEFORE UPDATE/DELETE` + `BEFORE TRUNCATE` trigger (shared fn, fires regardless
  of role → survives the app_request/FORCE flip), mirroring `risk_lifecycle_events_immutable`. Defense-in-depth:
  app_request granted **SELECT,INSERT only** (no UPDATE/DELETE — diverges from the ECL full-DML grant).
- **Hash chain:** pure helper `src/engine/applicability/v1/contentHash.ts` (`serializeCanonical` explicit
  pipe-joined field string — never JSON.stringify; `created_at` excluded for reproducibility; `verifyChain`).
  Fork-proofed by `UNIQUE (organization_id, prev_hash)`; per-org advisory lock is a 4c concern.
- **Two doc reconciliations** (architect-reviewed, recorded in `ENTERPRISE_CONTEXT_ARCHITECTURE.md` §7 S4b note):
  (1) **non-partitioned** (partition deferred to S3.5/pre-4c-write — the doc's "partition at creation" contradicts
  its own S3.5 gate; partitioning is scale not evidentiary; zero repo precedent); (2) **no `is_current` column**
  (WORM forbids the flip — "current" derived from the `(org,signal,target,created_at DESC)` index).
- **Tenant + classification:** inert NULLIF RLS (NOT FORCE) on all three; `dataClassification.ts` + `docs/DATA_CLASSIFICATION.md`
  as **Category D** (org data, no user ref); `CANONICAL_DOMAIN_MODEL.md` registers the 3 objects + decision/confidence_band
  enums (source of truth = `types.ts`).
- **Tests:** `contentHash.test.ts` (determinism, known-vector, 3-link chain + tamper detection — unit) + isolation
  `applicabilityAssessmentsRls.test.ts` (SELECT isolation + WITH-CHECK + fail-closed, all 3 tables) +
  `applicabilityWorm.test.ts` (owner-connection UPDATE/DELETE/TRUNCATE raise on all 3 tables).
- **NEXT (S4c):** the writer/worker that runs `ApplicabilityEngineV1`, persists the result under `withTenant`,
  selects the per-org `prev_hash` predecessor under an advisory lock, and INSERTs the assessment + evidence + affected
  rows in one tenant tx.

## Slice 4c — applicability persistence writer (as-built)
- **`src/api/lib/applicabilityAssessmentWriter.ts`** — `persistApplicabilityAssessment(db, {identity, result, evidence})`.
  Bridges the pure engine (4a) → WORM tables (4b): runs inside a `withTenant(orgId, …)` tx; takes an injectable
  `Queryable` (the `pg` proxy in prod; a raw `app_request` client in the isolation test). Per-org
  `pg_advisory_xact_lock(hashtext(orgId))` serializes chain appends; reads the tail, computes `content_hash` via
  the 4b helper, INSERTs assessment + evidence + affected_entities in one tx. Returns `{assessmentId, contentHash, prevHash}`.
- **Migration `20260727`** adds `seq BIGSERIAL` to `applicability_assessments` — the tail lookup orders by `seq DESC`,
  not `created_at` (which returns the tx-start time and ties for multiple decisions persisted in ONE tenant tx →
  would fork the chain). Additive ADD COLUMN on the empty table (WORM trigger blocks DML, not DDL).
- **Tests:** `applicabilityAssessmentWriter.test.ts` (mock-Queryable unit — advisory-lock ordering, GENESIS, hash
  match, evidence/affected loops) + isolation `applicabilityWriter.test.ts` (real Postgres: 3 decisions chained in
  ONE tx via `seq`, `verifyChain` end-to-end, cross-org WITH-CHECK reject).
- **INERT:** no caller yet — the live enqueue-on-signal + fan-out worker (4d) is S7/Item 6. Behind the ECL flag at
  the eventual call site.

## Slice 5 — Explainability (as-built)
- **`src/engine/applicability/v1/explainability.ts`** — pure `explainAssessment(stored)` + `renderExplanationText(x)`.
  Reads ONLY stored decision data (header + evidence + affected children from the 4b tables); no DB, no engine
  re-run, no LLM (the DONE bar: "reasoning chain renders from stored data").
- Produces: business **headline** ("why this matters", tied to blast-radius reach), decision statement, ordered
  **reasoning chain** (rendered from `reasoning_steps`), **evidence_used** grouped by auditor category (match /
  graph_reachability) + honest **evidence_missing** gaps, **blast_radius** grouped by node_type w/ shallowest depth,
  and a **reproducibility** block that RE-DERIVES `content_hash` from the stored inputs (reuses the 4b helper) —
  `reproduces:false` flags tampering (auditor-defensible, AD-16 #4).
- **Tests (12, database-free):** headline/decision/reasoning render, blast-radius grouping, evidence used+missing,
  reproducibility TRUE untampered + FALSE on tampered hash + FALSE on altered reasoning step, determinism, text render.
- **INERT:** pure module, no callers (the UI/export that consumes it is Item 7). An optional LLM *narration* on top
  (AD-7) is a later add — the structured explanation is the source and is complete on its own.

## Slice 6 — Workflow automation core (as-built)
- **`src/engine/applicability/v1/workflowRecommendations.ts`** — pure `deriveWorkflowRecommendations(stored, policy?)`:
  maps a persisted decision → a deterministic set of workflow RECOMMENDATIONS (finding_draft, risk_review_recommendation,
  evidence_request, human_review_task, notification), each with a stable `idempotency_key = sha256(content_hash|type|target)`.
- **AD-9 respected:** emits `risk_review_recommendation` only — NEVER `risk_open`/`risk_transition` (risk creation/transition
  stays human/lifecycle-gated). AD-8a: recommendations are the human-review projection of the assessment (carry its content_hash).
- **Decision mapping:** affected → finding_draft + risk_review + evidence_request + owner notification(s) (one per blast-radius
  identity, else target-scoped fallback); potentially_affected → human_review_task + informational notification; needs_review →
  human_review_task; not_affected/unknown → nothing. Priority follows the confidence band. Versioned `DEFAULT_WORKFLOW_POLICY`.
- **Tests (12, database-free):** decision mapping, AD-9 no-auto-risk guard, owner-notification + fallback, priority-by-band,
  policy gating, and the **idempotency** property (re-derive → identical keys; new content_hash → different keys; unique per type/target).
- **INERT:** pure core, no callers. The live dispatcher (write suggestion via `signal_match_suggestions` + `assessment_id`,
  enqueue action via the GAP-3 `actions` pattern, notify via `createAlertBatcher` — notifications OUTSIDE the tx, audit atomic)
  is a later flag-gated adapter slice, mirroring 4a-core→4c-writer.

## Slice 7 — Signal linkage core (as-built)
- **`src/engine/applicability/v1/reassessment.ts`** — two pure fns:
  - `planReassessment(event, linked)` — a `ChangeEvent` (signal_changed / edge_changed / entity_changed) selects exactly
    the existing assessments to re-evaluate (AD-14: scope to target OR blast-radius touched; edge/entity events org-scoped;
    deduped + deterministically ordered). **DONE bar: a changed signal re-evaluates its linked entities.**
  - `detectDrift(prior, current)` — compares a prior stored decision (or null) to a fresh one → `{drifted, kind, severity,
    changes, added/removed_entities}`. Decision change crossing `affected` = high; band/blast-radius change = medium.
- **Tests (14, database-free):** signal/edge/entity triggers, org-scoping, dedup/order; drift for new/decision/band/radius,
  severity tiers, determinism.
- **INERT:** pure core, no callers. The live reassessment worker (for each plan item → re-run 4a engine → persist 4c →
  detectDrift vs prior → if drifted, derive S6 recommendations) is a later flag-gated adapter. This also delivers the
  deferred "4d" reassessment path noted under Item 3.

## Remaining governance-hygiene (Item 11)
- `BUILD_SEQUENCE.md` Active-package line still reads "Priority 4 ACTIVE"; ECL S1/S2/S3 are the active
  workstream. Update the active-workstream record as an Item 11 doc-sync.
