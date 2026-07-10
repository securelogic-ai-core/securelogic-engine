/**
 * signalApplicabilityShadowRunner.test.ts — C3 wired shadow runner (real Postgres).
 *
 * Proves the shadow: (1) reproduces the legacy asset match (agree) when the org
 * has one matching asset; (2) routes a tenant duplicate to shadow_unresolved
 * (needs_review) instead of asserting; (3) needs_review for an empty identifier;
 * and (4) WRITES NOTHING to the customer applicability store (measure-only).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import crypto from "crypto";

import { bootstrapTestDb, type TestDbSeed } from "./testDb.js";
import { backfillAssetRegistry } from "../../src/api/lib/assetRegistrar.js";
import { runSignalApplicabilityShadow } from "../../src/api/lib/signalApplicabilityShadowRunner.js";

let seed: TestDbSeed;
let pool: Pool;

async function makeAppAsset(orgId: string, name: string): Promise<string> {
  const entity = await pool.query<{ id: string }>(
    `INSERT INTO enterprise_entities (organization_id, entity_type, name) VALUES ($1, 'application', $2) RETURNING id`,
    [orgId, name]
  );
  await backfillAssetRegistry(pool);
  const asset = await pool.query<{ id: string }>(
    `SELECT id FROM assets WHERE organization_id = $1 AND backing_kind = 'enterprise_entities' AND backing_id = $2`,
    [orgId, entity.rows[0].id]
  );
  return asset.rows[0].id;
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the shadow runner test.");
  pool = new Pool({ connectionString: url, ssl: false });
}, 120_000);

afterAll(async () => { await pool?.end(); });

describe("C3 — runSignalApplicabilityShadow (wired)", () => {
  it("agrees with the legacy asset match and writes NOTHING to the applicability store", async () => {
    const name = `Exchange ${crypto.randomUUID().slice(0, 8)}`;
    const assetId = await makeAppAsset(seed.orgA.id, name);
    const client = await pool.connect();
    try {
      const before = await client.query(`SELECT count(*)::int AS n FROM applicability_assessments WHERE organization_id = $1`, [seed.orgA.id]);
      const cmp = await runSignalApplicabilityShadow(
        client, seed.orgA.id,
        { affected_vendor: name, affected_cve: "CVE-2021-26855" },
        [assetId] // legacy asset-branch match
      );
      expect(cmp.agreement).toBe("agree");
      expect(cmp.shadow_asset_ids).toEqual([assetId]);
      // measure-only: no write to the customer applicability store
      const after = await client.query(`SELECT count(*)::int AS n FROM applicability_assessments WHERE organization_id = $1`, [seed.orgA.id]);
      expect(after.rows[0].n).toBe(before.rows[0].n);
    } finally { client.release(); }
  });

  it("routes a tenant duplicate to shadow_unresolved (needs_review), never auto-asserts", async () => {
    const base = `Dup ${crypto.randomUUID().slice(0, 8)}`;
    const a = await makeAppAsset(seed.orgA.id, base);
    const b = await makeAppAsset(seed.orgA.id, `${base}, Inc.`); // same canonical
    const client = await pool.connect();
    try {
      const cmp = await runSignalApplicabilityShadow(
        client, seed.orgA.id,
        { affected_vendor: base, affected_cve: null },
        [a, b]
      );
      expect(cmp.agreement).toBe("shadow_unresolved");
      expect(cmp.unresolved_ambiguity).toBe(true);
    } finally { client.release(); }
  });

  it("needs_review when the signal carries no usable identifier", async () => {
    const client = await pool.connect();
    try {
      const cmp = await runSignalApplicabilityShadow(client, seed.orgA.id, { affected_vendor: null, affected_cve: null }, []);
      expect(cmp.shadow_status).toBe("needs_review");
      expect(cmp.agreement).toBe("shadow_unresolved");
    } finally { client.release(); }
  });
});
