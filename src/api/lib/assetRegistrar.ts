/**
 * assetRegistrar.ts — EAR Phase 1: registry-row lifecycle for the Tier-0
 * `assets` spine (20260803 migration).
 *
 * registerAsset()/deregisterAsset() ride the AsyncLocalStorage-aware `pg`
 * proxy (infra/postgres.ts): called inside a withTenant/asTenant scope they
 * join the caller's transaction (atomic with the backing-table write); called
 * outside one they hit the owner pool. Every statement is org-scoped by
 * parameter.
 *
 * FLAG DISCIPLINE: callers gate on assetRegistryEnabled() — while
 * SECURELOGIC_ASSET_REGISTRY_ENABLED is off, live routes gain ZERO new writes
 * (§4 dark posture). Rows created during the dark window are caught by
 * backfillAssetRegistry() (operator script scripts/backfill-asset-registry.ts)
 * and stay visible through asset_registry_v's COALESCE fallback meanwhile.
 *
 * The backfill SQL mirrors the 20260803 in-migration backfill — the
 * entity_type CASE stays in lockstep with ENTITY_TYPE_TO_ASSET_TYPE
 * (unit-asserted).
 */

import { pg } from "../infra/postgres.js";
import type { AssetType } from "./assetRegistry.js";

/** Closed backing-table vocabulary — NEVER interpolate caller input. */
const BACKING_TABLES = {
  vendors: "vendors",
  ai_systems: "ai_systems",
  enterprise_entities: "enterprise_entities"
} as const;
export type BackingKind = keyof typeof BACKING_TABLES;

export function isBackingKind(v: unknown): v is BackingKind {
  return typeof v === "string" && v in BACKING_TABLES;
}

/**
 * Upsert the registry row for a backing row and point the backing row's
 * asset_id at it. Idempotent (UNIQUE (org, backing_kind, backing_id)).
 * Returns the registry asset id.
 */
export async function registerAsset(
  orgId: string,
  assetType: AssetType,
  backingKind: BackingKind,
  backingId: string
): Promise<string> {
  const table = BACKING_TABLES[backingKind];
  if (!table) throw new Error(`registerAsset: unknown backing kind ${String(backingKind)}`);

  const ins = await pg.query<{ id: string }>(
    `INSERT INTO assets (organization_id, asset_type, backing_kind, backing_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (organization_id, backing_kind, backing_id)
       DO UPDATE SET updated_at = NOW()
     RETURNING id`,
    [orgId, assetType, backingKind, backingId]
  );
  const assetId = ins.rows[0]!.id;

  await pg.query(
    `UPDATE ${table} SET asset_id = $1
      WHERE id = $2 AND organization_id = $3 AND asset_id IS DISTINCT FROM $1`,
    [assetId, backingId, orgId]
  );

  return assetId;
}

/**
 * Remove the registry row when its backing row is deleted (same tx as the
 * backing DELETE). backing.asset_id needs no cleanup — FK ON DELETE SET NULL,
 * and the backing row is gone anyway.
 */
export async function deregisterAsset(
  orgId: string,
  backingKind: BackingKind,
  backingId: string
): Promise<void> {
  await pg.query(
    `DELETE FROM assets
      WHERE organization_id = $1 AND backing_kind = $2 AND backing_id = $3`,
    [orgId, backingKind, backingId]
  );
}

/**
 * Idempotent cross-org backfill — registers every unregistered backing row
 * and populates missing asset_id back-pointers. Same statements as the
 * 20260803 migration; safe to re-run any time. Takes any query-able (the
 * operator script passes a raw Pool; isolation tests pass theirs).
 */
export async function backfillAssetRegistry(db: {
  query: (sql: string, params?: unknown[]) => Promise<unknown>;
}): Promise<void> {
  await db.query(
    `INSERT INTO assets (organization_id, asset_type, backing_kind, backing_id)
     SELECT organization_id, 'vendor', 'vendors', id FROM vendors
     ON CONFLICT (organization_id, backing_kind, backing_id) DO NOTHING`
  );
  await db.query(
    `INSERT INTO assets (organization_id, asset_type, backing_kind, backing_id)
     SELECT organization_id, 'ai_system', 'ai_systems', id FROM ai_systems
     ON CONFLICT (organization_id, backing_kind, backing_id) DO NOTHING`
  );
  await db.query(
    `INSERT INTO assets (organization_id, asset_type, backing_kind, backing_id)
     SELECT organization_id,
            CASE entity_type
              WHEN 'application' THEN 'application'
              WHEN 'data_store'  THEN 'database'
              ELSE 'generic'
            END,
            'enterprise_entities', id
     FROM enterprise_entities
     ON CONFLICT (organization_id, backing_kind, backing_id) DO NOTHING`
  );
  await db.query(
    `UPDATE vendors v SET asset_id = a.id
       FROM assets a
      WHERE a.backing_kind = 'vendors' AND a.backing_id = v.id
        AND a.organization_id = v.organization_id AND v.asset_id IS NULL`
  );
  await db.query(
    `UPDATE ai_systems s SET asset_id = a.id
       FROM assets a
      WHERE a.backing_kind = 'ai_systems' AND a.backing_id = s.id
        AND a.organization_id = s.organization_id AND s.asset_id IS NULL`
  );
  await db.query(
    `UPDATE enterprise_entities e SET asset_id = a.id
       FROM assets a
      WHERE a.backing_kind = 'enterprise_entities' AND a.backing_id = e.id
        AND a.organization_id = e.organization_id AND e.asset_id IS NULL`
  );
}
