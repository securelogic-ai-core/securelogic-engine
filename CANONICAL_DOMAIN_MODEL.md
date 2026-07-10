# SecureLogic AI Canonical Domain Model

## Purpose

This document defines the canonical domain object model for the SecureLogic AI platform.

It is the authoritative reference for what domain objects exist, what they own, and how they relate.

No module may create a competing parallel version of any object listed here.
No output surface (Brief, dashboard, report) may become the source of truth for these objects.

---

## Governing Principles

### One concept, one object
Finding means Finding. Action means Action. Posture Snapshot means Posture Snapshot.
Do not create issue_finding, brief_action, or report_posture as parallel concepts.

### Organization-centricity
Every domain object belongs to an organization.
Every query, rollup, and report must be org-scoped.

### Outputs consume, not define
Brief Issues, Reports, and Dashboards read from canonical domain objects.
They do not define or store primary domain truth.

### Structured over prose
Findings, Actions, Vendors, AI Systems, Obligations, and Controls must be persisted as structured records.
Storing these as free text or JSON blobs is architectural debt.

### Shared enums only
Severity, priority, status, domain, and source_type are centrally defined.
They must not be re-declared differently in each module.

---

## Package Build Status

| Object | DB Table | API Routes | Status |
|--------|----------|------------|--------|
| Finding | findings (expanded) | GET /api/findings, PATCH /api/findings/:id | Complete — package platform-foundation-findings-actions-posture |
| Action | actions | POST /api/actions, GET /api/actions, PATCH /api/actions/:id | Complete — package platform-foundation-findings-actions-posture |
| Posture Snapshot | posture_snapshots + domain_scores | POST /api/posture/snapshot, GET /api/posture/latest, GET /api/posture/history | Complete — package platform-foundation-findings-actions-posture |
| Assessment | assessments | POST /api/assess, GET /api/assessments/:id | Complete — prior package |
| Signal | signals | signals API | Complete — prior package |
| Signal Vendor Link | signal_vendor_links | POST /api/signal-vendor-links, DELETE /api/signal-vendor-links/:id, GET /api/vendors/:id/signals, GET /api/cyber-signals/:id/vendors | Complete — package signal-to-vendor-linkage |
| Signal AI System Link | signal_ai_system_links | POST /api/signal-ai-system-links, DELETE /api/signal-ai-system-links/:id, GET /api/ai-systems/:id/signals, GET /api/cyber-signals/:id/ai-systems | Complete — package signal-to-AI-system-linkage |
| Signal Control Link | signal_control_links | POST /api/signal-control-links, DELETE /api/signal-control-links/:id, GET /api/controls/:id/signals, GET /api/cyber-signals/:id/controls | Complete — package signal-to-control-linkage |
| Signal Obligation Link | signal_obligation_links | POST /api/signal-obligation-links, DELETE /api/signal-obligation-links/:id, GET /api/obligations/:id/signals, GET /api/cyber-signals/:id/obligations | Complete — package signal-to-obligation-linkage |
| Signal Match Suggestion | signal_match_suggestions | GET /api/signal-match-suggestions (?sort, ?offset), GET /api/signal-match-suggestions/counts, POST /api/signal-match-suggestions/:id/accept, POST /api/signal-match-suggestions/:id/dismiss | Complete — packages signal-match-suggestions + matcher-queue-ui. Primary consumption surface is /queue with embedded views planned on signal and entity detail pages. |
| Canonical Product | canonical_products (Phase C1b — defined here first per the Amendment Protocol; migration not yet written) | (internal normalizer `src/api/lib/canonicalProduct.ts`; no public route) | Convergence Phase C1 (DARK, pure). **INTERMEDIATE reference entity (ruling R1)** that normalizes external product/version/package/service identities BEFORE tenant-asset resolution — NOT the primary customer-risk object; impact attaches to canonical tenant assets, never to products or vendors. **Org-neutral** (like `cyber_signals`, no tenant data). **R2 invariant:** vendor identity ALONE is never product-identifiable and must never yield an `affected` determination. Reuses the single `canonicalizeVendorName` normalizer (no second normalizer). See `docs/architecture/proposals/CONVERGENCE-ROADMAP.md` (C1). |
| Industry Starter Template | (no table — static TS modules in src/templates/; loaded data lands in vendors/ai_systems/obligations/controls with template_source attribution) | GET /api/templates, GET /api/templates/:industry, POST /api/templates/load | Complete — package industry-starter-templates. v1 ships dark in production behind SECURELOGIC_INDUSTRY_TEMPLATES_ENABLED until domain expert review clears `needs_review:true` entries. Surfaces: /templates page, dashboard banner (first 7 days). |
| AI System Vendor Dependency | ai_system_vendor_dependencies | POST /api/ai-system-vendor-dependencies, DELETE /api/ai-system-vendor-dependencies/:id, GET /api/ai-systems/:id/vendors, GET /api/vendors/:id/ai-systems | Complete — package ai-system-vendor-dependencies (matcher cascade is a separate package) |
| Risk Scoring Weights | risk_scoring_weights | GET /api/risk-scoring-weights, PUT /api/risk-scoring-weights, POST /api/signal-match-suggestions/:id/recompute-score | Complete — package obligation-aware-risk-scoring (matcher rewire to invoke at suggestion-creation is a separate package) |
| Organization | organizations | admin API | Profile fields complete — package org-profile-context-weighting |
| Vendor | vendors (extended) | POST /api/vendors, GET /api/vendors, GET /api/vendors/:id, PATCH /api/vendors/:id | Complete — package vendor-risk-primitives |
| Vendor Assessment | vendor_assessments | POST /api/vendor-assessments, GET /api/vendor-assessments, GET /api/vendor-assessments/:id | Complete — package vendor-assessment-workflow |
| AI System | ai_systems | POST /api/ai-systems, GET /api/ai-systems, GET /api/ai-systems/:id | Complete — package ai-system-governance-primitives |
| Governance Review | governance_reviews | POST /api/governance-reviews, GET /api/governance-reviews, GET /api/governance-reviews/:id | Complete — package ai-system-governance-primitives |
| Framework | frameworks | POST /api/frameworks, GET /api/frameworks, GET /api/frameworks/:id | Complete — package control-framework-primitives |
| Requirement | requirements | POST /api/requirements, GET /api/requirements, GET /api/requirements/:id | Complete — package control-framework-primitives |
| Control | controls | POST /api/controls, GET /api/controls, GET /api/controls/:id | Complete — package control-framework-primitives |
| Control Mapping | control_mappings | POST /api/control-mappings, GET /api/control-mappings | Complete — package control-framework-primitives |
| Control Assessment | control_assessments | POST /api/control-assessments, GET /api/control-assessments, GET /api/control-assessments/:id, PATCH /api/control-assessments/:id | Complete — package control-assessment-workflow, commit 138e2b6b |
| Obligation | obligations | POST /api/obligations, GET /api/obligations, GET /api/obligations/:id, PATCH /api/obligations/:id | Complete — package obligation-regulatory-primitives, commit 32b23a80 |
| Obligation Mapping | obligation_mappings | POST /api/obligation-mappings, GET /api/obligation-mappings | Complete — package obligation-regulatory-primitives, commit 32b23a80 |
| Obligation Assessment | obligation_assessments | POST /api/obligation-assessments, GET /api/obligation-assessments, GET /api/obligation-assessments/:id, PATCH /api/obligation-assessments/:id | Complete — package obligation-assessment-workflow, commit 35ce54bd |
| Evidence | evidence | GET /api/evidence/summary, POST /api/evidence, GET /api/evidence, GET /api/evidence/:id | Complete — package evidence-primitives |
| Risk (register) | risks | POST /api/risks, GET /api/risks, GET /api/risks/summary, GET /api/risks/:id, PATCH /api/risks/:id | Complete — package risk-register-primitives |
| Dependency | dependencies | POST /api/dependencies, GET /api/dependencies, GET /api/dependencies/summary, GET /api/dependencies/:id, PATCH /api/dependencies/:id | Complete — package dependency-primitives |
| Risk Treatment | risk_treatments | POST /api/risk-treatments, GET /api/risk-treatments, GET /api/risk-treatments/:id, PATCH /api/risk-treatments/:id | Complete — package risk-treatment-workflow |
| Vendor Review | vendor_reviews | POST /api/vendor-reviews, GET /api/vendor-reviews, GET /api/vendor-reviews/:id, PATCH /api/vendor-reviews/:id | Complete — package vendor-review-workflow |
| AI Governance Assessment | ai_governance_assessments | POST /api/ai-governance-assessments, GET /api/ai-governance-assessments, GET /api/ai-governance-assessments/:id, PATCH /api/ai-governance-assessments/:id | Complete — package ai-governance-review-workflow |
| Dependency Assessment | dependency_assessments | POST /api/dependency-assessments, GET /api/dependency-assessments, GET /api/dependency-assessments/:id, PATCH /api/dependency-assessments/:id | Complete — package dependency-review-workflow |
| Vendor Assurance Document | vendor_assurance_documents | POST /api/vendor-assurance/documents, GET /api/vendor-assurance/documents, GET /api/vendor-assurance/documents/:id, GET /api/vendor-assurance/documents/:id/extraction, GET /api/vendor-assurance/documents/:id/pdf, POST /api/vendor-assurance/extractions/:id/review-decisions, POST /api/vendor-assurance/documents/:id/finalize | Phase 1 — package vendor-assurance-intelligence-phase-1. Staging-only behind SECURELOGIC_VENDOR_ASSURANCE_ENABLED. PDF stored in Cloudflare R2 via the Phase 0 blob primitive at org/{organizationId}/vendor-assurance/{documentId}/original.pdf. Extraction is one-per-document (no re-extraction). Review decisions are APPEND-ONLY — no UNIQUE on (extraction_id, field_name); current decision per field = latest by (decided_at DESC, id DESC). Finalize requires every material field to have a current decision. Reviewed values display on the vendor detail card via projection-at-read-time; no stored snapshot table. No writes to findings, vendor_assessments, vendor_reviews, risks, signal_*_links, or vendors.current_risk_score. |


| Enterprise Entity | enterprise_entities (+ typed child enterprise_data_stores) | GET /api/enterprise-entities, POST /api/enterprise-entities, GET /api/enterprise-entities/:id, PATCH /api/enterprise-entities/:id, DELETE /api/enterprise-entities/:id | Slice 1 — package enterprise-context-layer-foundation (Priority 5). Canonical HEADER for NEW customer-context objects; `vendors`/`ai_systems` keep their own tables and are NOT valid `entity_type`s (referenced later, never copied). Typed load-bearing attributes (classification/residency/retention/encryption) live in the child `enterprise_data_stores`, never a JSON blob. Behind SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED (default off; **do NOT enable in prod until the AD-17 capability grant ships** — else reaches all rank-4 orgs, per §9). Per-org cap `organizations.max_enterprise_entities`, SEPARATE from max_monitored_entities (does not touch enforceEntityLimit). RLS inert (NOT FORCE). OUT of Slice 1: relationship graph, applicability engine, CSV import, connectors, UI, entity↔risk/finding links. |
| Enterprise Relationship | enterprise_relationships | GET /api/enterprise-relationships (?node_type,&node_id), POST /api/enterprise-relationships, DELETE /api/enterprise-relationships/:id | Slice 2 — package enterprise-context-layer-foundation (Priority 5). Generic ADDITIVE intra-org edge for NEW relationships; polymorphic endpoints (enterprise_entity/vendor/ai_system/user), no FK; soft-delete. The read-time resolver UNIONs the existing TYPED edges (typed-authoritative, AD-13) — a later slice **S2b**; this ships the edge substrate + CRUD only. Two-endpoint same-org pre-flight; behind SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED; RLS inert (NOT FORCE). |
| Enterprise Graph (read-time) | (no table — resolver over enterprise_relationships + ai_system_vendor_dependencies) | GET /api/enterprise-graph (?node_type,&node_id,&depth) | Slice 2b — bounded (MAX_DEPTH 5, default 3) cycle-safe outbound traversal (`enterpriseGraphResolver.ts`, the repo's first WITH RECURSIVE). Typed-edge-authoritative UNION (AD-13): generic edges + the typed ai_system↔vendor dependency; other typed edges (dependencies, signal_*_links with global-signal endpoints, risk_*_links) are a documented later extension. Org-isolated by the `organization_id=$org` edge filter + seed-node same-org pre-flight. ⚠ NOT load-tested at Fortune-500 fan-out (AR-4) — do not raise MAX_DEPTH without the load test; materialized-adjacency fallback is the designed escape. |
| Applicability Assessment | applicability_assessments (+ children applicability_evidence, applicability_affected_entities) | (no public route yet — internal writer `applicabilityAssessmentWriter`, Slice 4c `cb15c788`; explainability render layer Slice 5 `cb1c2be2`) | Slice 4b (Priority 5). The **immutable, by-value, hash-chained, reproducible** record of a per-org applicability decision (AD-16): `decision` (5-value enum) + `confidence` 0–100 + band + ordered `reasoning_steps` (JSONB narration trace, by value) + `content_hash`/`prev_hash` chain. Produced by the pure `ApplicabilityEngineV1` (Slice 4a, `src/engine/applicability/v1/`). **WORM** — UPDATE/DELETE/TRUNCATE blocked by trigger regardless of role (survives the app_request/FORCE flip); app_request granted SELECT,INSERT only. `applicability_evidence` = by-value input snapshots (reproducibility); `applicability_affected_entities` = normalized blast radius (queryable). **Ships NON-PARTITIONED** (partition strategy deferred to S3.5/pre-4c-write per that gate) and with **no `is_current` column** (WORM forbids the flip; "current" is derived from the `(org,signal,target,created_at DESC)` index) — both reconcile ENTERPRISE_CONTEXT_ARCHITECTURE.md via the S4b doc-sync. Behind SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED; RLS inert (NOT FORCE). **Written by the Slice 4c internal worker** (`cb15c788`; migration `20260727_applicability_assessments_seq.sql`; runs `ApplicabilityEngineV1` and persists under `withTenant` with an advisory-locked `prev_hash` for the hash chain). Rendered by the pure **Slice 5 explainability** layer (`src/engine/applicability/v1/explainability.ts`, `cb1c2be2`). **Slice 6 workflow-recommendation core** (`src/engine/applicability/v1/workflowRecommendations.ts`, `b82bd4cb`) and **Slice 7 signal-linkage / reassessment+drift core** (`33f4a929`) derive downstream recommendations — all pure/inert (no callers). |
| Enterprise Capability & Caps | `organizations.enterprise_context_capability` (bool, NULL=inherit Platform default) + `organizations.max_enterprise_edges` / `max_enterprise_entities` (caps, SEPARATE from `max_monitored_entities`) | (gate applied in-route via `requireCapability`, not a standalone route) | Slice 9 — package enterprise-context-layer-foundation (Priority 5), **GATE A ruled 2026-07-04**, `c495dc0c`. Access = Platform Professional + Enterprise; capability-based grant (`src/api/lib/enterpriseContextCapability.ts`, capability key `enterprise_context`, Platform default on, per-org override). Migrations `20260728_org_enterprise_context_caps.sql` + `20260729_org_enterprise_context_capability.sql`. Caps default 10k entities / 50k edges; edge-cap enforcement returns 409. Operator grant/tune = ledger L-7 (`UPDATE organizations …`, no DDL). Still behind `SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED` (GATE B) until prod enable. |
| Connector Framework | (no domain table — pluggable registry `src/api/lib/connectors/`) | (no public route — dark ingestion adapters) | Slice 8 — package enterprise-context-layer-foundation (Priority 5), `d0351c1c`. Connector registry + normalized-import contract; reference adapter `servicenow_cmdb` (`d0351c1c`) + **all 8 remaining adapters IMPLEMENTED in R7** (Defender/CrowdStrike/Wiz via OAuth client-credentials — `HttpClient` gained optional postForm/postJson; Tenable/Qualys/Rapid7 header-keyed; cloud inventory via a documented v1 pre-authorized-export-URL ingestion; identity provider Okta-first SSWS), each with mock-backed tests. `IMPORT_ENTITY_TYPES` extended with `identity` so IdP users flow through `planImport`. Real-credential round-trips are operator work (ledger L-5.1..L-5.9). Dark — no route/worker calls any connector. |

---

## Canonical Enums

These are the single source of truth. Do not redefine them anywhere else.

### Severity
- `Critical`
- `High`
- `Moderate`
- `Low`

### Priority
- `immediate`
- `near_term`
- `planned`
- `watch`

### Status (findings)
- `open`
- `in_progress`
- `closed`

> **Two-axis model (shipped #562 + ratified 2026-07-10).** The legacy single
> `status` above is being generalized into two orthogonal axes, per
> `docs/specs/finding-lifecycle-spec.md` (RATIFIED):
> - **`operational_status`** — SYSTEM-DERIVED from workflow evidence (Actions/Evidence):
>   `open | in_progress | remediated`. Never hand-set.
> - **`decision_state`** — HUMAN-GOVERNED (shipped #562): `needs_review | mitigating |
>   accepted_risk | resolved`. The system writes only its *initial* value (R3).
> - Legacy `status` is retained as a **derived projection** of the two axes for
>   backward-compatible readers (posture/exports/dashboard).
> - `finding_review_marks` is a per-user "last reviewed" cursor — NOT a lifecycle state.
>
> Invariant: *operational_status is never hand-set; decision_state is never computed
> except its initial value.* Implementation lands in convergence Phase C6 (dark).

### Status (actions)
- `open`
- `in_progress`
- `blocked`
- `closed`
- `accepted`

### Source Type (findings)
DB-canonical (findings.source_type CHECK constraint — authoritative):
- `assessment` — direct assessment findings
- `control_test` — control assessment workflow (mutable, `control_assessments`)
- `vendor_review` — vendor assessment workflow (point-in-time, `vendor_assessments`)
- `vendor_cycle_review` — vendor review workflow (mutable, `vendor_reviews`)
- `ai_review` — governance review (point-in-time, `governance_reviews`)
- `ai_governance_review` — AI governance assessment workflow (mutable, `ai_governance_assessments`)
- `obligation_review` — obligation assessment workflow (`obligation_assessments`)
- `dependency_review` — dependency assessment workflow (mutable, `dependency_assessments`)
- `cyber_signal` — findings auto-created by the cyber-signal ingestion matcher (distinct from `signal`, the Intelligence Brief pipeline)
- `signal` — signal-sourced findings
- `manual` — manually entered findings
- `risk` — posture signals derived from open risk register entries
- `applicability_assessment` — findings auto-drafted by the ECL applicability workflow dispatcher (R2/Slice 6, migration `20260730`); `source_id` = `applicability_assessments.id`, one generated finding per assessment (partial unique index)

### Source Type (actions)
- `assessment`
- `finding`
- `signal`
- `manual`
- `risk`
- `obligation` — GAP-3 increment 3 (`20260628`); `source_id` = obligation UUID
- `applicability_assessment` — ECL applicability workflow dispatcher (R2/Slice 6, `20260730`); `source_id` = `applicability_assessments.id`; generated markers `auto_applicability_risk_review` / `auto_applicability_evidence_request` / `auto_applicability_human_review`, each with its own partial unique dedup index

### Domain (non-exhaustive — extend as needed)
- `Access Management`
- `Vendor Risk`
- `AI Governance`
- `Regulatory`
- `Vulnerability`
- `Resilience`
- `General`

### Evidence Type
- `document`
- `screenshot`
- `log`
- `test_result`
- `interview`
- `observation`
- `policy`
- `other`

### Evidence Source Type (evidence.source_type CHECK constraint)
- `control_test` → `control_assessments`
- `vendor_review` → `vendor_assessments`
- `ai_review` → `governance_reviews`
- `ai_governance_review` → `ai_governance_assessments`
- `obligation_review` → `obligation_assessments`
- `dependency_review` → `dependency_assessments`
- `risk_treatment` → `risk_treatments`
- `finding` → `findings`

### Risk Likelihood
- `very_likely`
- `likely`
- `possible`
- `unlikely`
- `rare`

### Risk Impact / Risk Rating
Maps to canonical Severity enum: `Critical`, `High`, `Moderate`, `Low`

### Risk Status
- `open`
- `accepted`
- `mitigated`
- `closed`
- `transferred`

### Dependency Type
- `software_library`
- `cloud_service`
- `infrastructure`
- `api`
- `other`

### Dependency Status
- `active`
- `deprecated`
- `under_review`

### Risk Treatment Status
- `not_started`
- `in_progress`
- `mitigated` (terminal — syncs parent risk.status)
- `accepted` (terminal — syncs parent risk.status)
- `transferred` (terminal — syncs parent risk.status)

### Risk Treatment Type
- `mitigate`
- `accept`
- `transfer`
- `avoid`

### Vendor Review Status
- `not_started`
- `in_progress`
- `satisfactory`
- `concerns_identified` (triggers finding on first transition)
- `critical_issues` (triggers finding on first transition)

### AI Governance Assessment Status
- `not_started`
- `in_progress`
- `compliant`
- `non_compliant` (triggers finding on first transition)
- `partially_compliant` (triggers finding on first transition)

### Dependency Assessment Status
- `not_started`
- `in_progress`
- `acceptable`
- `flagged` (triggers finding on first transition)
- `needs_remediation` (triggers finding on first transition)

---

### Enterprise Entity Type (enterprise_entities.entity_type CHECK constraint)
Controlled taxonomy for the Enterprise Context Layer header. `vendor` and `ai_system`
are intentionally NOT members — those concepts own their own tables (One concept, one
object). Additive-only; extend via migration + this list together.
- asset
- application
- business_service
- business_unit
- department
- data_store
- data_classification
- identity
- business_process  (added via migration 20260827; projects to asset_type `business_process`)

### Enterprise Data Classification (enterprise_data_stores.data_classification CHECK constraint)
- public
- internal
- confidential
- restricted

### Enterprise Relationship Node Type (enterprise_relationships.from_type / to_type CHECK constraint)
Node types an edge endpoint may reference. `enterprise_entity` is a NEW ECL node; the
others are existing canonical objects the graph points AT (never contains — AD-3).
- enterprise_entity
- vendor
- ai_system
- user

### Enterprise Relationship Type (enterprise_relationships.relationship_type CHECK constraint)
- depends_on
- runs_on
- owned_by
- part_of
- serves
- processes_data_in

### Applicability Decision (applicability_assessments.decision CHECK constraint)
Single source of truth: `APPLICABILITY_DECISIONS` in `src/engine/applicability/v1/types.ts`
(the pure engine's output enum) — the DB CHECK mirrors it; keep in lockstep.
- affected
- potentially_affected
- not_affected
- needs_review
- unknown

### Applicability Confidence Band (applicability_assessments.confidence_band CHECK constraint)
Single source of truth: `CONFIDENCE_BANDS` in `src/engine/applicability/v1/types.ts`.
- low
- medium
- high

## Key Relationships

```
Organization
  ├── Findings (organization_id FK, source_type FK to source record)
  ├── Actions (organization_id FK, source_id to finding/assessment/signal/risk)
  ├── Posture Snapshots (organization_id FK, one per org per day)
  │     └── Domain Scores (posture_snapshot_id FK)
  ├── Assessments (organization_id FK)
  │     └── Findings (assessment_id FK — now optional for platform-sourced findings)
  ├── Signals (organization_id FK — see signals table)
  ├── Evidence (organization_id FK, source_type/source_id app-level linkage, immutable)
  ├── Risks (organization_id FK — risk register)
  │     ├── Risk Treatments (risk_id FK → risk_treatments)
  │     │     └── Evidence (source_type='risk_treatment', source_id=risk_treatments.id)
  │     └── (posture scoring: open risks mapped to signal shape, source_type='risk')
  ├── Dependencies (organization_id FK)
  │     └── Dependency Assessments (dependency_id FK → dependency_assessments)
  │           └── Findings (source_type='dependency_review', source_id=dependency_assessments.id)
  ├── Vendors (organization_id FK; template_source TEXT NULL carries the industry-starter-template id ('healthcare-saas' / 'fintech' / 'b2b-ai') for analytics-only attribution; manually-entered rows have NULL. template_metadata JSONB NULL carries curation-time flags { processes_pii, processes_phi, processes_payment_data, processes_ai_inference, baa_required } under a `flags` sub-key when loaded from a template; manually-entered rows have NULL.)
  │     ├── Vendor Assessments (vendor_id FK → vendor_assessments)
  │     │     └── Findings (source_type='vendor_review', source_id=vendor_assessments.id)
  │     ├── Vendor Reviews (vendor_id FK → vendor_reviews, mutable workflow)
  │     │     └── Findings (source_type='vendor_cycle_review', source_id=vendor_reviews.id)
  │     ├── Vendor Assurance Documents (organization_id FK, vendor_id FK → vendors; SOC PDF stored in R2)
  │     │     └── Vendor Assurance Extraction (one per document)
  │     │           ├── Vendor Assurance Extraction Spans (per-field source-text spans)
  │     │           └── Vendor Assurance Review Decisions (APPEND-ONLY; current decision per field = latest by decided_at)
  │     └── Signal Vendor Links (organization_id FK, signal_id FK → cyber_signals, vendor_id FK → vendors)
  ├── AI Systems (organization_id FK; template_source TEXT NULL — wired but unused in v1 templates; the customer's AI features are entered manually after template load.)
  │     ├── Governance Reviews (ai_system_id FK → governance_reviews, point-in-time)
  │     │     └── Findings (source_type='ai_review', source_id=governance_reviews.id)
  │     ├── AI Governance Assessments (ai_system_id FK → ai_governance_assessments, mutable)
  │     │     └── Findings (source_type='ai_governance_review', source_id=ai_governance_assessments.id)
  │     ├── AI System Vendor Dependencies (organization_id FK; ai_systems ↔ vendors — typed by dependency_role {model_provider, runtime, registry, training_data, feature_store, mlops_platform, data_source, observability, other}; partial unique on (org, ai_system, vendor, role) WHERE deleted_at IS NULL so the same vendor can serve multiple roles for one AI system; the cascade-side query GET /api/vendors/:id/ai-systems is the edge a future matcher-cascade package will traverse to propagate vendor signals to dependent AI systems)
  │     └── Signal AI System Links (organization_id FK; cyber_signals ↔ ai_systems — external-signal connectivity, parallel to Signal Vendor Links; permits global-org signals)
  ├── Frameworks (organization_id FK)
  │     └── Requirements (framework_id FK)
  ├── Controls (organization_id FK; template_source TEXT NULL carries industry-starter-template id when loaded from a template. Framework linkage from a template is established via control_mappings → a synthetic requirements row per (framework, template) titled '{Template Name} template baseline'. Pre-existing controls skipped via ON CONFLICT DO NOTHING are NOT retroactively framework-tagged.)
  │     ├── Control Mappings (control_id FK → requirements)
  │     ├── Control Assessments (control_id FK → control_assessments)
  │     │     └── Findings (source_type='control_test', source_id=control_assessments.id, domain='General')
  │     └── Signal Control Links (organization_id FK; cyber_signals ↔ controls — external-signal connectivity, parallel to Signal Vendor / AI System Links; permits global-org signals)
  ├── Obligations (organization_id FK; template_source TEXT NULL carries industry-starter-template id when loaded from a template. Dedup at template-load time is via the table's UNIQUE (organization_id, title); jurisdiction is not part of the unique, so the same regulation_name across templates skips on second load.)
  │     ├── Obligation Mappings (obligation_id FK → obligation_mappings → requirements)
  │     ├── Obligation Assessments (obligation_id FK → obligation_assessments)
  │     │     └── Findings (source_type='obligation_review', source_id=obligation_assessments.id, domain=obligation.domain)
  │     └── Signal Obligation Links (organization_id FK; cyber_signals ↔ obligations — external-signal connectivity, parallel to Signal Vendor / AI System / Control Links; permits global-org signals)
  ├── Signal Match Suggestions (organization_id FK, signal_id FK → cyber_signals; polymorphic by (target_type, target_id) over vendors/ai_systems/controls/obligations — same shape as findings(source_type, source_id) and evidence(source_type, source_id); decision state {pending, accepted, dismissed}; on accept, the row carries accepted_link_id pointing into the appropriate signal_*_links table identified by target_type; match_score integer in [0, 100] (CHECK constraint enforces range) and match_metadata jsonb { source, matched_branch, matched_string } are populated by runMatcherForSignal at signal ingest on three paths — API ingest (routes/cyberSignals.ts), briefScheduler daily per-org pipeline (lib/briefScheduler.ts), and worker fan-out per active org (services/intelligence-worker/src/pipeline/runPipeline.ts + kevPoller.ts). The recompute endpoint POST :id/recompute-score remains for post-weights-change re-ranking. The partial unique index on (org, signal, target_type, target_id) WHERE pending lets the matcher re-suggest after a prior dismissal — accidental-dismissal recovery and weight-change re-surfacing both rely on this. Dual-write with findings (source_type='cyber_signal') preserved for backward-compat with five live readers; reader migration is a separate package. **Primary consumption surface is the /queue page** (app/src/app/queue/page.tsx) — pending suggestions sorted by created-desc default or score-desc with NULLS LAST, paginated via ?offset, filterable by target_type. Counts feed via GET /counts (per-target-type breakdown plus lifetime_total used to discriminate filtered-empty from first-time-empty states). Embedded views on signal-detail and entity-detail pages will reuse the SuggestionList component in a follow-up package; signal-detail itself is intentionally not built yet — see docs/queue-ui-design-decisions.md.)
  └── Risk Scoring Weights (organization_id FK, UNIQUE; one row per org holding three named JSONB weight maps that drive computeRiskScore: entity_criticality_weights {critical, high, medium, low}, obligation_priority_weights {immediate, near_term, planned, watch}, severity_weights {Critical, High, Moderate, Low}. **TWO-VOCABULARY DESIGN**: severity_weights uses PascalCase keys because cyber_signals.severity is stored that way ('Critical'/'High'/'Moderate'/'Low'); entity_criticality_weights uses lowercase because vendors.criticality and ai_systems.criticality are stored that way ('critical'/'high'/'medium'/'low' — note 'medium' not 'moderate'). The two enums are conceptually parallel but lexically distinct; the scoring function does NOT canonicalize. Mixing the vocabularies is a real bug surface — keeping them as separate maps with their stored vocabularies prevents accidental "Moderate"="medium" conflation. Customer-configurable via GET/PUT; falls back to DEFAULT_WEIGHTS when no row exists. Score formula: round(severity_w * entity_w * obligation_w * 100); all four target types score in [0, 100]. KEV override fixes severity_w=1.0 when signal.source='cisa-kev'. **ENTITY-DIMENSION ASYMMETRY** (intentional, do not "fix"): vendor / ai_system look up criticality and default to 0.5 with an explanation flag when missing — a genuine data gap the customer can fix. Controls always default to 0.5 with an explanation flag — controls have no criticality column today; a future column-addition package becomes a pure improvement. Obligations use entity_w=1.0 as a multiplicative-neutral element BY DESIGN, with NO explanation flag — the entity dimension does not apply to obligations (their per-row weight is the obligation_priority dimension), so it must not penalize the score. Defaulting obligations to 0.5 here would systematically cap obligation scores at 50 and invert the package's stated purpose ("obligation-aware risk scoring"). The neutral-1.0 treatment mirrors how the obligation dimension uses 1.0 for non-obligation entity types — same multiplicative-neutral pattern in both directions.)
```

---

## Posture Computation Policy (current)

Engine: `DomainRiskAggregationEngineV2` + `OverallRiskAggregationEngineV2`

Inputs: open findings (severity, domain), open risks mapped to signal shape (risk_rating → severity), open action count, overdue action count, org context profile

Risk signals: open risk register entries (status='open') are fetched separately and merged with findings as `DbFindingForPosture` objects before being passed to the engine. They are counted separately in `computation_rationale.workflow_signal_breakdown.risk_signals`.

Treatment transparency: open risks with at least one active treatment (risk_treatments.status IN ('not_started', 'in_progress')) are still scored — the risk is open until treatment reaches a terminal state. The count is surfaced in `computation_rationale.risks_under_active_treatment` for transparency, not used to discount scoring.

Context weighting: **live** — `regulated`, `handles_pii`, `safety_critical`, `scale` columns read from organizations table and passed as engine context. Multipliers: regulated +0.2, safety_critical +0.3, handles_pii +0.2, scale Small=0, Medium=0.1, Enterprise=0.2.

Null score: when there are zero open findings, overall_score is NULL (not zero). Must be presented as "insufficient data."

FALLBACK_CONTEXT: used only when org profile cannot be read (should not occur in production). Equivalent to unweighted scoring. Must be logged as a warning when reached.

---

## Locked Package Decisions (governance-level)

These decisions are locked and must not be relitigated during spec or implementation.

### control-assessment-workflow

1. **Mutable workflow**: control-assessment-workflow is a mutable workflow record. Controls move through assessment states over time. The assessment record is updated in place. It is not an immutable point-in-time snapshot.

2. **Finding linkage**: Findings produced by control-assessment-workflow use `source_type='control_test'` and `domain='General'`. They flow into the posture engine via the standard findings path. `domain='General'` is already a canonical enum value.

### vendor-review-workflow

1. **Mutable workflow table**: `vendor_reviews` is a mutable, status-driven workflow table linked to `vendors`. It is distinct from `vendor_assessments` (point-in-time, immutable). The source_type collision was resolved by assigning `vendor_cycle_review` to vendor review workflow findings, preserving `vendor_review` for the existing point-in-time table.

2. **Finding linkage**: `source_type='vendor_cycle_review'`, `source_id=vendor_reviews.id`, `domain='Vendor Risk'`. Finding-triggering statuses: `concerns_identified`, `critical_issues`.

### ai-governance-review-workflow

1. **Mutable workflow table**: `ai_governance_assessments` is distinct from `governance_reviews` (point-in-time). Source_type `ai_governance_review` is assigned to the mutable workflow; `ai_review` is preserved for the existing point-in-time table.

2. **Finding linkage**: `source_type='ai_governance_review'`, `source_id=ai_governance_assessments.id`, `domain='AI Governance'`. Finding-triggering statuses: `non_compliant`, `partially_compliant`.

### dependency-review-workflow

1. **Mutable workflow table**: `dependency_assessments` is linked to `dependencies`. Source_type: `dependency_review`. Finding-triggering statuses: `flagged`, `needs_remediation`.

### risk-treatment-workflow

1. **Terminal status sync**: When a risk treatment reaches a terminal status (`mitigated`, `accepted`, `transferred`), the parent `risks.status` is updated to match. The risk then drops out of posture scoring on the next snapshot.

2. **Active treatment transparency**: The posture snapshot route counts open risks with at least one active treatment for inclusion in `computation_rationale.risks_under_active_treatment`.

### workflow-to-scoring-integration

1. **Pure, no I/O**: `workflowScoringIntegration.ts` contains only pure functions with no database access. All DB queries live in `posture.ts`.

2. **Rationale enrichment**: `computation_rationale` on every posture snapshot is enriched with a `workflow_signal_breakdown` object attributing each signal to its workflow source. This is additive to the existing rationale object and does not change scoring behavior.

---

## Objects the Platform Must Never Fake

These must always be structured records. Never store as free text:

- Findings
- Actions
- Vendors
- AI Systems
- Obligations
- Controls
- Posture Snapshots

If a future module is tempted to store these as JSON blobs in a publication object, that is a domain model violation.

---

## Ratified architecture direction — Enterprise Risk Graph convergence (2026-07-10)

The canonical **noun is the tenant Asset as a node in an Enterprise Risk Graph** — not
the Vendor (one asset type) and not the Finding (a work-queue projection of an Observed
Condition). Vulnerability/threat intelligence **resolves to canonical tenant assets via
the single `ApplicabilityEngineV1`** (EAR-AD-3), never directly to vendors. This is a
**convergence** program onto existing (currently dark) machinery — there is exactly ONE
applicability engine, ONE evidence model (WORM by-value `applicability_evidence`), ONE
risk model, ONE lifecycle (the two-axis Finding/Risk model), ONE graph, ONE asset model.
No vendor-specific resolver, no second applicability engine, no parallel affected-vendor
contract.

Governing documents (authoritative for this direction):
- `docs/architecture/proposals/ENTERPRISE-RISK-GRAPH.md` — architecture + rulings R1–R3.
- `docs/architecture/proposals/CONVERGENCE-ROADMAP.md` — executable phases C0–C9, flags,
  gates, deprecation/deletion criteria.
- `docs/specs/finding-lifecycle-spec.md` — the ratified two-axis Finding lifecycle.

**Status:** direction ratified; implementation is dark behind existing flags (+ the new
engine-only `SECURELOGIC_SIGNAL_APPLICABILITY_ENABLED`), flag-off byte-identical, GATE-B
for production. The legacy signal→vendor path (`signal_vendor_links` as affected-truth)
is retained for compatibility until the operator-approved cutover gate, then retired.

---

## Amendment Protocol

To add a new canonical object:
1. Define it in this document first
2. Write the migration
3. Write the API routes with org-scoping and entitlement gating
4. Add it to the table above with package attribution
5. Update shared enums if new enum values are required
