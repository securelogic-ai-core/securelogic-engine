# ERIP Epic 4 — Executive Intelligence (design memo)

Status: RATIFIED (ERIP autonomous-decision authority).
Roadmap: `enterprise-risk-intelligence-platform.md` §4 Epic 4.
Foundation reused: Epic-3 dimensional risk rollup, `asset_registry_v`, posture
snapshots, the exec dashboard + R6 stats endpoint. Additive, dark.

## Decisions (ERIP-AD-19 …)

> **ERIP-AD-19 — Executive surfaces COMPOSE canonical objects; they never store
> or redefine truth (CANONICAL_DOMAIN_MODEL "outputs consume, not define").**
> The executive summary is a pure composition of the risk rollup + the latest
> posture snapshot + registry inventory. It introduces no new stored metric.

> **ERIP-AD-20 — Only honestly-available views ship.** A risk heatmap
> (asset_type × band) and a board-ready summary compose from data that exists
> now. Time-series TRENDS require persisted risk history (E3.P3, deferred) and
> are therefore explicitly deferred — a dark surface must not fabricate a trend
> line it cannot source.

## Phases

### E4.P1 — executive risk summary + heatmap (this epic's core)
- `executiveRiskSummary.ts` (PURE): compose the dimensional risk rollup + a
  posture snapshot into a board-ready payload:
  - headline: overall risk band, total/at-risk asset counts, top risk dimensions.
  - heatmap: per-asset_type band matrix (Critical/High/Moderate/Low/None).
  - posture: the org's latest overall posture score + domain breakdown (as-is).
- `GET /api/executive/risk-summary` (risk-intel flag + registry chain): gather
  the dimensional risk (Epic-3 query) + latest posture snapshot, compose, return.
- No migration; read-only.

### Deferred (by ruling, recorded in the tracker)
- Time-series trends + board-report generation (need persisted risk history,
  E3.P3) — deferred, not fabricated.
- Executive UI surfaces (the dark API is the platform deliverable; UI is a
  presentation-layer follow-up, the ECL/EAR pattern).

## Exit
An executive can retrieve, from one dark API, the enterprise risk posture across
asset dimensions with a band heatmap and posture context — every number traceable
to canonical objects (applicability decisions, posture snapshots, the registry).
