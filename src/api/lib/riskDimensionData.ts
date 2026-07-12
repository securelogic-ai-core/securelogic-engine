/**
 * riskDimensionData.ts — ERIP: the tenant-scoped read that turns registry
 * assets + their current applicability decisions into per-asset own-risk rows
 * (ERIP-AD-16). Extracted so the risk-dimensions route, the executive summary,
 * and the F2 history snapshot worker share ONE query and one decision→score
 * mapping — no drift.
 */

import { pg } from "../infra/postgres.js";
import type { AssetRiskRow } from "./riskDimensionRollup.js";

/** applicability decision → base own-risk [0–100] (mirrors assetOwnRisk). */
export const DECISION_RISK: Record<string, number> = {
  affected: 90,
  potentially_affected: 60,
  needs_review: 40,
  not_affected: 0,
  unknown: 0
};

/**
 * The own-risk score, as SQL — BUILT FROM `DECISION_RISK` above, never hand-written.
 *
 * The executive tiles count "assets at risk" (own_risk > 0) from a snapshot computed in
 * TypeScript below. For the tile to be drillable, the asset list has to be able to
 * reproduce that population — which means the same score has to exist as a predicate.
 * Deriving both from one map is the only way a second definition cannot quietly appear
 * and disagree with the first; that is the whole lesson of the Metric Contract.
 *
 * Mirrors `gatherAssetRisk`'s arithmetic exactly: clamp confidence to [0,100], scale the
 * decision's base by it, round. A `needs_review` (40) at 1% confidence rounds to 0 and is
 * therefore NOT at risk — a threshold a hand-written `decision IN (...)` predicate would
 * have got wrong.
 */
export function sqlAssetOwnRisk(decisionCol = "cd.decision", confidenceCol = "cd.confidence"): string {
  const cases = Object.entries(DECISION_RISK)
    .map(([decision, base]) => `WHEN '${decision}' THEN ${base}`)
    .join(" ");
  return `ROUND(
    (CASE ${decisionCol} ${cases} ELSE 0 END)::numeric
    * (GREATEST(0, LEAST(100, COALESCE(${confidenceCol}, 0)))::numeric / 100)
  )`;
}

/** `own_risk > 0` — the one definition of an asset that is "at risk". */
export function sqlAssetAtRisk(decisionCol = "cd.decision", confidenceCol = "cd.confidence"): string {
  return `${sqlAssetOwnRisk(decisionCol, confidenceCol)} > 0`;
}

/**
 * The current applicability decision per asset (latest-wins over the WORM ledger).
 * Shared by `gatherAssetRisk` and the asset list's `at_risk` filter so both resolve
 * "current" the same way.
 */
export function sqlCurrentDecisionsCte(orgParam: string): string {
  return `
    SELECT DISTINCT ON (asset_id) asset_id, decision, confidence
      FROM applicability_assessments
     WHERE organization_id = ${orgParam} AND asset_id IS NOT NULL
     ORDER BY asset_id, seq DESC
  `;
}

interface RegistryRiskRow {
  asset_type: string;
  criticality: string | null;
  decision: string | null;
  confidence: number | null;
}

/**
 * Every registry asset with its own-risk seed from its CURRENT applicability
 * decision (latest-wins per asset_id over the WORM ledger). LEFT JOIN so
 * unassessed assets count as own-risk 0. Runs inside the caller's tenant
 * transaction (asTenant route or withTenant worker) with an explicit org
 * predicate.
 */
export async function gatherAssetRisk(orgId: string): Promise<AssetRiskRow[]> {
  const { rows } = await pg.query<RegistryRiskRow>(
    `WITH current_decisions AS (${sqlCurrentDecisionsCte("$1")})
     SELECT v.asset_type, v.criticality, cd.decision, cd.confidence
       FROM asset_registry_v v
       LEFT JOIN current_decisions cd ON cd.asset_id = v.asset_id
      WHERE v.organization_id = $1`,
    [orgId]
  );
  return rows.map((r) => {
    const base = r.decision ? DECISION_RISK[r.decision] ?? 0 : 0;
    const conf = r.confidence === null ? 0 : Math.max(0, Math.min(100, r.confidence)) / 100;
    return { asset_type: r.asset_type, criticality: r.criticality, own_risk: Math.round(base * conf) };
  });
}
