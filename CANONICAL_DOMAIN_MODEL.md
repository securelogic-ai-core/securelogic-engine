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
| Signal Match Suggestion | signal_match_suggestions | GET /api/signal-match-suggestions, POST /api/signal-match-suggestions/:id/accept, POST /api/signal-match-suggestions/:id/dismiss | Complete — package signal-match-suggestions (matcher rewire is a separate package) |
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
- `signal` — signal-sourced findings
- `manual` — manually entered findings
- `risk` — posture signals derived from open risk register entries

### Source Type (actions)
- `assessment`
- `finding`
- `signal`
- `manual`
- `risk`

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
  ├── Vendors (organization_id FK)
  │     ├── Vendor Assessments (vendor_id FK → vendor_assessments)
  │     │     └── Findings (source_type='vendor_review', source_id=vendor_assessments.id)
  │     ├── Vendor Reviews (vendor_id FK → vendor_reviews, mutable workflow)
  │     │     └── Findings (source_type='vendor_cycle_review', source_id=vendor_reviews.id)
  │     └── Signal Vendor Links (organization_id FK, signal_id FK → cyber_signals, vendor_id FK → vendors)
  ├── AI Systems (organization_id FK)
  │     ├── Governance Reviews (ai_system_id FK → governance_reviews, point-in-time)
  │     │     └── Findings (source_type='ai_review', source_id=governance_reviews.id)
  │     ├── AI Governance Assessments (ai_system_id FK → ai_governance_assessments, mutable)
  │     │     └── Findings (source_type='ai_governance_review', source_id=ai_governance_assessments.id)
  │     ├── AI System Vendor Dependencies (organization_id FK; ai_systems ↔ vendors — typed by dependency_role {model_provider, runtime, registry, training_data, feature_store, mlops_platform, data_source, observability, other}; partial unique on (org, ai_system, vendor, role) WHERE deleted_at IS NULL so the same vendor can serve multiple roles for one AI system; the cascade-side query GET /api/vendors/:id/ai-systems is the edge a future matcher-cascade package will traverse to propagate vendor signals to dependent AI systems)
  │     └── Signal AI System Links (organization_id FK; cyber_signals ↔ ai_systems — external-signal connectivity, parallel to Signal Vendor Links; permits global-org signals)
  ├── Frameworks (organization_id FK)
  │     └── Requirements (framework_id FK)
  ├── Controls (organization_id FK)
  │     ├── Control Mappings (control_id FK → requirements)
  │     ├── Control Assessments (control_id FK → control_assessments)
  │     │     └── Findings (source_type='control_test', source_id=control_assessments.id, domain='General')
  │     └── Signal Control Links (organization_id FK; cyber_signals ↔ controls — external-signal connectivity, parallel to Signal Vendor / AI System Links; permits global-org signals)
  ├── Obligations (organization_id FK)
  │     ├── Obligation Mappings (obligation_id FK → obligation_mappings → requirements)
  │     ├── Obligation Assessments (obligation_id FK → obligation_assessments)
  │     │     └── Findings (source_type='obligation_review', source_id=obligation_assessments.id, domain=obligation.domain)
  │     └── Signal Obligation Links (organization_id FK; cyber_signals ↔ obligations — external-signal connectivity, parallel to Signal Vendor / AI System / Control Links; permits global-org signals)
  ├── Signal Match Suggestions (organization_id FK, signal_id FK → cyber_signals; polymorphic by (target_type, target_id) over vendors/ai_systems/controls/obligations — same shape as findings(source_type, source_id) and evidence(source_type, source_id); decision state {pending, accepted, dismissed}; on accept, the row carries accepted_link_id pointing into the appropriate signal_*_links table identified by target_type; match_score numeric(5,3) is populated by computeRiskScore via POST :id/recompute-score and read at queue ranking time)
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

## Amendment Protocol

To add a new canonical object:
1. Define it in this document first
2. Write the migration
3. Write the API routes with org-scoping and entitlement gating
4. Add it to the table above with package attribution
5. Update shared enums if new enum values are required
