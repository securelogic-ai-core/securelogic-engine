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
import { rollupRiskByDimension } from "../lib/riskDimensionRollup.js";
import { composeExecutiveRiskSummary, type PostureContext } from "../lib/executiveRiskSummary.js";
import { gatherAssetRisk } from "../lib/riskDimensionData.js";

const router = Router();

function getOrgId(req: Request): string | null {
  return (
    (req as { organizationContext?: { organizationId?: string | null } })
      .organizationContext?.organizationId ?? null
  );
}

export async function getRiskDimensions(req: Request, res: Response): Promise<void> {
  const orgId = getOrgId(req);
  if (!orgId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }
  const riskRows = await gatherAssetRisk(orgId);
  res.status(200).json({ risk: rollupRiskByDimension(riskRows) });
}

/** ERIP Epic 4: board-ready executive risk summary (compose canonical objects). */
export async function getExecutiveRiskSummary(req: Request, res: Response): Promise<void> {
  const orgId = getOrgId(req);
  if (!orgId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }

  const rollup = rollupRiskByDimension(await gatherAssetRisk(orgId));

  // Latest posture snapshot (as-is; null when the org has none yet).
  const snap = await pg.query<{ overall_score: number | null; overall_severity: string | null; snapshot_date: string | null }>(
    `SELECT overall_score, overall_severity, snapshot_date
       FROM posture_snapshots
      WHERE organization_id = $1
      ORDER BY snapshot_date DESC
      LIMIT 1`,
    [orgId]
  );
  const posture: PostureContext | null = snap.rows[0]
    ? {
        overall_score: snap.rows[0].overall_score,
        overall_severity: snap.rows[0].overall_severity,
        snapshot_date: snap.rows[0].snapshot_date
      }
    : null;

  res.status(200).json({ executive_summary: composeExecutiveRiskSummary(rollup, posture) });
}

const chain = [
  riskIntelligenceFeatureFlag,
  assetRegistryFeatureFlag,
  requireApiKey,
  attachOrganizationContext,
  requireCapability("enterprise_context")
];

router.get("/risk/dimensions", ...chain, asTenant(getRiskDimensions));
router.get("/executive/risk-summary", ...chain, asTenant(getExecutiveRiskSummary));

export default router;
