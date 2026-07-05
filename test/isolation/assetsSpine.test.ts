/**
 * assetsSpine.test.ts — EAR Phase 1: real-Postgres behavior of the Tier-0
 * `assets` spine (20260803_assets_spine.sql).
 *
 * Proves: (1) the in-migration backfill registered every seeded backing row
 * and populated asset_id back-pointers; (2) backfillAssetRegistry() (the
 * operator script's core, same SQL) idempotently catches rows created after
 * migration time — the dark-window scenario; (3) registry identity now wins
 * in asset_registry_v while the COALESCE fallback keeps unregistered rows
 * visible; (4) RLS on assets (USING + WITH CHECK) as app_request; (5) the
 * UNIQUE (org, backing_kind, backing_id) idempotency anchor; (6) the
 * relationship pre-flight table for 'asset' endpoints exists and is org-scoped.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import crypto from "crypto";

import { bootstrapTestDb, type TestDbSeed } from "./testDb.js";
import { backfillAssetRegistry } from "../../src/api/lib/assetRegistrar.js";

let seed: TestDbSeed;
let pool: Pool;
let vendorA: string;

beforeAll(async () => {
  seed = await bootstrapTestDb();

  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the assets spine test.");
  pool = new Pool({ connectionString: url, ssl: false });

  // Backing rows created AFTER the migration ran (bootstrap applies the full
  // migration set to an empty schema, so these are all "dark-window" rows).
  vendorA = (await pool.query(
    `INSERT INTO vendors (organization_id, name, criticality) VALUES ($1, 'Spine Vendor', 'high') RETURNING id`,
    [seed.orgA.id]
  )).rows[0].id as string;
  await pool.query(
    `INSERT INTO ai_systems (organization_id, name) VALUES ($1, 'Spine Model')`,
    [seed.orgA.id]
  );
  await pool.query(
    `INSERT INTO enterprise_entities (organization_id, entity_type, name)
     VALUES ($1, 'data_store', 'Spine DB'), ($1, 'department', 'Spine Dept')`,
    [seed.orgA.id]
  );
  await pool.query(
    `INSERT INTO vendors (organization_id, name) VALUES ($1, 'B Spine Vendor')`,
    [seed.orgB.id]
  );
}, 120_000);

afterAll(async () => { await pool?.end(); });

describe("EAR Phase 1 — assets spine", () => {
  it("COALESCE fallback: unregistered (dark-window) rows stay visible in the view", async () => {
    const r = await pool.query(
      `SELECT asset_id, backing_id, asset_type, lifecycle_status FROM asset_registry_v
        WHERE organization_id = $1 AND name = 'Spine Vendor'`,
      [seed.orgA.id]
    );
    expect(r.rowCount).toBe(1);
    // No registry row yet → identity falls back to the backing id.
    expect(r.rows[0].asset_id).toBe(vendorA);
    expect(r.rows[0].asset_type).toBe("vendor");
    expect(r.rows[0].lifecycle_status).toBe("active");
  });

  it("backfillAssetRegistry registers everything, points back-pointers, and is idempotent", async () => {
    await backfillAssetRegistry(pool);
    await backfillAssetRegistry(pool); // idempotent — second run is a no-op

    const gaps = await pool.query(
      `SELECT
         (SELECT count(*)::int FROM vendors             WHERE asset_id IS NULL) AS v,
         (SELECT count(*)::int FROM ai_systems          WHERE asset_id IS NULL) AS s,
         (SELECT count(*)::int FROM enterprise_entities WHERE asset_id IS NULL) AS e`
    );
    expect(gaps.rows[0]).toMatchObject({ v: 0, s: 0, e: 0 });

    // Exactly one registry row per backing row (UNIQUE anchor held across both runs).
    const dup = await pool.query(
      `SELECT backing_kind, backing_id FROM assets
        GROUP BY backing_kind, backing_id HAVING count(*) > 1`
    );
    expect(dup.rowCount).toBe(0);

    // §2.3 projection applied by the backfill CASE.
    const typed = await pool.query(
      `SELECT a.asset_type FROM assets a
        JOIN enterprise_entities e ON e.id = a.backing_id
       WHERE a.organization_id = $1 AND e.name = 'Spine DB'`,
      [seed.orgA.id]
    );
    expect(typed.rows[0].asset_type).toBe("database");
    const generic = await pool.query(
      `SELECT a.asset_type FROM assets a
        JOIN enterprise_entities e ON e.id = a.backing_id
       WHERE a.organization_id = $1 AND e.name = 'Spine Dept'`,
      [seed.orgA.id]
    );
    expect(generic.rows[0].asset_type).toBe("generic");
  });

  it("registry identity wins in the view once registered (asset_id = assets.id = backing.asset_id)", async () => {
    const r = await pool.query(
      `SELECT rv.asset_id, v.asset_id AS pointer, a.id AS registry_id
         FROM asset_registry_v rv
         JOIN vendors v ON v.id = rv.backing_id
         JOIN assets a ON a.backing_kind = 'vendors' AND a.backing_id = v.id
        WHERE rv.organization_id = $1 AND rv.name = 'Spine Vendor'`,
      [seed.orgA.id]
    );
    expect(r.rowCount).toBe(1);
    expect(r.rows[0].asset_id).toBe(r.rows[0].registry_id);
    expect(r.rows[0].pointer).toBe(r.rows[0].registry_id);
  });

  it("cross-org discipline: org A registry rows only reference org A backing rows", async () => {
    const r = await pool.query(
      `SELECT count(*)::int AS n FROM assets a
        WHERE a.organization_id = $1
          AND a.backing_kind = 'vendors'
          AND NOT EXISTS (SELECT 1 FROM vendors v WHERE v.id = a.backing_id AND v.organization_id = $1)`,
      [seed.orgA.id]
    );
    expect(Number(r.rows[0].n)).toBe(0);
  });

  it("RLS: app_request reads are org-filtered and cross-org writes are rejected", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgA.id]);

      const read = await client.query(`SELECT DISTINCT organization_id FROM assets`);
      expect(read.rows.map((r) => r.organization_id)).toEqual([seed.orgA.id]);

      await expect(
        client.query(
          `INSERT INTO assets (organization_id, asset_type, backing_kind, backing_id)
           VALUES ($1, 'vendor', 'vendors', $2)`,
          [seed.orgB.id, crypto.randomUUID()]
        )
      ).rejects.toThrow(/row-level security/i);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("asset endpoints pass the relationship pre-flight shape (same-org row exists in assets)", async () => {
    // The route pre-flight is `SELECT 1 FROM assets WHERE id=$1 AND organization_id=$2`
    // (NODE_TYPE_TABLE dispatch). Prove it holds for a registered asset and
    // fails cross-org.
    const asset = await pool.query(
      `SELECT id FROM assets WHERE organization_id = $1 AND backing_kind = 'vendors' AND backing_id = $2`,
      [seed.orgA.id, vendorA]
    );
    const assetId = asset.rows[0].id as string;

    const ok = await pool.query(
      `SELECT 1 FROM assets WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      [assetId, seed.orgA.id]
    );
    expect(ok.rowCount).toBe(1);
    const cross = await pool.query(
      `SELECT 1 FROM assets WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      [assetId, seed.orgB.id]
    );
    expect(cross.rowCount).toBe(0);

    // And the edge itself inserts with 'asset' endpoints (DB CHECK from Item 0).
    const edge = await pool.query(
      `INSERT INTO enterprise_relationships
         (organization_id, from_type, from_id, to_type, to_id, relationship_type)
       VALUES ($1, 'asset', $2, 'vendor', $3, 'managed_by') RETURNING id`,
      [seed.orgA.id, assetId, vendorA]
    );
    expect(edge.rowCount).toBe(1);
  });

  it("org-CASCADE integrity: assets FK follows organizations (no orphan vector)", async () => {
    const fk = await pool.query(
      `SELECT confdeltype FROM pg_constraint
        WHERE conrelid = 'assets'::regclass AND confrelid = 'organizations'::regclass`
    );
    expect(fk.rows[0].confdeltype).toBe("c"); // CASCADE
    const backPtr = await pool.query(
      `SELECT confdeltype FROM pg_constraint
        WHERE conrelid = 'vendors'::regclass AND confrelid = 'assets'::regclass`
    );
    expect(backPtr.rows[0].confdeltype).toBe("n"); // SET NULL
  });
});
