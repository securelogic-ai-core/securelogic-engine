# Enterprise Asset Registry — Goal Tracker

Living tracker for the Enterprise Asset Registry workstream (design authority:
`docs/architecture/enterprise-asset-registry/ARCHITECTURE.md`). Successor workstream to the
completed Enterprise Context goal (`enterprise-context-goal-tracker.md`); same governing
invariants: everything DARK behind flags (default off, additive-only), branch off
`origin/develop`, squash-merge + delete branch, tenant scoping + inert RLS +
`dataClassification` on every new table, prod enablement out of scope (GATE B).

Last updated: 2026-07-05 (session-resume reconciliation).

## Reconciliation notes (2026-07-05 resume)

- **Verified remote truth:** `origin/develop` tip = `592d9c60` (base ARCHITECTURE.md, Phases 0–5).
  No EAR feature branches on origin; no open EAR PRs; local `develop` in sync (0/0). All EAR
  code beyond that commit exists ONLY in the local working tree (Item 0, uncommitted).
- **Governance note:** `592d9c60` was pushed directly to `develop` without a PR (deviation from
  the squash-merge-via-PR convention; docs-only, recorded, not repeated).
- **EAR-AD-4 ruling record:** initially flagged GATE-VIOLATION-REVIEW (no ruling artifact in
  repo). **RESOLVED — Simmee ruling 2026-07-05:** authorized "Item 0 repair plan exactly as
  scoped" (commit → PR → CI → squash-merge), which ratifies EAR-AD-4 / Option 1. This entry is
  the ruling artifact.
- **Roadmap authority — Simmee ruling 2026-07-05:** governing scope is the **ratified repo plan**
  (option a): Item 0 → Phases 0–5 per ARCHITECTURE.md §4. Tracks A/B/C are adjacent/optional and
  must not block the core path. Anything beyond Phases 0–5: design/options memos only, stop at
  gates before building. Everything stays dark (`SECURELOGIC_ASSET_REGISTRY_ENABLED` default
  off); no production enablement; GATE B untouched.

## Ratified decisions

| ID | Decision | Rationale | Where |
|---|---|---|---|
| EAR-AD-1 | Federate, do not subsume | Registry references detail tables; preserves ECL AD-1/AD-13 | ARCHITECTURE.md §0 |
| EAR-AD-2 | Registry is identity-only; header is a view | Zero attribute duplication → no drift | ARCHITECTURE.md §2.1 |
| EAR-AD-3 | `asset_id` canonical join key; `(type,id)` stays for compat | Additive, quartet enums stop growing | ARCHITECTURE.md §2.1 |
| EAR-AD-4 | Asset/infrastructure edges live in `enterprise_relationships` (**Option 1**); NO new `enterprise_asset_relationships` table | A second edge table would split the graph, force a second resolver UNION arm + duplicate RLS/cap/audit surface, and contradict §3.1 (edge substrate = REUSE). ECL AD-3 makes new relationship kinds enum growth, not new tables. Resolver + AD-13 typed-edge union are vocabulary-agnostic → reused with zero changes. | ARCHITECTURE.md §2.4 |

## Item table

| # | Item | Status | Evidence | Flag / dark posture |
|---|---|---|---|---|
| 0 | EAR-AD-4 graph substrate expansion — widen `enterprise_relationships` endpoint CHECKs (+`asset`, schema-dark at route until Phase 1) and `relationship_type` (+`hosted_on`, `connects_to`, `stores_data_in`, `authenticates_via`, `exposed_via`, `managed_by`, live). Additive migration only; ECL context edges unchanged; RLS/unique-index/self-edge CHECK/edge cap/dataClassification untouched. Tests: unit (validator old+new vocab, `asset` rejected at route) + isolation (CHECKs old+new, RLS WITH CHECK on new vocab, resolver traversal over `asset`/infra edges). | **BUILT — pending review/commit** | `db/migrations/20260801_enterprise_relationships_asset_expansion.sql`; `enterpriseRelationshipValidation.ts`; `app/src/lib/enterpriseContext.ts`; `enterpriseRelationships.test.ts`; `enterpriseRelationshipsRls.test.ts`. **Resume-verified 2026-07-05:** working-tree diffs coherent + complete (migration, validator, app mirror, unit + isolation tests, ARCHITECTURE.md §2.4); unit tests 8/8 green locally; isolation tests CI-only (`TEST_DATABASE_URL`). Gate review RESOLVED by Simmee ruling 2026-07-05 (see Reconciliation notes). **DONE — PR #496, squash `fa5444c0`, branch deleted** | New relationship types reachable only via ECL routes (`SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED`, off); `asset` endpoint additionally route-dark until registry Phase 1 |
| 1 | Phase 0 — contract + `asset_registry_v` view + flag-gated `GET /api/assets` | IN PR | `20260802_asset_registry_view.sql` (first SQL VIEW in db/migrations — security_invoker guarded PG≥15 + app_request read grants); `assetRegistry.ts` (AssetType/AssetRef/CanonicalAsset/AssetTypeSpec truth table); `assetRegistryFeatureFlag.ts`; `routes/assets.ts` (GET /api/assets — flag→auth→org→capability→asTenant, mandatory org predicate); render.yaml flag ×4 engine blocks; unit (contract lockstep + handlers) + isolation (`assetRegistryView.test.ts`) | `SECURELOGIC_ASSET_REGISTRY_ENABLED` (declared "false"; default off). Reuses per-org `enterprise_context` capability — one commercial boundary, no second gating vocabulary |
| 2 | Phase 1 — `assets` spine + `asset_id` columns + `registerAsset()` + backfill; flip `asset` node type live at the route layer (`NODE_TYPES` + `NODE_TYPE_TABLE`) | NOT STARTED | — | same |
| 3 | Phase 2 — generalize `GRAPH_REPRESENTABLE` + matcher via asset-type spec | NOT STARTED | — | same |
| 4 | Phase 3 — new asset types + connector sync route/worker | NOT STARTED | — | same |
| 5 | Phase 4 — UI consolidation | NOT STARTED | — | same |
| 6 | Phase 5 — output completeness | NOT STARTED | — | same |
