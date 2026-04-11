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

## Next Package

### Package: org-profile-context-weighting

**Depends on:** platform-foundation-findings-actions-posture (closed)

**What it delivers:**
- Add `regulated`, `handles_pii`, `safety_critical`, `scale` columns to organizations table
- Wire those fields into posture computation (remove neutral multiplier)
- Admin route to update org profile
- Posture snapshot computation_rationale reflects actual org context

**Why it is next:**
Posture computation currently runs with a neutral context multiplier (1.0).
The computation_rationale in every snapshot explicitly flags this as a limitation.
This package removes that limitation and makes posture scores org-aware.
It is a small, targeted schema + computation change with no new domain objects.

---

## Future Package Queue (in dependency order)

### Package: vendor-risk-primitives
Depends on: org-profile-context-weighting

Delivers: vendors table, vendor CRUD API, vendor → finding linkage, vendor → action linkage.
Does not deliver: vendor assessments (next package after this one).

### Package: vendor-assessment-workflow
Depends on: vendor-risk-primitives

Delivers: vendor_assessments table, assessment → findings flow for vendor source_type, vendor posture rollup.

### Package: ai-system-governance-primitives
Depends on: vendor-risk-primitives (can run in parallel)

Delivers: ai_systems table, governance_reviews table, AI → finding linkage.

### Package: control-framework-primitives
Depends on: org-profile-context-weighting

Delivers: frameworks, requirements, controls, control_mappings tables.
Does not deliver: evidence or assessment workflow (next package after this one).

### Package: posture-dashboard-foundation
Depends on: vendor-risk-primitives + control-framework-primitives

Delivers: dashboard API surface reading from posture_snapshots, domain_scores, findings, and actions.
This is the first package where a UI can be built on top of real structured data.

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
