/**
 * assetLifecycle.test.ts — EAR P6 on real Postgres: the detail-backed asset
 * CRUD round-trip (create → update → read-through-view → delete) and the
 * load-bearing EAR-AD-3 compat proof: deleting an asset NULLs the
 * signal_match_suggestions.asset_id back-pointer (FK SET NULL) while the
 * polymorphic (target_type, target_id) reference survives untouched.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { bootstrapTestDb, seedCyberSignal, type TestDbSeed } from "./testDb.js";
import { withTenant } from "../../src/api/infra/postgres.js";
import {
  createDetailAsset,
  updateDetailAsset,
  deleteDetailAsset
} from "../../src/api/lib/assetDetailPersistence.js";

let seed: TestDbSeed;
let pool: Pool;
let assetId: string;
let backingId: string;

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the asset lifecycle test.");
  pool = new Pool({ connectionString: url, ssl: false });

  const created = await withTenant(seed.orgA.id, () =>
    createDetailAsset(seed.orgA.id, {
      asset_type: "endpoint",
      name: "lifecycle-laptop",
      criticality: "low",
      status: "active",
      external_ref: "lc:ep-1",
      typed: { hostname: "lifecycle-laptop.corp", exposure: "internal" }
    })
  );
  if (!("row" in created)) throw new Error("seed create failed");
  assetId = created.assetId;
  backingId = String(created.row.id);
}, 120_000);

afterAll(async () => { await pool?.end(); });

describe("EAR P6 — detail-backed asset lifecycle", () => {
  it("partial update writes only the patched columns and bumps updated_at", async () => {
    const before = await pool.query(`SELECT updated_at FROM endpoints WHERE id = $1`, [backingId]);
    const result = await withTenant(seed.orgA.id, () =>
      updateDetailAsset(seed.orgA.id, "endpoint", backingId, { criticality: "critical", exposure: "internet_facing" })
    );
    expect("row" in result).toBe(true);

    const row = await pool.query(
      `SELECT name, criticality, exposure, hostname, updated_at FROM endpoints WHERE id = $1`,
      [backingId]
    );
    expect(row.rows[0]).toMatchObject({
      name: "lifecycle-laptop",           // untouched
      hostname: "lifecycle-laptop.corp",  // untouched
      criticality: "critical",
      exposure: "internet_facing"
    });
    expect(new Date(row.rows[0].updated_at).getTime()).toBeGreaterThanOrEqual(
      new Date(before.rows[0].updated_at).getTime()
    );

    // The view reads the updated attributes through the SAME registry identity.
    const view = await pool.query(
      `SELECT criticality FROM asset_registry_v WHERE organization_id = $1 AND asset_id = $2`,
      [seed.orgA.id, assetId]
    );
    expect(view.rows[0]).toMatchObject({ criticality: "critical" });
  });

  it("uniqueness conflicts are classified return values, never thrown", async () => {
    const other = await withTenant(seed.orgA.id, () =>
      createDetailAsset(seed.orgA.id, {
        asset_type: "endpoint", name: "lifecycle-other", criticality: null,
        status: "active", external_ref: "lc:ep-2", typed: {}
      })
    );
    if (!("row" in other)) throw new Error("second create failed");

    const nameClash = await withTenant(seed.orgA.id, () =>
      updateDetailAsset(seed.orgA.id, "endpoint", String(other.row.id), { name: "lifecycle-laptop" })
    );
    expect(nameClash).toEqual({ error: "name_already_exists" });

    const refClash = await withTenant(seed.orgA.id, () =>
      updateDetailAsset(seed.orgA.id, "endpoint", String(other.row.id), { external_ref: "lc:ep-1" })
    );
    expect(refClash).toEqual({ error: "external_ref_already_exists" });
  });

  it("cross-org update touches nothing (0 rows → not_found)", async () => {
    const result = await withTenant(seed.orgB.id, () =>
      updateDetailAsset(seed.orgB.id, "endpoint", backingId, { criticality: "low" })
    );
    expect(result).toEqual({ error: "not_found" });
    const row = await pool.query(`SELECT criticality FROM endpoints WHERE id = $1`, [backingId]);
    expect(row.rows[0].criticality).toBe("critical");
  });

  it("delete removes detail + registry rows; suggestion asset_id NULLs, target ref survives (EAR-AD-3)", async () => {
    const signalId = await seedCyberSignal(pool, { dedup: "lifecycle-p6-signal" });
    await pool.query(
      `INSERT INTO signal_match_suggestions (organization_id, signal_id, target_type, target_id, asset_id, match_reason, match_score)
       VALUES ($1, $2, 'asset', $3, $3, 'lifecycle-test', 0.9)`,
      [seed.orgA.id, signalId, assetId]
    );

    const result = await withTenant(seed.orgA.id, () =>
      deleteDetailAsset(seed.orgA.id, "endpoint", backingId)
    );
    expect(result).toEqual({ deleted: true });

    const detail = await pool.query(`SELECT 1 FROM endpoints WHERE id = $1`, [backingId]);
    expect(detail.rowCount).toBe(0);
    const registry = await pool.query(`SELECT 1 FROM assets WHERE id = $1`, [assetId]);
    expect(registry.rowCount).toBe(0);

    const suggestion = await pool.query(
      `SELECT target_type, target_id, asset_id FROM signal_match_suggestions
        WHERE organization_id = $1 AND target_id = $2`,
      [seed.orgA.id, assetId]
    );
    expect(suggestion.rows[0]).toMatchObject({
      target_type: "asset",
      target_id: assetId, // polymorphic reference intact (EAR-AD-3)
      asset_id: null      // FK ON DELETE SET NULL fired
    });

    const second = await withTenant(seed.orgA.id, () =>
      deleteDetailAsset(seed.orgA.id, "endpoint", backingId)
    );
    expect(second).toEqual({ deleted: false });
  });
});
