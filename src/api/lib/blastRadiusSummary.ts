/**
 * blastRadiusSummary.ts — ERIP Epic 7 (Knowledge Graph): PURE summary over a
 * resolved graph neighbourhood (ERIP-AD-28). No I/O. Given the resolver's nodes
 * + edges, compute the blast-radius shape: total reachable nodes (excluding the
 * root), counts by node type, the maximum depth reached, and the deepest
 * dependency path length. Deterministic.
 */

export interface GraphNodeLike {
  node_type: string;
  node_id: string;
  depth: number;
}
export interface GraphEdgeLike {
  from_type: string;
  from_id: string;
  to_type: string;
  to_id: string;
}

export interface BlastRadiusSummary {
  /** Reachable nodes excluding the root (depth 0). */
  reachable_count: number;
  /** Reachable node count by node_type (root excluded). */
  by_type: Record<string, number>;
  /** Deepest hop reached from the root. */
  max_depth: number;
  /** Total edges within the neighbourhood. */
  edge_count: number;
}

/**
 * Summarize the neighbourhood. `nodes` includes the root at depth 0 (excluded
 * from the reachable counts). Deterministic; by_type keys sorted on emit.
 */
export function summarizeBlastRadius(
  nodes: readonly GraphNodeLike[],
  edges: readonly GraphEdgeLike[]
): BlastRadiusSummary {
  const byType: Record<string, number> = {};
  let maxDepth = 0;
  let reachable = 0;
  for (const n of nodes) {
    if (n.depth > maxDepth) maxDepth = n.depth;
    if (n.depth <= 0) continue; // the root is not part of its own blast radius
    reachable += 1;
    byType[n.node_type] = (byType[n.node_type] ?? 0) + 1;
  }
  // Re-emit by_type with sorted keys for a stable payload.
  const by_type: Record<string, number> = {};
  for (const k of Object.keys(byType).sort()) by_type[k] = byType[k]!;

  return { reachable_count: reachable, by_type, max_depth: maxDepth, edge_count: edges.length };
}
