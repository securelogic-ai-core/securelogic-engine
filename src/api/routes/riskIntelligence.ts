/**
 * riskIntelligence.ts — ERIP Epic 3: the executive risk-intelligence read
 * surface (dimensional rollups). Derived and read-only (ERIP-AD-15): every
 * number rolls up per-asset own-risk from the org's CURRENT applicability
 * decisions (ERIP-AD-16) over the federated `asset_registry_v` — no new stored
 * risk truth.
 *
 * Route chain: the Risk Intelligence flag FIRST (404 while dark), then the
 * asset-registry flag (it reads the registry view), auth, org context, the
 * per-org `enterprise_context` capability, and asTenant. Every query filters
 * `organization_id = $1` inside the tenant transaction.
 */

import { Router, type Request, type Response } from "express";
import { pg } from "../infra/postgres.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireCapability } from "../lib/enterpriseContextCapability.js";
import { asTenant } from "../middleware/asTenant.js";
import { assetRegistryFeatureFlag } from "../lib/assetRegistryFeatureFlag.js";
import { riskIntelligenceFeatureFlag } from "../lib/riskIntelligenceFeatureFlag.js";
import { rollupRiskByDimension, type AssetRiskRow } from "../lib/riskDimensionRollup.js";

const router = Router();

/** applicability decision → base own-risk [0–100] (mirrors assetOwnRisk). */
const DECISION_RISK: Record<string, number> = {
  affected: 90,
  potentially_affected: 60,
  needs_review: 40,
  not_affected: 0,
  unknown: 0
};

function getOrgId(req: Request): string | null {
  return (
    (req as { organizationContext?: { organizationId?: string | null } })
      .organizationContext?.organizationId ?? null
  );
}

interface RegistryRiskRow {
  asset_type: string;
  criticality: string | null;
  decision: string | null;
  confidence: number | null;
}

export async function getRiskDimensions(req: Request, res: Response): Promise<void> {
  const orgId = getOrgId(req);
  if (!orgId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }

  // Every registry asset with its CURRENT applicability decision (latest-wins
  // per asset_id over the WORM ledger). LEFT JOIN so unassessed assets count
  // as own-risk 0. asset_id is the uniform join key across all backing types
  // (the matcher resolves vendor/ai_system arms to the registry id too).
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

  const riskRows: AssetRiskRow[] = rows.map((r) => {
    const base = r.decision ? DECISION_RISK[r.decision] ?? 0 : 0;
    const conf = r.confidence === null ? 0 : Math.max(0, Math.min(100, r.confidence)) / 100;
    return { asset_type: r.asset_type, criticality: r.criticality, own_risk: Math.round(base * conf) };
  });

  res.status(200).json({ risk: rollupRiskByDimension(riskRows) });
}

const chain = [
  riskIntelligenceFeatureFlag,
  assetRegistryFeatureFlag,
  requireApiKey,
  attachOrganizationContext,
  requireCapability("enterprise_context")
];

router.get("/risk/dimensions", ...chain, asTenant(getRiskDimensions));

export default router;
