/**
 * enterpriseGraphResolver.ts — ECL Slice 2b: read-time graph traversal.
 *
 * Returns the outbound neighbourhood of a node within an organization, up to a
 * bounded depth, over a UNIFIED edge view that combines:
 *   - the generic enterprise_relationships edges (Slice 2), AND
 *   - the existing TYPED ai_system_vendor_dependencies edges (ai_system -> vendor).
 * This is the AD-13 "resolver UNIONs typed edges, never replaces them" pattern, in
 * its first, deliberately-small form. Other typed edges (dependencies, signal_*_links
 * whose endpoints can be a GLOBAL org-NULL cyber_signal, risk_*_links) are a
 * documented later extension — signal edges need the global-signal special-case.
 *
 * SAFETY (correctness proven by test/isolation/enterpriseGraphResolverRls.test.ts):
 *   - Every edge in the unified view is filtered `organization_id = $org`, so the
 *     traversal only ever follows THIS org's edges → org-isolated by construction.
 *   - Bounded: the recursive term stops at `depth < $maxDepth`.
 *   - Cycle-safe: a per-path visited-set (ARRAY of 'type:id' keys) prevents revisiting
 *     a node on the same path, so cyclic graphs terminate.
 *   - The seed node's same-org membership is verified by the ROUTE before calling this.
 *
 * PERFORMANCE (operator-owned, per review finding AR-4): the recursive CTE is NOT yet
 * load-tested at Fortune-500 fan-out. The bound (MAX_DEPTH) keeps it safe for the
 * manual-entry scale of Slice 1/2. If a measured hot workload needs deep/high-fanout
 * traversal at interactive latency, the designed fallback is a maintained
 * materialized adjacency/closure table refreshed on edge mutation (AD-13). Do not
 * raise MAX_DEPTH without that load test.
 */

import { pg } from "../infra/postgres.js";

export const DEFAULT_DEPTH = 3;
export const MAX_DEPTH = 5;

export interface GraphNode {
  node_type: string;
  node_id: string;
  depth: number;
}
export interface GraphEdge {
  from_type: string;
  from_id: string;
  to_type: string;
  to_id: string;
  relationship_type: string;
  source: string;
}
export interface GraphNeighborhood {
  root: { node_type: string; node_id: string };
  depth: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// The unified, org-scoped edge view. $1 = organization_id. Shared by both queries.
const UNIFIED_EDGES = `
  unified_edges AS (
    SELECT from_type, from_id, to_type, to_id, relationship_type,
           'enterprise_relationship'::text AS source
      FROM enterprise_relationships
     WHERE organization_id = $1 AND deleted_at IS NULL
    UNION ALL
    SELECT 'ai_system'::text, ai_system_id, 'vendor'::text, vendor_id,
           dependency_role, 'ai_system_vendor_dependency'::text
      FROM ai_system_vendor_dependencies
     WHERE organization_id = $1 AND deleted_at IS NULL
  )
`;

// Bounded, cycle-safe outbound traversal. $2 = seed node_type, $3 = seed node_id,
// $4 = max depth.
const REACHABLE = `
  reachable AS (
    SELECT $2::text AS node_type, $3::uuid AS node_id, 0 AS depth,
           ARRAY[$2 || ':' || ($3::uuid)::text] AS visited
    UNION ALL
    SELECT e.to_type, e.to_id, r.depth + 1,
           r.visited || (e.to_type || ':' || (e.to_id)::text)
      FROM reachable r
      JOIN unified_edges e
        ON e.from_type = r.node_type AND e.from_id = r.node_id
     WHERE r.depth < $4
       AND NOT ((e.to_type || ':' || (e.to_id)::text) = ANY (r.visited))
  )
`;

/**
 * Resolve the outbound neighbourhood of (nodeType, nodeId) in `organizationId` to
 * `depth` hops. Runs inside the caller's tenant transaction (asTenant). `depth` is
 * clamped to MAX_DEPTH by the caller; this defends again.
 */
export async function resolveNeighborhood(
  organizationId: string,
  nodeType: string,
  nodeId: string,
  depth: number
): Promise<GraphNeighborhood> {
  const d = Math.max(0, Math.min(depth, MAX_DEPTH));

  const nodesResult = await pg.query<GraphNode>(
    `WITH RECURSIVE ${UNIFIED_EDGES}, ${REACHABLE}
     SELECT node_type, node_id, MIN(depth)::int AS depth
       FROM reachable
      GROUP BY node_type, node_id
      ORDER BY depth ASC, node_type ASC, node_id ASC`,
    [organizationId, nodeType, nodeId, d]
  );

  const edgesResult = await pg.query<GraphEdge>(
    `WITH RECURSIVE ${UNIFIED_EDGES}, ${REACHABLE},
       nodeset AS (SELECT DISTINCT node_type, node_id FROM reachable)
     SELECT DISTINCT e.from_type, e.from_id, e.to_type, e.to_id,
            e.relationship_type, e.source
       FROM unified_edges e
       JOIN nodeset a ON a.node_type = e.from_type AND a.node_id = e.from_id
       JOIN nodeset b ON b.node_type = e.to_type   AND b.node_id = e.to_id`,
    [organizationId, nodeType, nodeId, d]
  );

  return {
    root: { node_type: nodeType, node_id: nodeId },
    depth: d,
    nodes: nodesResult.rows,
    edges: edgesResult.rows
  };
}
