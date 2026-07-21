# ERIP Epic 7 — Enterprise Knowledge Graph / Digital Twin (design memo)

Status: RATIFIED (ERIP autonomous-decision authority).
Roadmap: `enterprise-risk-intelligence-platform.md` §4 Epic 7.
Foundation reused: `enterprise_relationships` + the bounded recursive resolver
(EAR-AD-4 one substrate; AD-13 typed-edge union), the registry + backing tables
for node labels. Additive, dark.

## Decisions (ERIP-AD-28 …)

> **ERIP-AD-28 — ONE graph substrate; the knowledge graph is a read-time
> PROJECTION, not a new store (EAR-AD-4).** Blast-radius / dependency analysis
> runs over the existing resolver's org-scoped neighbourhood. No new edge table,
> no materialized graph copy in this phase — the resolver + typed-edge union is
> the graph.

> **ERIP-AD-29 — Nodes are LABELLED read-side from their canonical home.** Each
> node (type,id) resolves its human label + kind from its authoritative table
> (asset_registry_v / vendors / ai_systems / enterprise_entities / users),
> batched per type, org-scoped. The graph never copies names (no drift).

> **ERIP-AD-30 — Natural-language question answering is DEFERRED behind its own
> safety gate.** NL over the graph is an LLM + prompt-injection surface; it
> requires a dedicated safety model (org-scoped retrieval, injection hardening,
> cited graph paths) and is NOT built in this phase. The structured
> blast-radius/dependency API is the platform deliverable; NL is a later,
> explicitly-gated capability. A dark surface must not ship an unhardened
> LLM query path.

## Phases

### E7.P1 — labelled blast-radius / dependency graph (this epic's core)
- `blastRadiusSummary.ts` (PURE): from the resolver's nodes+edges, compute a
  summary — total node count, counts by node_type, max depth reached, and the
  deepest dependency path length. Deterministic; unit-tested.
- `graphLabeling.ts` (batched, tenant-scoped): resolve {type,id} → {label,kind}
  from the canonical home tables (ERIP-AD-29), one query per node type.
- `GET /api/graph/blast-radius/:assetId?depth=N` (new flag
  `SECURELOGIC_KNOWLEDGE_GRAPH_ENABLED` + registry chain): map the asset to its
  graph node (EAR-AD-4), resolve the outbound neighbourhood, label every node,
  return { root, nodes:[{node_type,node_id,label,depth}], edges, summary }.
- Read-only; no migration.

### Deferred (by ruling, tracker)
- Federating signals/risks/findings/evidence/controls/regulations/processes as
  first-class graph nodes (read-time union extensions) — as their edge sources
  are wired.
- Natural-language question answering (ERIP-AD-30 safety gate).
- Business-impact scoring over the graph (reuses Epic-3 propagation; a
  convergence follow-up).

## Exit
"What is the blast radius of a compromise of asset X?" is answerable dark via a
structured, labelled, org-scoped dependency graph with a summary — every node
traceable to its canonical home, over the single existing graph substrate.
