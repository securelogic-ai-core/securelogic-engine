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

Last updated: 2026-07-05 (**AUDIT CORRECTION** — the previous "ALL 1–11 DONE" header was
over-optimistic; re-verified against the original goal's per-item DONE-criteria after the
`goal.md` text was recovered). **DONE: 1, 2, 3, 4, 5 (R2 dispatcher, 2026-07-05),
6 (R3 worker, 2026-07-05), 9, 10, 11. PARTIAL: 7, 8.** Nothing
is BLOCKED-ON-SIMMEE (GATE A ruled; GATE B is a standing prohibition, not a blocker).

**Why the correction (verified by importer trace across `origin/develop`):** the entire ECL
decision/automation engine chain is a set of **pure modules with zero live callers** — the
applicability engine is imported only by its own 4c writer, and *the writer, `workflowRecommendations`,
and `reassessment` have no route/worker importer at all*. So:
- **Item 5 (S6 workflow automation)** — the goal requires reuse of the action engine + risk
  lifecycle + notification conventions ("notifications outside tx; audit atomic"). Only the
  *pure recommendation-derivation core* is merged; **no dispatcher writes a finding, enqueues
  an action, or sends a notification.** → PARTIAL.
- **Item 6 (S7 signal linkage)** — DONE-bar is *"a changed signal re-evaluates linked entities
  in tests."* The pure `planReassessment` only *selects* which assessments to re-run; **nothing
  re-runs the engine**, and there is no worker/enqueue trigger. → PARTIAL.
- **Item 7 (UI/CX)** — the goal names *applicability view, evidence view, exec dashboard* as
  deliverables. Built: management screens, entity detail, graph view, import, nav (all dark).
  **Missing: applicability view, evidence view, exec dashboard.** → PARTIAL.
- **Item 8 (connectors)** — the goal requires *adapters + config schemas + mock-backed tests*
  for all listed connectors. Only **ServiceNow (1 of 8)** has a real adapter + mock test; the
  other 7 throw `connector_not_implemented`. → PARTIAL.
- The prior Item-3 row claimed *"4d live enqueue delivered under S7/Item 6"* — **false**; that
  worker does not exist. Item 3's *own* DONE-bar ("reproducible outputs, test-locked") IS met
  by the pure fn, so Item 3 stays DONE, but the live-write path it implies is Item 6's PARTIAL work.

Everything remains DARK (`SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED = false`, engine + app),
`main` untouched, GATE B intact. **Remaining ENGINEERING work (not operator/ledger):**
applicability/evidence read routes (R4) + views (R5), exec-dashboard stats endpoint + UI
(R6), 7 connector adapters (R7). ~~S6 dispatcher (R2)~~ / ~~S7 worker + enqueue (R3)~~ —
delivered (Items 5 + 6 DONE). Operator-only items stay in the ledger
(L-2/L-4/L-5.x/L-6/L-8/L-9).

---

## Item status

| # | Item | Status | PRs / SHAs | Flags | Ledger refs |
|---|---|---|---|---|---|
| 1 | Pre-merge audit of #464/#465; fix Critical/High; merge | **DONE** | #464 (merge `1f308e61`), #465 (merge `7843cf62`); branches deleted | `SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED` (off) | L-1, L-2 |
| 2 | Slice 3 — CSV/spreadsheet import (assets, vendors, apps, AI systems, data stores) | **DONE** | #467 (squash `17627ac7`) + prereq dep-fix #468 (squash `205c39ef`); branches deleted | `SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED` (declared in render.yaml, off) | L-3 |
| 3 | Slice 4 — Applicability Engine (deterministic decision fn) | **DONE** — 4a pure fn (`2a9e4b96`) + 4b WORM persistence (`e4b63b5e`) + 4c writer (#471 `cb15c788`). DONE-bar ("reproducible outputs, test-locked") met by the pure fn + golden suite. NOTE: the 4c writer has **no live caller** — the enqueue/re-run path that invokes it is Item 6's worker (R3), still PARTIAL. (Corrected: the prior "4d delivered under Item 6" claim was false.) | #469 (4a); #470 (4b); #471 (4c, squash `cb15c788`) | `SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED` (declared, off) | — |
| 4 | Slice 5 — Explainability surface | **DONE** — pure render layer over stored decision | #472 (squash `cb1c2be2`); branch deleted | none (pure, inert — no callers) | — |
| 5 | Slice 6 — Workflow automation (findings/risk/tasks/notifications) | **DONE** — pure core (`b82bd4cb`) + **R2 live dispatcher** (`applicabilityWorkflowDispatcher.ts` + migration `20260730`): writes the pending suggestion (with `assessment_id`, AD-8a), drafts the finding + enqueues actions via the GAP-3 ON-CONFLICT pattern (AD-9: risk REVIEW action only, never a risk write), returns AlertItems for `createAlertBatcher` OUTSIDE the tx; idempotent on the recommendation key via (org, assessment, marker) partial unique indexes; 11 unit + 4 real-PG idempotency/RLS tests. Live invocation = Item 6's R3 worker. | core #473 (squash `b82bd4cb`); dispatcher R2 PR (see git log) | `SECURELOGIC_APPLICABILITY_WORKFLOW_ENABLED` (declared `"false"`, 4 engine blocks) AND ECL flag, both at the call site | L-9 |
| 6 | Slice 7 — Signal→platform linkage (dependency, reassessment, drift) | **DONE** — pure core (`33f4a929`) + **R3 live worker** (`applicabilityReassessmentWorker.ts` + enqueuer + migration `20260731` jobs type): ChangeEvents enqueued at all three change points (processSignal same-tx; ECL entity PATCH/DELETE; edge POST/DELETE, one event per endpoint); worker claims (FOR UPDATE SKIP LOCKED, elevated), plans via `planReassessment` (+ FIRST-TIME items from matcher suggestions — the 4c writer's first live caller, closing Item 3's live-path note), re-runs `ApplicabilityEngineV1` with a fresh resolver neighborhood, persists (4c, hash-chained), `detectDrift`, dispatches via R2 when drifted; job success atomic with the work; alerts flushed post-commit. **DONE bar met in tests: a changed signal re-evaluates its linked entities** (real-PG end-to-end: first assessment born → edge removed → decision downgrades, chained, review task dispatched). In-process minute cron, flag-gated idle-skip. | core #474 (squash `33f4a929`); worker R3 PR | ECL flag gates claim; `SECURELOGIC_APPLICABILITY_WORKFLOW_ENABLED` additionally gates dispatch | — |
| 7 | UI/CX — screens, entity detail, graph view, applicability view, evidence view, exec dashboard | **PARTIAL** — DONE: management screens, entity detail, graph view, CSV import, fail-closed nav (7A.0–7A.4). **Missing (named deliverables): applicability view, evidence view, exec dashboard.** Remaining: R4 (read routes) → R5 (applicability + evidence views) → R6 (exec dashboard + stats endpoint). | 7A.0 #480 `4b566bad`; 7A.1 #481 `228f8f11`; 7A.2 #484 `d3ccad1e`; 7A.3 #485 `cca10015`; 7A.4 #486 `15ffac4d` | `SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED` off on both switches (engine 404 + app nav hidden) | L-4 (partial), L-8 |
| 8 | Connectors (ServiceNow/Defender/CrowdStrike/Wiz/Tenable/Qualys/Rapid7/cloud/identity) — dark, mock-tested | **PARTIAL** — framework + registry (all 9 registered) + **ServiceNow reference adapter (1 of 8) DONE** with mock tests (`d0351c1c`). The other 7 throw `connector_not_implemented` (config schema only). Remaining (R7): real `normalize()`/`fetch()` + mock-backed tests for Defender, CrowdStrike, Wiz, Tenable, Qualys, Rapid7, cloud inventory, identity provider. | framework + ServiceNow #475 (squash `d0351c1c`) | per-connector flags at call site | L-5.1 done-adapter; L-5.2..L-5.9 credentials (adapters are engineering, not ledger) |
| 9 | Enterprise gating (GATE A ruled 2026-07-04) | **DONE** — capability gate + edge cap + entity default | GATE-A memo #476 (`572961b8`); gating #477 (squash `c495dc0c`); branches deleted | `SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED` + `enterprise_context` capability | L-1 (RESOLVED), L-7 |
| 10 | Scale validation (recursive load, EXPLAIN, partitioning) | **DONE** — harness + EXPLAIN numbers + written findings/decisions | #478 (squash `d3ad01ed`); branch deleted | — | L-6 (staging load env) |
| 11 | Governance docs → as-built (CANONICAL, arch, runbooks, rollback) | **DONE** — #479 (squash `b4765f79`) | `BUILD_SEQUENCE.md` active-workstream note; `CANONICAL_DOMAIN_MODEL.md` build-status rows (4c/5/6/7 + capability/caps + connectors); `ENTERPRISE_CONTEXT_ARCHITECTURE.md` as-built banner; new `docs/runbooks/enterprise-context-enable-rollback.md` | — | — |

### Decision gates
- **GATE A** — **RULED 2026-07-04 (operator).** (1) Access = **Platform Professional + Enterprise** (ECL is core, not Enterprise-only). (2) Grant = **capability-based** (`requireCapability("enterprise_context")`, not hard-coded tier checks); Platform plans get it by default; per-org controllable. (3) Caps = conservative **10k entities / 50k edges**, separate from `max_monitored_entities`, `enforceEntityLimit` untouched; Enterprise higher configurable later. Implemented in Item 9 (this PR). Memo: `enterprise-context-gate-a-memo.md`.
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

### R2 — live dispatcher (as-built, 2026-07-05)
- **`src/api/lib/applicabilityWorkflowDispatcher.ts`** — `dispatchApplicabilityWorkflow(db, {assessmentId, stored, policy?})`,
  called INSIDE `withTenant(orgId, …)` (injectable Queryable, the 4c-writer shape). Applies the pure S6 recommendations:
  finding_draft → `findings` (source_type `applicability_assessment`); risk_review/evidence_request/human_review →
  `actions` (markers `auto_applicability_risk_review` / `auto_applicability_evidence_request` / `auto_applicability_human_review`,
  GAP-3 ON-CONFLICT pattern — AD-9: a risk REVIEW action only, never a risks/lifecycle write); notification recs →
  returned `AlertItem[]` the caller add()s to `createAlertBatcher` and flush()es AFTER commit (outside-tx convention;
  N identity notifications coalesce to ONE finding-anchored item; only High severity alerts — the engine never asserts Critical).
  Also writes/refreshes the AD-8a human-review projection: ONE pending `signal_match_suggestions` row per (org, signal, target)
  carrying `assessment_id` (`DO UPDATE` re-points the pending row at the newest decision; terminal rows spawn a fresh pending row).
- **Migration `20260730_applicability_workflow_dispatch.sql`** — `signal_match_suggestions.assessment_id` (nullable FK → WORM
  header; no ON DELETE action needed, assessments are undeletable) + reverse-lookup partial index; findings/actions
  `source_type` CHECKs += `applicability_assessment`; partial unique dedup indexes: one generated finding per (org, assessment),
  one action per (org, assessment, marker). These indexes ARE the durable at-most-once ledger for the recommendation key
  (content_hash ↔ assessment row is 1:1); notification at-most-once = the alert-send ledger (per user+finding), matcher-identical.
- **Atomicity:** suggestion + finding + actions in ONE tenant tx (riskLifecycle convention: domain record in-tx,
  `writeAuditEvent` mirror fired by the caller AFTER commit — the Item-1 F1 lesson).
- **Flags:** call sites must check `enterpriseContextEnabled()` AND new `applicabilityWorkflowEnabled()`
  (`SECURELOGIC_APPLICABILITY_WORKFLOW_ENABLED === "true"`, declared `"false"` in the 4 engine render.yaml blocks). Prod flip = L-9.
- **Tests:** 11 unit (flag, mapping, decision coverage, AD-9 guard, identity-coalescing, conflict/skip paths) +
  4 isolation on real Postgres (committed tenant-tx dispatch; re-dispatch no-op with counts proven unchanged; reassessment
  re-points suggestion + generates new work; cross-org dispatch rejected by RLS WITH CHECK with zero leakage).
- **Docs:** CANONICAL source-type lists (+ stale `cyber_signal`/`obligation` entries reconciled), `dataClassification.ts`
  suggestion entry notes `assessment_id`. **No live caller yet — R3's worker is the live path; module stays inert.**

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

### R3 — live reassessment worker + enqueue (as-built, 2026-07-05)
- **Enqueue** `src/api/lib/applicabilityReassessment.ts` — `enqueueApplicabilityReassessment(db, orgId, event)`:
  self-gating (zero DB while the ECL flag is off), NOT-EXISTS-deduped against identical QUEUED jobs (processing jobs
  deliberately not dedup targets — mid-flight reads may predate the change), enqueued ON THE CALLER'S channel so the
  job commits/rolls back WITH the triggering mutation. Wired at: `processSignal` (same elevated tx, per org),
  ECL entity PATCH/DELETE (`entity_changed`), edge POST/DELETE (`edge_changed` × both endpoints). Entity CREATE does
  not enqueue (a new node cannot be in any existing target/blast radius). Migration `20260731` adds the
  `applicability_reassess` jobs type (CHECK extension, 20260622 shape).
- **Worker** `src/api/workers/applicabilityReassessmentWorker.ts` — claim = FOR UPDATE SKIP LOCKED on pgElevated
  (data-rights/vendor-extraction pattern, incl. lock-timeout reclaim + backoff/dead-letter via `decideFailureState`);
  everything after the claim in ONE `withTenant(job.org)` tx: load current assessments (DISTINCT ON … seq DESC) +
  blast radii → `planReassessment` (+ FIRST-TIME items = matcher suggestions with no assessment yet, signal events
  only — this is how an assessment is BORN; the 4c writer's first live caller) → per item: candidate from latest
  suggestion, fresh `resolveNeighborhood` (AD-13; vendor/ai_system only, DEFAULT_DEPTH) → `ApplicabilityEngineV1.assess`
  → `persistApplicabilityAssessment` (evidence: match_candidate + graph_neighborhood summary + reassessment_trigger)
  → `detectDrift(prior, current)` → if drifted AND `applicabilityWorkflowEnabled()`: R2 dispatch (same tx) → job
  `succeeded` UPDATE in the same tx (work + completion atomic). Post-commit: `createAlertBatcher` flush (outside tx)
  + `writeAuditEvent` mirror. `MAX_ITEMS_PER_JOB` 200 with a LOUD truncation log (no silent caps).
- **Scheduling:** in-process node-cron every minute with an overlap guard (`startApplicabilityReassessmentWorker()` in
  server.ts, the accountDeletionEnqueuer precedent) — no new Render service; the durable queue reclaims on redeploy.
  Tick refuses to claim while the ECL flag is off (idle-skip).
- **Tests:** 5 unit (enqueuer flag gate/dedup/SQL, payload parser round-trip + rejects) + 3 isolation end-to-end on
  real Postgres proving the DONE bar: signal_changed births the first assessment ('affected', blast radius = the
  seeded entity, suggestion re-pointed, finding + 2 actions, job succeeded, dup-enqueue suppressed); edge removal +
  edge_changed reassesses (second WORM record chained via prev_hash, downgraded to potentially_affected, human-review
  task dispatched); org B gains zero rows.

## Slice 8 — Connectors (as-built)
- **Framework** `src/api/lib/connectors/` — `ConnectorAdapter` interface (pure `normalize()` + I/O `fetch(config, http)`
  with an injectable `HttpClient`), shared config-schema validation (`validateAgainstFields`), `plannedAdapter()` factory.
  Normalized output = the ECL import shape (`NormalizedEntity` mirrors Slice 3 import rows + `NormalizedRelationship`),
  so connectors reuse the import path (`planImport`) rather than a parallel write path.
- **Reference adapter** `serviceNowCmdb.ts` — full fetch (CMDB CI table, Basic auth) + pure normalize (sys_class→entity_type,
  business_criticality→ECL vocabulary, `depends_on`→relationships, dedup, deterministic order). Gotcha fixed: strip the
  `cmdb_ci_` prefix before substring-matching (the "db" in "cmdb" spuriously matched data_store).
- **Registry** `registry.ts` — all 9 roadmap connectors registered; ServiceNow = `reference`, the other 8 (`microsoft_defender`,
  `crowdstrike_falcon`, `wiz`, `tenable`, `qualys`, `rapid7`, `cloud_inventory`, `identity_provider`) = `planned` (config schema
  present; normalize/fetch throw `connector_not_implemented` until their adapter lands).
- **Tests (11):** ServiceNow normalize mapping + dependency edges + dedup + malformed tolerance, fetch via fake HttpClient
  (URL + Basic auth), config validation (missing field / non-https), registry completeness, planned-adapter guards.
- **Credentials → operator ledger L-5.1..L-5.9** (one per connector). **INERT:** no route/worker calls any connector; behind
  the ECL flag + per-connector flag at the eventual call site.

## Item 9 — Enterprise gating (as-built, GATE A ruled)
- **Capability gate (AD-17)** `src/api/lib/enterpriseContextCapability.ts` — pure `resolveEnterpriseContextCapability(entitlement, override)`
  + `requireCapability("enterprise_context")` middleware. Per-org override column `organizations.enterprise_context_capability`
  (migration `20260729`): TRUE/FALSE = explicit grant/deny; NULL = inherit default (Platform Professional + Enterprise granted;
  Brief tiers/starter denied). **Replaces `requireEntitlement("premium")`** on all 4 ECL route chains (entities, relationships,
  graph, import) — capability-based, not hard-coded tier checks, per the ruling.
- **Caps (migration `20260728`)** — entity default raised 1000→**10,000** (existing old-default rows migrated forward);
  NEW `organizations.max_enterprise_edges` default **50,000** (closes H1) + `enforceEnterpriseEdgeLimit` (`enterpriseEdgeLimit.ts`)
  wired into the relationship-create handler → 409 `enterprise_edge_limit_reached`. Both SEPARATE from `max_monitored_entities`;
  `enforceEntityLimit` untouched.
- **Tests:** unit `enterpriseContextCapability.test.ts` (resolver truth table + middleware grant/deny/403/401/err, pg mocked) +
  `enterpriseEdgeLimit.test.ts` (threshold + default fallback, pg mocked) + isolation `enterpriseContextGating.test.ts`
  (real columns/defaults, edge-count semantics, capability round-trip → resolver). 75 existing ECL unit tests still green.
- **Still DARK:** `SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED` off (feature flag is still the first 404 gate; capability runs after).
  Production enablement is GATE B (out of scope). Operator actions: grant/revoke capability per org + tune caps → ledger L-7.

## Item 10 — Scale validation (as-built)
- **Harness** `test/isolation/enterpriseGraphScale.test.ts` — seeds a graph (400-wide fan-out hub → ~800 nodes, 150-node deep
  chain, 3-node cycle), runs `EXPLAIN (ANALYZE, BUFFERS)` on the resolver's exact nodes query at depths 1–5, asserts bounded +
  depth-capped + cycle-safe, emits timings.
- **Numbers (local/CI scale):** fan-out hub depth 1→5 = 5.0 / 126.6 / 129.2 / 145.4 / 184.4 ms (node count plateaus at 801 by
  depth 2 — latency keeps rising ⇒ cost = path enumeration + O(path-len) visited-array guard, NOT node count). Deep chain depth 5
  = 6 nodes / 1.5 ms. Cycle terminates.
- **Findings + decisions** in `enterprise-context-scale-findings.md`: H2 stays a real gate (super-linear at enterprise fan-out);
  **materialized-adjacency fallback** decided (build before enabling any large-fan-out org; trigger ≈ p95 > 250 ms or > 10⁴ edges);
  **partitioning** decided (defer; hash-by-org on `enterprise_relationships` past ~10⁵ edges/org; WORM tables by created_at range);
  the 50k edge cap alone does NOT bound latency → per-org p95 monitor gates cap increases. True 10⁴–10⁵ run = operator **L-6**.

## Item 11 — governance docs → as-built (DONE, this PR)
Reconciled the governing docs to shipped reality (Slices 1–10 dark on `develop`):
- **`BUILD_SEQUENCE.md`** — added a dated *Active-workstream update* note recording that the
  ECL (authorized as the *Priority-5 foundation*, #458/#459) is the live workstream with
  S1–S10 shipped dark; Items 7 (UI/CX) + 11 remaining. Placed away from the Priority-4 record
  region (that B/C/D reconciliation is the separate open PR #461) to avoid conflict, and noted
  the two distinct "Priority 5" numberings (ECL foundation vs BUILD_SEQUENCE's signal-linkage).
- **`CANONICAL_DOMAIN_MODEL.md`** — build-status table advanced past S4b: Applicability row now
  records the 4c writer (`cb15c788`) + S5 explainability (`cb1c2be2`) + S6 workflow-rec
  (`b82bd4cb`) + S7 signal-linkage (`33f4a929`) cores; added **Enterprise Capability & Caps**
  row (GATE-A caps + capability column, migr `20260728`/`20260729`) and **Connector Framework**
  row (registry + ServiceNow reference adapter, `d0351c1c`). (ECL enums were already present.)
- **`ENTERPRISE_CONTEXT_ARCHITECTURE.md`** — replaced the stale "nothing built until Priority 4
  completes / DRAFT — FOR REVIEW" banner with a **DESIGN BLUEPRINT — PARTIALLY AS-BUILT** status
  that flags the two deliberate as-built variations (WORM store non-partitioned + no `is_current`;
  resolver typed-edge-UNION without the materialized-adjacency fallback) and points to the
  authoritative records. Design body left intact.
- **`docs/runbooks/enterprise-context-enable-rollback.md`** — NEW operator runbook: the two-switch
  gate model, the §2 pre-enable gate table (incl. H2/L-6 caveat + materialized-adjacency trigger),
  the enable procedure (capability grant / cap tuning / flag flip = L-2/L-7), and the
  flag-off-inert rollback (WORM tables must not be TRUNCATEd as rollback).

Prod enablement stays **GATE B** (out of scope). No code/schema changed in Item 11 — docs only.

## Item 7 — UI/CX (PARTIAL)

Sequenced last by design (needs the L-4 app CI story). Sliced so every PR is dark and
independently mergeable; the flag keeps every ECL engine route 404ing, and the nav entry
(7A.4) is fail-closed behind the app-side env flag. **Tier-1 (7A.0–7A.4) is DONE**;
the goal additionally names an **applicability view, evidence view, and exec dashboard**
which are NOT yet built — see the "remaining" note below.

- **7A.0 — app typecheck CI lane (DONE, #480 squash `4b566bad`).** `app/` `tsc --noEmit`
  folded into the required PR-CI `typecheck` job (the app has no local test runner and the
  sandbox SIGTERMs on `next build` — L-4). Partially resolves L-4: types are CI-gated;
  there is still no CI `next build` lane (pre-existing gap, unchanged).
- **7A.1 — Tier-1 api client + mutation proxies (DONE, #481 squash `228f8f11`).** Data
  plumbing only, no screens/nav: pure `app/src/lib/enterpriseContext.ts` (vocabularies,
  bounds — graph depth hard-capped at 5, row shapes, query builders, 404→disabled /
  403→capability inference, error-code→copy map); gate-aware readers + client mutations in
  `app/src/lib/api.ts`; five Next proxy routes under `app/src/app/api/enterprise-context/**`
  (session token → Bearer, engine status passed through), mirroring the risk-lifecycle
  proxy precedent. 20 database-free unit tests. Consumes only existing engine APIs.
- **7A.2 — entity screens (DONE, #484 squash `d3ccad1e`).** `/enterprise-context` list
  (all-8-types filter chips, offset pagination — no engine totals, so "Next" only on a full
  page), detail (full field set + data-store attrs), shared create/edit form
  (contract-faithful PATCH: full form state, cleared enums as explicit `null`, `data_store`
  block always whole — replace semantics), confirm-delete. Gate-aware failure panel
  (404→disabled / 403→capability affordance / else shared copy). New pure
  `enterpriseContextFormat.ts` (labels, pageNav, readFailure) + 18 unit tests. Also
  regenerated the application knowledge index (its staleness guard fails CI on any new app
  route — recurring gotcha).
- **7A.3 — relationships + graph view (DONE, #485 squash `cca10015`).** Detail-page
  relationship management (direction toggle, engine vocab, page-capped pickers + paste-an-ID
  fallback, per-row confirm-remove) and `/enterprise-context/graph` — server-rendered SVG
  neighborhood (depth 1–5, per-type legend, deep links). Pure deterministic layered layout
  `enterpriseGraphLayout.ts` (+8 tests): columns per BFS depth, 40-node column cap,
  omitted nodes/edges counted and surfaced, never silently dropped. Names batch-resolved
  from page-capped lists with honest short-id fallback (resolver returns ids only).
- **7A.4 — import UI + nav (DONE, #486 squash `15ffac4d`).** Two-step import flow
  (preview plan → commit `ok` rows) over the Slice-3 route: summary chips, problems-first
  row table with validator details, truncation notice, per-type expected-columns hint.
  Fail-closed nav: `filterNav` gains `featureFlag` support (flagged items hidden unless the
  flag is passed `true`); "Context" link flagged `enterprise_context`; server layout resolves
  the env and threads it to the client Header; flag declared `"false"` on `securelogic-app`
  in render.yaml (runtime, restart-applied). +5 nav tests incl. dark-by-default on the real
  NAV_ITEMS.

**Remaining for Item 7 (the three named views, NOT yet built):**
- **Applicability view + evidence view (R5)** — read the persisted decision + reasoning chain
  (reuse `explainability.ts`) + evidence used/missing + reproducibility. Needs the engine read
  routes first (**R4** — no GET endpoint exposes an applicability assessment today; the 4b
  tables have no reader).
- **Exec dashboard (R6)** — needs a first-class engine ECL stats/rollup endpoint (counts by
  type/criticality/decision/blast-radius); a dashboard built over the page-capped list API
  today would be the ad-hoc aggregation the governing docs prohibit, so the endpoint is a
  prerequisite, not optional.

**Interruption record (2026-07-05 resume):** the prior session pushed 7A.1 / opened PR #481
(merged on resume), then built + merged 7A.2–7A.4. A subsequent independent audit (against the
recovered `goal.md`) found Item 7's named applicability/evidence/exec-dashboard views were not
built — this section and the item table were corrected accordingly.
