/**
 * graphLabeling.ts — ERIP Epic 7 (Knowledge Graph): resolve graph node
 * (type, id) pairs to human labels from their CANONICAL home tables
 * (ERIP-AD-29 — labels read-side, never copied into the graph). Batched one
 * query per node type; tenant-scoped (runs inside the caller's asTenant tx with
 * an explicit org predicate). Unknown/unresolvable nodes get a null label.
 */

import { pg } from "../infra/postgres.js";

export interface NodeKey {
  node_type: string;
  node_id: string;
}
export interface NodeLabel {
  node_type: string;
  node_id: string;
  label: string | null;
}

/** node_type → the canonical table + label column to resolve it from. */
const LABEL_SOURCE: Record<string, { sql: (org: string, ids: string[]) => { text: string; values: unknown[] } }> = {
  asset: {
    sql: (org, ids) => ({
      text: `SELECT asset_id AS id, name FROM asset_registry_v WHERE organization_id = $1 AND asset_id = ANY($2::uuid[])`,
      values: [org, ids]
    })
  },
  vendor: {
    sql: (org, ids) => ({
      text: `SELECT id, name FROM vendors WHERE organization_id = $1 AND id = ANY($2::uuid[])`,
      values: [org, ids]
    })
  },
  ai_system: {
    sql: (org, ids) => ({
      text: `SELECT id, name FROM ai_systems WHERE organization_id = $1 AND id = ANY($2::uuid[])`,
      values: [org, ids]
    })
  },
  enterprise_entity: {
    sql: (org, ids) => ({
      text: `SELECT id, name FROM enterprise_entities WHERE organization_id = $1 AND id = ANY($2::uuid[])`,
      values: [org, ids]
    })
  },
  user: {
    sql: (org, ids) => ({
      text: `SELECT id, COALESCE(NULLIF(name, ''), email) AS name FROM users WHERE organization_id = $1 AND id = ANY($2::uuid[])`,
      values: [org, ids]
    })
  }
};

/** Resolve labels for a set of nodes, batched per type. Org-scoped. */
export interface GraphQueryable {
  query<T = any>(text: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }>;
}

/** `db` defaults to the tenant-aware `pg` proxy — existing callers are unchanged. */
export async function labelNodes(orgId: string, nodes: readonly NodeKey[], db: GraphQueryable = pg): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  for (const n of nodes) out.set(`${n.node_type}:${n.node_id}`, null);

  const byType = new Map<string, Set<string>>();
  for (const n of nodes) {
    if (!LABEL_SOURCE[n.node_type]) continue;
    const set = byType.get(n.node_type) ?? new Set<string>();
    set.add(n.node_id);
    byType.set(n.node_type, set);
  }

  for (const [type, idSet] of byType) {
    const source = LABEL_SOURCE[type]!;
    const { text, values } = source.sql(orgId, [...idSet]);
    const r = await db.query<{ id: string; name: string | null }>(text, values);
    for (const row of r.rows) out.set(`${type}:${row.id}`, row.name ?? null);
  }
  return out;
}

/**
 * Batched criticality per node from the federated asset registry view (keyed by BOTH
 * asset_id and backing_id, because callers hold either).
 *
 * Lifted here from knowledgeGraph.ts in C4 part 3: the finding-level enterprise context
 * needs the same lookup, and copying it would have duplicated a canonical read. One
 * definition, two callers.
 */
export async function criticalityForNodes(
  orgId: string,
  nodeIds: readonly string[],
  db: GraphQueryable = pg
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  if (nodeIds.length === 0) return out;
  const ids = [...new Set(nodeIds)];
  const r = await db.query<{ asset_id: string; backing_id: string; criticality: string | null }>(
    `SELECT asset_id, backing_id, criticality FROM asset_registry_v
      WHERE organization_id = $1 AND (asset_id = ANY($2::uuid[]) OR backing_id = ANY($2::uuid[]))`,
    [orgId, ids]
  );
  for (const row of r.rows) {
    out.set(row.asset_id, row.criticality);
    out.set(row.backing_id, row.criticality);
  }
  return out;
}
