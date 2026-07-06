/**
 * assetDetailPersistence.ts — EAR Phase 3a: create a detail-backed asset
 * (cloud_resource / endpoint / api / identity_system) and register it in the
 * Tier-0 spine, in the caller's transaction (the pg proxy pattern).
 *
 * Shared by the unified POST /api/assets route (Phase 3a) and the connector
 * sync worker (Phase 3b). Both call sites are reachable ONLY behind
 * SECURELOGIC_ASSET_REGISTRY_ENABLED, so registration is unconditional here —
 * unlike the Phase-1 hooks on live routes, there is no dark window for these
 * types (a detail row cannot exist unregistered).
 */

import { pg } from "../infra/postgres.js";
import { registerAsset, type BackingKind } from "./assetRegistrar.js";
import {
  DETAIL_TABLE_SPEC,
  type AssetDetailCreateInput,
  type DetailBackedType
} from "./assetDetailValidation.js";

/** Conservative per-type per-org row cap (defensive; operator-tunable later —
 * recorded in the EAR tracker's operator notes). Same spirit as the ECL
 * enterprise-entity cap, kept separate so existing cap semantics are untouched. */
export const DETAIL_ASSET_CAP = 10_000;

export type CreateDetailAssetResult =
  | { row: Record<string, unknown>; assetId: string }
  | { error: "name_already_exists" }
  | { error: "external_ref_already_exists" }
  | { error: "cap_exceeded"; cap: number };

export async function createDetailAsset(
  orgId: string,
  input: AssetDetailCreateInput
): Promise<CreateDetailAssetResult> {
  const spec = DETAIL_TABLE_SPEC[input.asset_type as DetailBackedType];

  const count = await pg.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM ${spec.table} WHERE organization_id = $1`,
    [orgId]
  );
  if (Number(count.rows[0]!.n) >= DETAIL_ASSET_CAP) {
    return { error: "cap_exceeded", cap: DETAIL_ASSET_CAP };
  }

  const typedCols = spec.typedColumns;
  const cols = ["organization_id", "name", "criticality", "status", "external_ref", ...typedCols];
  const params: unknown[] = [
    orgId,
    input.name,
    input.criticality,
    input.status,
    input.external_ref,
    ...typedCols.map((c) => input.typed[c] ?? null)
  ];
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");

  // ON CONFLICT DO NOTHING (covers both the (org,name) UNIQUE and the partial
  // (org,external_ref) unique index) instead of catch-23505: a thrown unique
  // violation would ABORT the caller's transaction, and the Phase-3b sync
  // worker persists many assets in ONE tenant tx — the conflict must be a
  // classified return value, never an aborted tx. Zero rows → classify which
  // key collided (same-tx read; the route's 409 vocabulary is unchanged).
  const inserted = await pg.query(
    `INSERT INTO ${spec.table} (${cols.join(", ")})
     VALUES (${placeholders})
     ON CONFLICT DO NOTHING
     RETURNING *`,
    params
  );
  if ((inserted.rowCount ?? 0) === 0) {
    if (input.external_ref !== null) {
      const ref = await pg.query(
        `SELECT 1 FROM ${spec.table} WHERE organization_id = $1 AND external_ref = $2 LIMIT 1`,
        [orgId, input.external_ref]
      );
      if ((ref.rowCount ?? 0) > 0) return { error: "external_ref_already_exists" };
    }
    return { error: "name_already_exists" };
  }

  const row = inserted.rows[0] as Record<string, unknown> & { id: string };
  const assetId = await registerAsset(orgId, spec.assetType, spec.table as BackingKind, row.id);
  return { row: { ...row, asset_id: assetId }, assetId };
}
