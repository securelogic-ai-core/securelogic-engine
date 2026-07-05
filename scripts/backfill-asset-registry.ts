/**
 * backfill-asset-registry.ts — EAR Phase 1 operator backfill.
 *
 * Registers every unregistered vendors / ai_systems / enterprise_entities row
 * in the Tier-0 `assets` spine and populates missing asset_id back-pointers.
 * Idempotent — safe to re-run any time (UNIQUE (org, backing_kind, backing_id)
 * + ON CONFLICT DO NOTHING + asset_id IS NULL predicates).
 *
 * WHEN TO RUN: once, at (or any time before) SECURELOGIC_ASSET_REGISTRY_ENABLED
 * enablement, to catch rows created during the dark window (registerAsset() is
 * flag-gated, so live routes write no registry rows while dark; the 20260803
 * migration only covered rows that existed at deploy time). Until it runs,
 * unregistered rows remain visible through asset_registry_v's COALESCE
 * fallback — nothing is user-broken by deferring it.
 *
 *   MIGRATION_DATABASE_URL=... npx tsx scripts/backfill-asset-registry.ts
 *
 * Same statements as the migration; the SQL lives in
 * src/api/lib/assetRegistrar.ts (backfillAssetRegistry) so isolation tests
 * exercise exactly what the operator runs.
 */

import { Pool } from "pg";
import { backfillAssetRegistry } from "../src/api/lib/assetRegistrar.js";

async function main(): Promise<void> {
  const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    console.error("Set MIGRATION_DATABASE_URL or DATABASE_URL.");
    process.exit(1);
  }
  const pool = new Pool({ connectionString: url });
  try {
    await backfillAssetRegistry(pool);
    const gaps = await pool.query(
      `SELECT
         (SELECT count(*)::int FROM vendors             WHERE asset_id IS NULL) AS vendors,
         (SELECT count(*)::int FROM ai_systems          WHERE asset_id IS NULL) AS ai_systems,
         (SELECT count(*)::int FROM enterprise_entities WHERE asset_id IS NULL) AS enterprise_entities,
         (SELECT count(*)::int FROM assets) AS registry_rows`
    );
    console.log("asset-registry backfill complete:", gaps.rows[0]);
    const g = gaps.rows[0] as Record<string, number>;
    if (Number(g.vendors) + Number(g.ai_systems) + Number(g.enterprise_entities) > 0) {
      console.error("WARNING: unregistered rows remain — investigate before enablement.");
      process.exit(2);
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("asset-registry backfill failed:", err);
  process.exit(1);
});
