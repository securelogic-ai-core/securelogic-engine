# P10 Design Memo — Generic Asset-Assessment Service (Track B)

**Status:** Ratified for implementation (P10 first deliverable per P6-P11-ROADMAP.md).
**Scope authority:** This memo refines the P10 exit criterion, as the roadmap requires.
**Decision IDs:** EAR-AD-5 (AssessmentTypeSpec registry), EAR-AD-6 (generic table, no per-type tables), EAR-AD-7 (staged collapse — data first, transactions later).

---

## 1. Problem

ARCHITECTURE.md §1.6: no shared assessment engine. Seven bespoke workflow stacks
(5 "assessment" + 2 structurally identical "review" siblings), each a ~535–721-line
near-clone route plus its own ~140–310-line validation module (~1,750 lines of
near-duplicate validation total), plus a copy-pasted finding-on-first-transition
transaction in five PATCH handlers. Onboarding assessments for any NEW asset type
(application, database, cloud_resource, endpoint, api, identity_system…) today means
an eighth clone: new table, new route, new validation module, new
`findings.source_type` CHECK expansion.

### 1.1 Stack inventory (verified)

| Stack | Table | Subject FK | Lifecycle pattern | Finding `source_type` | Gate today |
|---|---|---|---|---|---|
| controlAssessments | `control_assessments` (20260416) | `control_id` | mutable status-machine, finding on first transition into a finding status | `control_test` | dual-gate (P9) |
| obligationAssessments | `obligation_assessments` (20260419) | `obligation_id` | mutable status-machine | `obligation_review` | dual-gate (P9) |
| aiGovernanceAssessments | `ai_governance_assessments` (20260429) | `ai_system_id` | mutable status-machine | `ai_governance_review` | dual-gate (P9) |
| dependencyAssessments | `dependency_assessments` (20260425) | `dependency_id` | mutable status-machine | `dependency_review` | `requireEntitlement("premium")` |
| vendorReviews | `vendor_reviews` (20260428) | `vendor_id` | mutable status-machine | `vendor_cycle_review` | dual-gate (P9) |
| vendorAssessments | `vendor_assessments` (20260413) | `vendor_id` | **immutable at POST** (status CHECK = `completed` only, no PATCH), finding always at POST | `vendor_review` | `requireEntitlement("premium")` |
| governanceReviews | `governance_reviews` (20260414) | `ai_system_id` | **immutable at POST** (`review_type` + `outcome`, no status), finding always at POST | `ai_review` | dual-gate (P9) |

All seven: org-scoped, `overall_severity` CHECK (Critical/High/Moderate/Low),
`summary`/`notes`/`performed_at`/`reviewer_id`, mutable rows (no WORM), evidence
linked out-of-band via the shared `evidence` table, audit via `writeAuditEvent`,
severity→priority via `postureComputation.severityToPriority`.

**The names lie:** `vendor_assessments` ("assessment") is the immutable point-in-time
record while `vendor_reviews` ("review") is the mutable workflow — but
`ai_governance_assessments` ("assessment") is the mutable workflow while
`governance_reviews` ("review") is the immutable record. Any spec must therefore
carry lifecycle pattern as a **spec field** (`immutableAtPost`), never infer it
from naming.

**Real variance across the 5 status-machine stacks** is exactly four literals:
`(subject table, status vocabulary + transition map, finding source_type, gate)`.
This maps cleanly onto an `ASSET_TYPE_SPECS`-style capability row (assetRegistry.ts
L95-167 — the Phase-2 pattern this memo applies to assessments).

### 1.2 What already exists that is NOT this engine

- Legacy `assessments` + `reports` (001 / 20260410, written by `POST /api/assess`):
  the original questionnaire-driven framework scorer (`report_json`, encrypted).
  Generic in name only; orthogonal to the workflow stacks; untouched by P10.
- ECL `applicability_assessments` (20260722–20260727): WORM, hash-chained,
  by-value decision ledger. Not a GRC workflow; its WORM+hash-chain pattern is
  the citation for future auditor-grade assessment evidence (§6), not a base
  table for P10.

---

## 2. Decision — EAR-AD-5/6/7

**P10 ships a spec-driven assessment engine consumed by ONE new generic path
(`asset_assessments`, keyed on AssetRef), establishes the spec registry as the
single source of truth for ALL assessment lifecycles (legacy modules delegate
their status-machine data to it), and documents — but does not execute — the
route-transaction collapse of the seven legacy stacks.**

### EAR-AD-5 — `AssessmentTypeSpec` registry (`src/api/lib/assessmentSpec.ts`)

One code-level capability table, exactly the `ASSET_TYPE_SPECS` shape:

```ts
interface AssessmentTypeSpec {
  key: string;                       // "control" | "obligation" | … | "asset"
  subjectKind: string;               // backing table of the subject
  statuses: readonly string[];       // full vocabulary
  terminalStatuses: ReadonlySet<string>;
  findingStatuses: ReadonlySet<string>;   // trigger finding on FIRST transition in
  transitions: Readonly<Record<string, readonly string[]>>;
  findingSourceType: string;         // findings.source_type value
  immutableAtPost: boolean;          // vendor_assessments / governance_reviews pattern
}
```

Eight rows: the seven legacy stacks + `asset` (the new generic path). The seven
legacy validation modules KEEP their exports (routes and tests untouched) but the
status-machine data (`VALID_STATUSES`, `TERMINAL_STATUSES`, `FINDING_STATUSES`,
`VALID_TRANSITIONS`, `isValidTransition`) now **delegates to the spec row** —
pure-data delegation, behavior-identical, verified by the existing suites plus a
new lockstep test. Bespoke create-validators stay bespoke (field names and
requiredness genuinely differ; collapsing them buys nothing and risks drift).

### EAR-AD-6 — one generic `asset_assessments` table; zero per-type tables

New table `asset_assessments` (20260810), subject = **any registry asset** via
`(asset_type, asset_id)` AssetRef (EAR-AD-3):

- Org-scoped; RLS in the standard shape (tenant channel; matches 20260704 pattern).
- No FK on `asset_id` — subjects span federated backing tables via
  `asset_registry_v` (a view cannot be an FK target); referential integrity is the
  org-scoped registry lookup at POST (precedent: the polymorphic
  `signal_match_suggestions` quartet).
- Canonical generic vocabulary: `not_started / in_progress / satisfactory /
  deficient / remediation_required`; finding statuses = `deficient,
  remediation_required`; transitions mirror the 5-stack status-machine shape.
- Emits `findings` with new additive `source_type = 'asset_assessment'`
  (CHECK expansion, precedent 20260730) and joins the shared `evidence` table
  (`source_type = 'asset_assessment'`, CHECK expansion precedent 20260716).
- **Exit criterion satisfied:** every one of the 10 registry asset types —
  including all future types — gains an assessment path with **zero new tables,
  zero new routes, zero new validation modules** (a spec row is config, and the
  generic path doesn't even need a new row per asset type).

### EAR-AD-7 — staged collapse; route transactions NOT rewritten in P10

The engine module (`src/api/lib/assessmentEngine.ts`) owns the spec-driven
transition validator and the finding-on-first-transition transaction, used by the
NEW generic route. The seven legacy routes keep their inline SQL **unchanged** in
P10. Rationale: rewriting five ~700-line PATCH transactions is a
behavior-identical-by-assertion refactor with zero product value delta and real
regression surface; the roadmap exit explicitly demands "existing assessment
behavior unchanged." Collapse path per stack (documented for the follow-up epic,
executable one stack per PR):

1. validation module delegates status-machine data to spec — **done in P10**;
2. route PATCH delegates its transaction to `assessmentEngine.applyTransition`
   (same SQL, spec-parameterized) — one stack per PR, each behind the existing
   test suite;
3. optionally, table adapters federate legacy rows into a unified read surface
   (a UNION view, the `asset_registry_v` pattern) — only if an output needs it.

The two immutable-at-POST stacks collapse via the same engine's `createImmutable`
path when step 2 reaches them.

---

## 3. Surface (all dark)

Routes (`src/api/routes/assetAssessments.ts`), mounted under the SAME flag and
gate stack as the registry surface:
`assetRegistryFeatureFlag` (404 before anything when `SECURELOGIC_ASSET_REGISTRY_ENABLED` ≠ true)
→ `requireApiKey` → `attachOrganizationContext` → `requirePremiumOrCorePlatform` (P9 dual-gate)
→ `asTenant`:

- `POST /asset-assessments` — create for any registry asset (org-scoped registry
  existence check via `asset_registry_v`).
- `GET /asset-assessments?asset_type=&asset_id=&status=` — org-scoped list.
- `GET /asset-assessments/:id` — detail.
- `PATCH /asset-assessments/:id` — spec-driven transition; finding on first
  transition into a finding status; terminal statuses immutable.

No new env flag. No render.yaml change. GATE B untouched.

## 4. Migrations (additive only)

`20260810_asset_assessments.sql`: table + indexes + RLS + `findings` /
`evidence` `source_type` CHECK expansions (`asset_assessment`). Rollback:
drop table + re-narrow the two CHECKs (values unused while dark).

## 5. Tests

- Spec↔legacy lockstep: every legacy validation module's status-machine exports
  equal its spec row (drift fails CI).
- Engine unit: transition legality, terminal immutability, finding-on-FIRST-
  transition-only, severity requirement on finding statuses.
- Route tests mirroring an existing stack's suite (obligationAssessments is the
  cleanest template) + flag-off 404 + entitlement/dual-gate behavior.
- Isolation (CI-only): cross-org read/write denial on `asset_assessments`.

## 6. Explicitly deferred (with citation)

- Legacy route-transaction delegation (EAR-AD-7 step 2) — follow-up epic, one
  stack per PR.
- Create-validator unification — names/requiredness genuinely diverge; no value.
- WORM/hash-chain assessment evidence — if auditor-grade assessment records are
  ever required, adopt the applicability pattern (20260725 +
  `applicabilityAssessmentWriter.ts` + `contentHash.ts`) rather than the shared
  `evidence` table's application-level immutability.
- Gate normalization of `vendorAssessments`/`dependencyAssessments` (still raw
  `requireEntitlement("premium")`, skipped by P9's ten-file scope) — belongs to
  the P9 cutover decision (STOP GATE), not P10.
