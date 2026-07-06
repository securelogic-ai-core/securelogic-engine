/**
 * riskHistoryStore.ts — ERIP F2: persist a daily risk-rollup snapshot into
 * risk_history (20260816). Derived + recomputable (ERIP-AD-15): the snapshot is
 * the dimensional rollup at a point in time, upserted per (org, date,
 * dimension) so a same-day re-run refreshes rather than duplicates. Feeds E4
 * trends and the E5 feature store. Tenant-scoped (withTenant worker).
 */

import { pg } from "../infra/postgres.js";
import { rollupRiskByDimension, type DimensionRollup } from "./riskDimensionRollup.js";
import { gatherAssetRisk } from "./riskDimensionData.js";

/** The 'enterprise' dimension key for the org-wide overall rollup. */
export const ENTERPRISE_DIMENSION = "enterprise";

async function upsertRow(orgId: string, snapshotDate: string, d: DimensionRollup): Promise<void> {
  await pg.query(
    `INSERT INTO risk_history
       (organization_id, snapshot_date, dimension, asset_count, at_risk_count, max_risk, avg_risk, bands)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
     ON CONFLICT (organization_id, snapshot_date, dimension)
     DO UPDATE SET
       asset_count = EXCLUDED.asset_count,
       at_risk_count = EXCLUDED.at_risk_count,
       max_risk = EXCLUDED.max_risk,
       avg_risk = EXCLUDED.avg_risk,
       bands = EXCLUDED.bands,
       updated_at = now()`,
    [orgId, snapshotDate, d.dimension, d.asset_count, d.at_risk_count, d.max_risk, d.avg_risk, JSON.stringify(d.bands)]
  );
}

/**
 * Snapshot the org's current risk rollup into risk_history for `snapshotDate`
 * (YYYY-MM-DD). Writes the enterprise overall row plus one row per asset_type.
 * Returns the number of dimension rows written. Idempotent per day.
 */
export async function snapshotRiskHistory(orgId: string, snapshotDate: string): Promise<number> {
  const rollup = rollupRiskByDimension(await gatherAssetRisk(orgId));
  // The overall rollup carries dimension 'enterprise' already.
  await upsertRow(orgId, snapshotDate, rollup.overall);
  for (const d of rollup.by_asset_type) await upsertRow(orgId, snapshotDate, d);
  return 1 + rollup.by_asset_type.length;
}
