# ERIP Epic 3 — Enterprise Risk Intelligence (design memo, E3.P0)

Status: RATIFIED (ERIP autonomous-decision authority; preserves governing invariants).
Roadmap: `docs/architecture/enterprise-risk-intelligence-platform.md` §4 Epic 3.
Foundation reused: the applicability engine + WORM decision ledger
(`applicability_assessments`), the bounded graph resolver
(`enterpriseGraphResolver.ts`), the reassessment worker, the inert S6/S7 pure
cores, `risk_scoring_weights`, the posture engine, and `findings`/`actions`/`risks`.
Everything below is ADDITIVE and DARK; nothing existing changes while flags are off.

---

## Decisions (ERIP-AD-15 …)

> **ERIP-AD-15 — Risk propagation is a PURE, read-derived engine, not a new
> stored truth.** Direct/dependency/inherited risk is computed on read from
> (a) each node's own-risk seed and (b) the org's relationship graph. It does
> NOT introduce a new canonical risk store that could drift from findings/risks/
> applicability. Persisted rollups (E3.P3) are derived snapshots, clearly
> labelled as such and recomputable — never a source of truth.

> **ERIP-AD-16 — Own-risk seeds come from EXISTING canonical signals.** A node's
> own risk is derived from its CURRENT applicability decisions (WORM latest-wins:
> DISTINCT ON (target_type,target_id) … seq DESC), mapped decision→score
> (affected→90, potentially_affected→60, needs_review→40, not_affected/unknown→0),
> scaled by confidence. Later phases may add finding-derived seeds; the seed
> function is one pure, swappable input. No new risk data is invented.

> **ERIP-AD-17 — Propagation follows the graph OUTBOUND from dependents to
> dependencies, and risk flows the OTHER way (inherited).** The resolver returns
> the outbound neighbourhood (what a node depends_on / runs_on / connects_to).
> A dependency's own risk is INHERITED by the nodes that depend on it, decayed
> per hop (× DEPENDENCY_DECAY, default 0.6). Every contribution carries a
> reasoning trace (source node, path length, decayed value) — explainability is
> mandatory (ERIP-AD, CLAUDE.md "explain every decision").

> **ERIP-AD-18 — Continuous correlation reuses the reassessment worker path, not
> a new pipeline.** Wiring the inert S7 signal-linkage core (E3.P2) enqueues
> applicability reassessment for assets a new signal touches — reusing the three
> existing matcher invocation paths and the reassessment worker. No parallel
> correlation loop.

## Phases

### E3.P1 — pure graph risk-propagation engine + read endpoint (this PR)
- `graphRiskPropagation.ts` (PURE): given nodes with own_risk [0–100] + graph
  edges, compute per node `direct_risk` (own), `inherited_risk` (max decayed
  contribution from reachable dependencies), `total_risk` (bounded combine), and
  ordered `contributors` traces. Deterministic; cycle-safe (the resolver already
  dedups); unit-tested.
- `assetOwnRisk.ts` (own-risk seed from current applicability decisions,
  ERIP-AD-16) — a small tenant-scoped reader.
- `GET /api/assets/:id/risk-propagation` (new flag + capability + asTenant):
  resolve the asset's outbound neighbourhood → seed own-risk per node → run the
  pure engine → return the seed asset's direct/inherited/total + per-node
  breakdown + contributor traces.
- Flag `SECURELOGIC_RISK_INTELLIGENCE_ENABLED` (default off ×4). No migration.

### E3.P2 — continuous correlation (wire S7) + auto-reassessment
- Wire the inert S7 signal-linkage/reassessment core so a newly-ingested signal
  that matches an asset enqueues applicability reassessment for the asset AND its
  dependents (graph-aware), via the existing reassessment worker. Double-fenced.

### E3.P3 — persisted risk rollups (derived snapshots)
- A `asset_risk_rollups` derived table (recomputable; ERIP-AD-15) written by a
  rollup pass; `GET /api/risk/rollups` dimensional read. Additive, dark.

### E3.P4 — dimensional reporting expansion
- Roll risk up by dimension (enterprise / business unit / application / vendor /
  AI / cloud / operations / supply chain) over `asset_registry_v` + rollups;
  additive keys on the stats/dashboard surfaces (the P5 pattern).

## Exit criteria (epic)
A new signal against a vendor propagates explainably through the graph to
dependent applications/AI systems; reassessments fire automatically (dark);
per-dimension risk rollups are queryable. Every risk number carries a trace to
the canonical decisions that produced it.
