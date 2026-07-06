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
    `WITH current_decisions AS (
       SELECT DISTINCT ON (asset_id) asset_id, decision, confidence
         FROM applicability_assessments
        WHERE organization_id = $1 AND asset_id IS NOT NULL
        ORDER BY asset_id, seq DESC
     )
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
