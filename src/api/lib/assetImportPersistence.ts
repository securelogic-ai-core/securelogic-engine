/**
 * assetImportPersistence.ts — EAR P16: the I/O half of the detail-backed asset
 * importer (the pure planner lives in assetImportPlan.ts). Mirrors
 * enterpriseImportPersistence.ts for the assets spine.
 *
 * It reuses the EXISTING create lane for writes — commit persists each `ok` row
 * through `createDetailAsset` (the same function POST /api/assets calls: insert +
 * Tier-0 registration in the caller's tenant tx, ON CONFLICT DO NOTHING). This
 * module only adds the two reads the planner needs: existing dedup keys and cap
 * headroom. Every query is explicitly org-scoped; callers wrap in asTenant.
 */

import { pg } from "../infra/postgres.js";
import { DETAIL_TABLE_SPEC, type DetailBackedType } from "./assetDetailValidation.js";
import { DETAIL_ASSET_CAP } from "./assetDetailPersistence.js";

/** Existing dedup keys (lowercased names) already in the org for this detail type. */
export async function assetImportExistingKeys(
  assetType: DetailBackedType,
  orgId: string
): Promise<Set<string>> {
  // Table name comes from the closed DETAIL_TABLE_SPEC, never caller input.
  const table = DETAIL_TABLE_SPEC[assetType].table;
  const r = await pg.query<{ k: string }>(
    `SELECT lower(name) AS k FROM ${table} WHERE organization_id = $1`,
    [orgId]
  );
  return new Set(r.rows.map((row) => row.k));
}

/**
 * Remaining capacity headroom (cap - used, floored at 0) for this detail type.
 * Uses the SAME per-type row cap createDetailAsset enforces (DETAIL_ASSET_CAP),
 * so preview headroom and commit-time enforcement agree.
 */
export async function assetImportCapHeadroom(
  assetType: DetailBackedType,
  orgId: string
): Promise<number> {
  const table = DETAIL_TABLE_SPEC[assetType].table;
  const r = await pg.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM ${table} WHERE organization_id = $1`,
    [orgId]
  );
  return Math.max(0, DETAIL_ASSET_CAP - Number(r.rows[0]!.n));
}
