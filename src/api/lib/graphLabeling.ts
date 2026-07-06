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
export async function labelNodes(orgId: string, nodes: readonly NodeKey[]): Promise<Map<string, string | null>> {
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
    const r = await pg.query<{ id: string; name: string | null }>(text, values);
    for (const row of r.rows) out.set(`${type}:${row.id}`, row.name ?? null);
  }
  return out;
}
