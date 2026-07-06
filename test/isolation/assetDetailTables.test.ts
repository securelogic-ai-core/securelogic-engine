/**
 * assetDetailTables.test.ts — EAR Phase 3a: real-Postgres behavior of the four
 * Tier-1 detail tables (20260806) + createDetailAsset round-trip.
 *
 * Proves the §4 Phase-3 round-trip for a native type: create → registered in
 * the same tx → visible in asset_registry_v with the right asset_type →
 * usable as an 'asset' graph endpoint → RLS filters app_request reads and
 * blocks cross-org writes. (Applicability over 'asset' targets is covered by
 * phase2AssetTargets.test.ts; the connector sync path lands in Phase 3b.)
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import crypto from "crypto";

import { bootstrapTestDb, type TestDbSeed } from "./testDb.js";
import { withTenant } from "../../src/api/infra/postgres.js";
import { createDetailAsset } from "../../src/api/lib/assetDetailPersistence.js";
import type { AssetDetailCreateInput } from "../../src/api/lib/assetDetailValidation.js";

let seed: TestDbSeed;
let pool: Pool;

function input(partial: Partial<AssetDetailCreateInput> & { asset_type: AssetDetailCreateInput["asset_type"]; name: string }): AssetDetailCreateInput {
  return { criticality: null, status: "active", external_ref: null, typed: {}, ...partial };
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the asset detail tables test.");
  pool = new Pool({ connectionString: url, ssl: false });
}, 120_000);

afterAll(async () => { await pool?.end(); });

describe("EAR Phase 3a — detail-backed asset round-trip", () => {
  let endpointAssetId: string;

  it("createDetailAsset inserts the detail row and registers it in one tenant tx", async () => {
    const result = await withTenant(seed.orgA.id, async () =>
      createDetailAsset(seed.orgA.id, input({
        asset_type: "endpoint",
        name: "laptop-042",
        criticality: "high",
        external_ref: "defender:machine-042",
        typed: { hostname: "laptop-042.corp", os: "windows_11", exposure: "internal" }
      }))
    );
    expect("row" in result).toBe(true);
    if (!("row" in result)) throw new Error("create failed");
    endpointAssetId = result.assetId;

    const reg = await pool.query(
      `SELECT asset_type, backing_kind FROM assets WHERE id = $1 AND organization_id = $2`,
      [endpointAssetId, seed.orgA.id]
    );
    expect(reg.rows[0]).toMatchObject({ asset_type: "endpoint", backing_kind: "endpoints" });

    const detail = await pool.query(
      `SELECT asset_id, hostname, exposure FROM endpoints WHERE organization_id = $1 AND name = 'laptop-042'`,
      [seed.orgA.id]
    );
    expect(detail.rows[0]).toMatchObject({
      asset_id: endpointAssetId, hostname: "laptop-042.corp", exposure: "internal"
    });
  });

  it("every detail-backed type appears in asset_registry_v with the right projection", async () => {
    await withTenant(seed.orgA.id, async () => {
      await createDetailAsset(seed.orgA.id, input({
        asset_type: "cloud_resource", name: "prod-db-cluster", typed: { provider: "aws", region: "us-east-1" }
      }));
      await createDetailAsset(seed.orgA.id, input({
        asset_type: "api", name: "billing-api", typed: { protocol: "rest", exposure: "partner" }
      }));
      await createDetailAsset(seed.orgA.id, input({
        asset_type: "identity_system", name: "corp-okta", typed: { idp_vendor: "okta", protocol: "oidc" }
      }));
    });

    const rows = await pool.query(
      `SELECT asset_type, name, backing_kind, status FROM asset_registry_v
        WHERE organization_id = $1 AND asset_type IN ('endpoint','cloud_resource','api','identity_system')
        ORDER BY asset_type`,
      [seed.orgA.id]
    );
    expect(rows.rows).toEqual([
      expect.objectContaining({ asset_type: "api", name: "billing-api", backing_kind: "apis", status: "active" }),
      expect.objectContaining({ asset_type: "cloud_resource", name: "prod-db-cluster", backing_kind: "cloud_resources" }),
      expect.objectContaining({ asset_type: "endpoint", name: "laptop-042", backing_kind: "endpoints" }),
      expect.objectContaining({ asset_type: "identity_system", name: "corp-okta", backing_kind: "identity_systems" })
    ]);
  });

  it("a detail-backed asset works as an 'asset' graph endpoint (round-trip → graph)", async () => {
    const edge = await pool.query(
      `INSERT INTO enterprise_relationships
         (organization_id, from_type, from_id, to_type, to_id, relationship_type)
       VALUES ($1, 'asset', $2, 'vendor', $3, 'managed_by') RETURNING id`,
      [seed.orgA.id, endpointAssetId, crypto.randomUUID()]
    );
    expect(edge.rowCount).toBe(1);
  });

  it("dedup: same name or external_ref in one org conflicts; other org unaffected", async () => {
    const dupName = await withTenant(seed.orgA.id, async () =>
      createDetailAsset(seed.orgA.id, input({ asset_type: "endpoint", name: "laptop-042" }))
    );
    expect(dupName).toMatchObject({ error: "name_already_exists" });

    const dupRef = await withTenant(seed.orgA.id, async () =>
      createDetailAsset(seed.orgA.id, input({
        asset_type: "endpoint", name: "laptop-043", external_ref: "defender:machine-042"
      }))
    );
    expect(dupRef).toMatchObject({ error: "external_ref_already_exists" });

    const otherOrg = await withTenant(seed.orgB.id, async () =>
      createDetailAsset(seed.orgB.id, input({ asset_type: "endpoint", name: "laptop-042" }))
    );
    expect("row" in otherOrg).toBe(true);
  });

  it("RLS: app_request reads are org-filtered; cross-org insert rejected", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgA.id]);

      const read = await client.query(`SELECT DISTINCT organization_id FROM endpoints`);
      expect(read.rows.map((r) => r.organization_id)).toEqual([seed.orgA.id]);

      await expect(
        client.query(
          `INSERT INTO endpoints (organization_id, name) VALUES ($1, 'sneaky')`,
          [seed.orgB.id]
        )
      ).rejects.toThrow(/row-level security/i);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });
});
