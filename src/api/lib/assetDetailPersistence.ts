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
import { registerAsset, deregisterAsset, type BackingKind } from "./assetRegistrar.js";
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

export type UpdateDetailAssetResult =
  | { row: Record<string, unknown> }
  | { error: "not_found" }
  | { error: "name_already_exists" }
  | { error: "external_ref_already_exists" };

/**
 * EAR P6: partial update of a detail-backed asset's row. Patch keys are the
 * VALIDATED closed column set (assetDetailValidation) — never raw caller
 * input. Uniqueness conflicts are pre-checked in the same tx (a thrown 23505
 * would abort the caller's transaction — the createDetailAsset lesson).
 */
export async function updateDetailAsset(
  orgId: string,
  assetType: DetailBackedType,
  backingId: string,
  patch: Record<string, string | null>
): Promise<UpdateDetailAssetResult> {
  const spec = DETAIL_TABLE_SPEC[assetType];

  if (typeof patch.name === "string") {
    const clash = await pg.query(
      `SELECT 1 FROM ${spec.table} WHERE organization_id = $1 AND name = $2 AND id <> $3 LIMIT 1`,
      [orgId, patch.name, backingId]
    );
    if ((clash.rowCount ?? 0) > 0) return { error: "name_already_exists" };
  }
  if (typeof patch.external_ref === "string") {
    const clash = await pg.query(
      `SELECT 1 FROM ${spec.table} WHERE organization_id = $1 AND external_ref = $2 AND id <> $3 LIMIT 1`,
      [orgId, patch.external_ref, backingId]
    );
    if ((clash.rowCount ?? 0) > 0) return { error: "external_ref_already_exists" };
  }

  const keys = Object.keys(patch);
  const sets = keys.map((k, i) => `${k} = $${i + 3}`).join(", ");
  const updated = await pg.query(
    `UPDATE ${spec.table}
        SET ${sets}, updated_at = now()
      WHERE id = $1 AND organization_id = $2
      RETURNING *`,
    [backingId, orgId, ...keys.map((k) => patch[k] ?? null)]
  );
  const row = updated.rows[0] as Record<string, unknown> | undefined;
  return row ? { row } : { error: "not_found" };
}

/**
 * EAR P6: delete a detail-backed asset — detail row + its registry row in the
 * caller's tx. FKs already protect references: suggestions/assessments keep
 * (target_type, target_id) and their asset_id goes NULL (ON DELETE SET NULL,
 * EAR-AD-3 compat).
 */
export async function deleteDetailAsset(
  orgId: string,
  assetType: DetailBackedType,
  backingId: string
): Promise<{ deleted: boolean }> {
  const spec = DETAIL_TABLE_SPEC[assetType];
  const del = await pg.query(
    `DELETE FROM ${spec.table} WHERE id = $1 AND organization_id = $2`,
    [backingId, orgId]
  );
  if ((del.rowCount ?? 0) === 0) return { deleted: false };
  await deregisterAsset(orgId, spec.table as BackingKind, backingId);
  return { deleted: true };
}
