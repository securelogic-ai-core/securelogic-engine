/**
 * assetOwnRisk.ts — ERIP Epic 3 (E3.P1): derive each graph node's OWN-risk seed
 * from existing canonical signals (ERIP-AD-16). No new risk store is invented —
 * the seed is read from the org's CURRENT applicability decisions (the WORM
 * latest-wins pattern, the P11 briefApplicabilityCitations shape).
 *
 * Runs on the tenant `pg` proxy (asTenant route) with an explicit org predicate.
 */

import { pg } from "../infra/postgres.js";

/** applicability decision → base own-risk [0–100]. Unknown/absent → 0. */
const DECISION_RISK: Record<string, number> = {
  affected: 90,
  potentially_affected: 60,
  needs_review: 40,
  not_affected: 0,
  unknown: 0
};

/** Graph node key. */
export interface NodeKey {
  node_type: string;
  node_id: string;
}

/**
 * For each (target_type, target_id) among the given nodes, the org's CURRENT
 * applicability decision drives own-risk, scaled by the decision's confidence
 * (0–100). Latest-wins per target via DISTINCT ON … seq DESC over the WORM
 * ledger. Nodes with no decision map to 0. Returned keyed by "type:id".
 *
 * Graph node types map to applicability target types directly for vendor /
 * ai_system; `asset`-typed registry nodes resolve via the assessments'
 * `asset_id` pointer (Phase-2 compat column).
 */
export interface GraphQueryable {
  query<T = any>(text: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }>;
}

/** `db` defaults to the tenant-aware `pg` proxy — existing callers are unchanged. */
export async function ownRiskForNodes(orgId: string, nodes: readonly NodeKey[], db: GraphQueryable = pg): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const n of nodes) out.set(`${n.node_type}:${n.node_id}`, 0);
  if (nodes.length === 0) return out;

  const ids = [...new Set(nodes.map((n) => n.node_id))];

  // Current decision per (target_type, target_id) AND per asset_id, so both the
  // typed-target nodes (vendor/ai_system) and the Tier-0 `asset` nodes resolve.
  const { rows } = await db.query<{
    target_type: string;
    target_id: string | null;
    asset_id: string | null;
    decision: string;
    confidence: number;
  }>(
    `SELECT DISTINCT ON (target_type, target_id, asset_id)
            target_type, target_id, asset_id, decision, confidence
       FROM applicability_assessments
      WHERE organization_id = $1
        AND (target_id = ANY($2::uuid[]) OR asset_id = ANY($2::uuid[]))
      ORDER BY target_type, target_id, asset_id, seq DESC`,
    [orgId, ids]
  );

  for (const r of rows) {
    const base = DECISION_RISK[r.decision] ?? 0;
    if (base <= 0) continue;
    const conf = Math.max(0, Math.min(100, r.confidence)) / 100;
    const risk = Math.round(base * conf);
    // A node matches by its typed target id OR by the Tier-0 asset id.
    for (const key of [
      r.target_id ? `${r.target_type}:${r.target_id}` : null,
      r.asset_id ? `asset:${r.asset_id}` : null
    ]) {
      if (key && out.has(key)) out.set(key, Math.max(out.get(key) ?? 0, risk));
    }
  }
  return out;
}
