# Enterprise Asset Registry — P6–P11 Roadmap (design memo)

Status: **RATIFIED by Simmee ruling 2026-07-06** (scope expansion recorded in
`docs/validation/enterprise-asset-registry-tracker.md`, Reconciliation notes).
That ruling approved "the Enterprise Asset Registry roadmap P0–P11" with P0–P5
mapping to ARCHITECTURE.md §4 Phases 0–5 (shipped: PRs #496–#503) and directed
that P6–P11 be defined by design memo before implementation, with
engineering/architecture decisions taken autonomously where they preserve the
governing principles. **This memo is that definition.**

Governing invariants (unchanged, non-negotiable): everything dark behind
`SECURELOGIC_ASSET_REGISTRY_ENABLED` / `SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED`
(default off), additive-only migrations, backward compatibility structural,
branch off `origin/develop` → PR → CI 8/8 → squash-merge, tenant scoping +
inert RLS + `dataClassification` on every new table, **no production
enablement (GATE B)**.

---

## Where P6–P11 come from

Phases 0–5 shipped the registry spine, generalized chokepoints, native types,
connector activation, the unified UI surface, and output rollups. What remains
is exactly the set of deferrals those phases recorded plus the three adjacent
tracks ARCHITECTURE.md §4 named but excluded from the core path:

| Source | Deferred item |
|---|---|
| Phase 3a scope notes | no update/delete for detail-backed types (v1 create/read); no `/assets/[id]` UI detail page |
| Phase 3b scope notes | connector **relationship** persistence (CSV-import parity was v1) |
| Phase 5 scope notes | optional Brief ↔ asset-applicability convergence |
| §4 Track A | finish `asTenant` adoption on vendors/aiSystems/controls/obligations/actions + unwrapped assessment routes |
| §4 Track B | generic asset-assessment service collapsing the 5 bespoke stacks |
| §4 Track C | gating unification — core domain routes from `requireEntitlement("premium")` to per-org `requireCapability` |

## The sequence

Ordered by (1) closing gaps in what already shipped before opening new
surface, (2) hardening before expansion, (3) the riskiest/most product-shaped
work last, behind explicit gates.

### P6 — Asset lifecycle completeness (closes the 3a gap)
- `PATCH /api/assets/:id` + `DELETE /api/assets/:id` for the four
  detail-backed types only (per-type routes stay authoritative for the rest —
  EAR-AD-1). Update = validated typed/header fields; delete = detail row +
  registry row in one tx (`deregisterAsset` semantics; FK SET NULL already
  protects links).
- `/assets/[id]` app detail page (header + typed detail via the Phase-3a
  GET), closing Phase 4's unlinked-row v1 note.
- Exit: detail-backed round-trip create→update→read→delete; suggestions/
  assessments referencing a deleted asset keep `(target_type,target_id)` and
  null `asset_id` (EAR-AD-3 compat proven in isolation tests).

### P7 — Connector relationship persistence (closes the 3b gap)
- Map `NormalizedRelationship` (external_ref-keyed) → `enterprise_relationships`
  edges in the sync worker: resolve both endpoints by `(org, external_ref)`
  across enterprise_entities + detail tables; skip unresolvable pairs loudly
  (counted in the sync summary); map connector vocabulary onto the ECL +
  EAR-AD-4 relationship types; respect the existing edge cap + dedup
  (unique index) — no new tables, no vocabulary growth expected.
- Exit: a ServiceNow CMDB mock sync produces entities AND edges; re-sync is
  edge-idempotent; graph resolver traverses connector-created edges.

### P8 — Track A: tenant-isolation hardening (asTenant adoption)
- Wrap vendors / aiSystems / controls / obligations / actions + the unwrapped
  assessment routes in `asTenant` (verified 2026-07-06: none of the five have
  it today). Behavior-identical (explicit org predicates remain the primary
  control); this arms RLS as defense-in-depth on the tenant channel.
- Sequenced BEFORE new write surface (P9–P10) so everything later lands on the
  hardened channel. Exit: tenant-coverage census shows the wrapped routes;
  cross-org isolation suite green; zero response-shape changes.

### P9 — Track C: gating unification (dual-gate, strictly additive)
- **Decision (autonomous, preserves compat):** core domain routes move to
  `requireEntitlement("premium") OR requireCapability(<capability>)` —
  a DUAL gate behind a new flag, so every org authorized today stays
  authorized byte-for-byte, and per-org capabilities (the ECL-proven model)
  become grantable without entitlement-tier coupling.
- **Explicit STOP GATE:** actually *removing* the entitlement leg (the real
  cutover) changes commercial semantics → product-vision decision reserved
  for Simmee; P9 ships only the additive dual-gate + capability plumbing.
- Exit: with the flag off, gating is byte-identical; with it on, a capability
  grant admits an org the entitlement would have rejected (staging-testable).

### P10 — Track B: generic asset-assessment service (own epic, own memo)
- Collapse the 5 bespoke assessment stacks behind one spec-driven assessment
  engine keyed on `AssetTypeSpec` (the Phase-2 pattern applied to
  assessments). **Requires its own design memo before implementation**
  (stack inventory, migration strategy per stack, WORM/evidence semantics) —
  the memo is the first P10 deliverable, not this document.
- Exit (memo-refined): one new asset type gains an assessment path with zero
  new tables; existing assessment behavior unchanged.

### P11 — Output convergence & enablement readiness
- Brief ↔ asset applicability citation (the Phase-5 optional item): Brief
  items MAY cite the org's applicability decisions — platform data flowing
  INTO the Brief (correct direction; never Brief-shaped platform work).
- Registry enablement runbook: consolidated operator checklist (backfill
  script, flag order, staging validation queries, rollback per phase) —
  documentation only; **no enablement, GATE B untouched**.
- Final EAR implementation report; goal close.

## Stop conditions (restated from the ruling)

Stop only for: product-vision decisions (P9 cutover is pre-declared as one),
destructive migrations (none planned — all phases additive), backward-compat
breaks (none planned), operator/production actions (P11 documents, never
executes), true BLOCKED-ON-SIMMEE.
