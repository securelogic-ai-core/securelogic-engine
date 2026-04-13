# SecureLogic AI Canonical Risk Model

## Purpose

This document defines the canonical object model for risk and posture across the SecureLogic AI platform.

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
| Evidence | — | — | Not started |
| Risk (register) | — | — | Not started |

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
- `assessment`
- `control_test`
- `vendor_review`
- `ai_review`
- `signal`
- `manual`

### Source Type (actions)
- `assessment`
- `finding`
- `signal`
- `manual`

### Domain (non-exhaustive — extend as needed)
- `Access Management`
- `Vendor Risk`
- `AI Governance`
- `Regulatory`
- `Vulnerability`
- `Resilience`
- `General`

---

## Key Relationships

```
Organization
  ├── Findings (organization_id FK, source_type FK to source record)
  ├── Actions (organization_id FK, source_id to finding/assessment/signal)
  ├── Posture Snapshots (organization_id FK, one per org per day)
  │     └── Domain Scores (posture_snapshot_id FK)
  ├── Assessments (organization_id FK)
  │     └── Findings (assessment_id FK — now optional for platform-sourced findings)
  ├── Signals (organization_id FK — see signals table)
  ├── Vendors (organization_id FK)
  │     └── Vendor Assessments (vendor_id FK → vendor_assessments)
  │           └── Findings (source_type='vendor_review', source_id=vendor_assessments.id)
  ├── AI Systems (organization_id FK)
  │     └── Governance Reviews (ai_system_id FK → governance_reviews)
  │           └── Findings (source_type='ai_review', source_id=governance_reviews.id)
  ├── Frameworks (organization_id FK)
  │     └── Requirements (framework_id FK)
  ├── Controls (organization_id FK)
  │     ├── Control Mappings (control_id FK → requirements)
  │     └── Control Assessments (control_id FK → control_assessments)
  │           └── Findings (source_type='control_test', source_id=control_assessments.id, domain='General')
  └── Obligations (organization_id FK)
        └── Obligation Mappings (obligation_id FK → obligation_mappings → requirements)
```

---

## Posture Computation Policy (current)

Engine: `DomainRiskAggregationEngineV2` + `OverallRiskAggregationEngineV2`

Inputs: open findings (severity, domain), open action count, overdue action count, org context profile

Context weighting: **live** — `regulated`, `handles_pii`, `safety_critical`, `scale` columns read from organizations table and passed as engine context. Multipliers: regulated +0.2, safety_critical +0.3, handles_pii +0.2, scale Small=0, Medium=0.1, Enterprise=0.2.

Null score: when there are zero open findings, overall_score is NULL (not zero). Must be presented as "insufficient data."

FALLBACK_CONTEXT: used only when org profile cannot be read (should not occur in production). Equivalent to unweighted scoring. Must be logged as a warning when reached.

---

## Locked Package Decisions (governance-level)

These decisions are locked and must not be relitigated during spec or implementation.

### control-assessment-workflow

1. **Mutable workflow**: control-assessment-workflow is a mutable workflow record. Controls move through assessment states over time. The assessment record is updated in place. It is not an immutable point-in-time snapshot.

2. **Finding linkage**: Findings produced by control-assessment-workflow use `source_type='control_test'` and `domain='General'`. They flow into the posture engine via the standard findings path. `domain='General'` is already a canonical enum value.

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
1. Define it in PLATFORM_DOMAIN_MODEL.md first
2. Write the migration
3. Write the API routes with org-scoping and entitlement gating
4. Add it to the table above with package attribution
5. Update shared enums if new enum values are required
