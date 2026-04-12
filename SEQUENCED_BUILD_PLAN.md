# SecureLogic AI Sequenced Build Plan

## Purpose

This document defines the correct build sequence for the SecureLogic AI platform.

It is not a feature wishlist.
It is not a vision doc.
It is the order in which work must happen to avoid building on bad foundations.

Each package has a name, a dependency, and a clear done condition.
Packages are closed when validated and committed, not when coded.

---

## Governing Rules

- No package starts until its dependency packages are closed.
- No UI, dashboard, or output surface is built before its backing domain objects exist.
- No package is considered closed without a migration verified, routes validated live, and a clean commit.
- Platform architecture takes priority over feature velocity.

---

## Closed Packages

### Package: platform-foundation-findings-actions-posture

**Status:** Pending validation and commit close

**What it delivers:**
- Findings expanded from assessment-scoped to platform-scoped (organization_id, source_type, domain, priority)
- Actions as first-class platform primitive (org-scoped, owned, status-tracked, due-dated)
- Posture Snapshots + Domain Scores (one per org per day, computed from findings + actions)
- Posture computation reuses DomainRiskAggregationEngineV2 + OverallRiskAggregationEngineV2
- Assessment runner updated to populate new platform-level finding fields

**Migration:** `db/migrations/20260410_platform_primitives.sql`

**Routes delivered:**
- `GET /api/findings` — list, filter, paginate
- `PATCH /api/findings/:id` — update status/priority/owner
- `POST /api/actions` — create action
- `GET /api/actions` — list, filter, overdue flag
- `PATCH /api/actions/:id` — update status/priority/owner/due_date
- `POST /api/posture/snapshot` — compute and persist snapshot
- `GET /api/posture/latest` — latest snapshot with domain scores
- `GET /api/posture/history` — trend snapshots (default 90d, max 180d)

**Done conditions:**
- Migration applied and verified in live DB
- All routes return correct responses with a real API key
- Cross-org protection confirmed (org A cannot read org B data)
- Entitlement check confirmed (unauthenticated request returns 401/403)
- Clean git commit on main

---

## Closed Packages (continued)

### Package: org-profile-context-weighting

**Status:** Pending validation and commit close

**Depends on:** platform-foundation-findings-actions-posture (closed)

**What it delivers:**
- Add `regulated`, `handles_pii`, `safety_critical`, `scale` columns to organizations table
- Wire those fields into posture computation (remove neutral multiplier)
- Admin PATCH route extended to update org profile fields with boolean validation
- Admin GET routes include new profile fields in response
- `computePosture` accepts `OrgContext` parameter — scores now reflect actual org context
- Posture snapshot `computation_rationale` now includes `context_applied` instead of a limitation note
- `FALLBACK_CONTEXT` exported for emergency use with required warning log

**Migration:** `db/migrations/20260411_org_profile_context_weighting.sql`

**Done conditions:**
- Migration applied and verified in live DB
- `PATCH /admin/organizations/:id` accepts and persists all four profile fields
- `POST /api/posture/snapshot` reads org profile and passes real context to engine
- `computationRationale.context_applied` in snapshot response reflects actual org values
- Regulated org produces higher posture score than non-regulated with identical findings (live test)
- Boolean field rejection: `regulated: "yes"` returns 400
- Invalid scale rejection: `scale: "Huge"` returns 400
- Clean git commit on main

---

## Closed Packages (continued)

### Package: vendor-risk-primitives

**Status:** Pending validation and commit close

**Depends on:** org-profile-context-weighting (closed)

**What it delivers:**
- vendors table extended (additive migration 20260412_vendor_risk_primitives.sql):
  service_description, data_sensitivity, access_level, website, status columns added;
  criticality/data_sensitivity/access_level/status CHECK constraints added;
  org_status, org_criticality, owner indexes added
- Vendor CRUD API: POST /api/vendors, GET /api/vendors, GET /api/vendors/:id, PATCH /api/vendors/:id
- Default GET list returns active vendors only; pass ?status=archived for archived
- Soft archive via PATCH status=archived; no hard delete route (assessments hold vendor_id FK)
- vendor → finding linkage: convention established — findings.source_type='vendor_review' + findings.source_id=vendors.id
- vendor → action linkage: action chain from vendor → finding → action is traversable via existing actions API
- current_risk_score and framework_coverage preserved in DB but not exposed in new routes
- 44 unit tests for vendorValidation.ts (pure, no DB)
- TypeScript clean — zero compiler errors

**Migration:** `db/migrations/20260412_vendor_risk_primitives.sql`

**Routes delivered:**
- `POST /api/vendors` — create vendor (org-scoped, 409 on duplicate name within org)
- `GET /api/vendors` — list, filter by status/criticality, cursor paginate (default: active only)
- `GET /api/vendors/:id` — get single vendor (404 if wrong org)
- `PATCH /api/vendors/:id` — update fields, supports status=archived for soft delete

**Done conditions:**
- Migration applied and verified in live DB
- All routes return correct responses with a real API key
- Cross-org protection confirmed (org A cannot read org B vendors)
- Entitlement check confirmed (unauthenticated request returns 401/403)
- Clean git commit on main

---

---

## Closed Packages (continued)

### Package: vendor-assessment-workflow

**Status:** Pending validation and commit close

**Depends on:** vendor-risk-primitives (closed)

**What it delivers:**
- `vendor_assessments` table: org-scoped, vendor-scoped, structured assessment record
- `POST /api/vendor-assessments`: creates assessment + finding atomically; rejects archived vendors
- `GET /api/vendor-assessments`: list with cursor pagination, optional vendor_id filter
- `GET /api/vendor-assessments/:id`: returns assessment + exact finding produced by it
- `GET /api/findings` extended with `source_id` filter (filters by source record UUID)
- finding linkage: `source_type='vendor_review'`, `source_id=vendor_assessments.id` (NOT vendor_id)
- `domain='Vendor Risk'` hardcoded on findings — flows into DomainRiskAggregationEngineV2 on next posture snapshot
- Archived vendor rejection: `WHERE status='active' FOR UPDATE` inside transaction
- 36 unit tests for `vendorAssessmentValidation.ts` — all pass
- TypeScript clean — zero compiler errors

**Migration:** `db/migrations/20260413_vendor_assessment_workflow.sql`

**Routes delivered:**
- `POST /api/vendor-assessments` — create assessment + finding (transactional)
- `GET /api/vendor-assessments` — list, filter by vendor_id, cursor paginate
- `GET /api/vendor-assessments/:id` — get assessment with exact finding
- `GET /api/findings` — extended: `?source_id=<uuid>` filters by source record ID

**Done conditions:**
- Migration applied and verified in live DB
- All routes return correct responses with a real API key
- Cross-org protection confirmed (org A cannot read org B vendor assessments)
- Entitlement check confirmed (unauthenticated request returns 401/403)
- Archived vendor rejection confirmed: PATCH vendor to archived, then POST assessment returns 404
- `GET /api/vendor-assessments/:id` confirms finding.source_id equals assessment.id
- Cross-org test uses a real active vendor from org B (not a zero UUID)
- Clean git commit on main

---

## Closed Packages (continued)

### Package: posture-dashboard-foundation

**Status:** Closed — commit 9515d54e

**Depends on:** control-assessment-workflow (closed), vendor-risk-primitives (closed), control-framework-primitives (closed)

**Locked product decisions:**
1. Single endpoint only — no multiple routes, no new DB migration
2. Heatmap Entry out of scope
3. Route namespace: `/api/dashboard/`

**What it delivers:**
- `GET /api/dashboard/summary` — single read-only endpoint returning cross-domain posture summary
- Current posture state: `overall_score`, `overall_severity`, `snapshot_date` from most recent posture_snapshot (null if no snapshot — 200 returned, not 404)
- Domain-level breakdown from domain_scores for that snapshot, ordered severity descending
- Open finding counts: total and by_severity (all four canonical keys always present; missing severities = 0)
- Action counts: open and overdue
- Object inventory counts: vendors, ai_systems, controls, control_assessments, governance_reviews
- 12 unit tests for `buildFindingsBySeverity` — all pass
- TypeScript clean — zero compiler errors

**Migration:** None — reads from existing tables only

**Routes delivered:**
- `GET /api/dashboard/summary`

**What it explicitly does not deliver:**
- Heatmap Entry
- Any new DB migration or new table
- Additional endpoints beyond the single summary route

---

## Future Package Queue (in dependency order)

### Package: ai-system-governance-primitives
Depends on: vendor-risk-primitives (can run in parallel)

Delivers: ai_systems table, governance_reviews table, AI → finding linkage.

### Package: control-framework-primitives
Depends on: org-profile-context-weighting

Delivers: frameworks, requirements, controls, control_mappings tables.
Does not deliver: evidence or assessment workflow (next package after this one).

### Package: intelligence-brief-platform-integration
Depends on: posture-dashboard-foundation

Delivers: Brief assembly reads from findings, actions, and posture snapshots.
Brief becomes an output of the platform, not a standalone artifact.

---

## What Must Never Happen

- Building dashboard UI before posture snapshots exist — already fixed
- Building vendor risk UI before vendor domain objects exist — not started
- Building AI governance UI before AI system objects exist — not started
- Adding assessment templates before controls and frameworks exist — not started
- Treating the Intelligence Brief as the platform core — ongoing guard

---

## Package Close Checklist (required for all packages)

- [ ] Migration pre-check SQL run and passed
- [ ] Migration applied via `npm run migrate`
- [ ] Post-migration SQL verification run
- [ ] All new routes validated live with real API key
- [ ] Cross-org protection test passed
- [ ] Entitlement gate test passed
- [ ] Unit tests pass (if applicable)
- [ ] Clean git commit on main with package-scoped files only
- [ ] CANONICAL_RISK_MODEL.md updated with new objects/status
- [ ] This document updated with package marked closed
