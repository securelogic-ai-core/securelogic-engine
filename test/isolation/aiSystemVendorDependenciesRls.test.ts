/**
 * aiSystemVendorDependenciesRls.test.ts — A04-G1: DB-layer RLS enforcement on
 * `ai_system_vendor_dependencies` (migration 20260702_ai_system_vendor_dependencies_rls.sql).
 *
 * Mirror of the signal-link RLS certs. The route family
 * (aiSystemVendorDependencies.ts) is asTenant()-wrapped and the table is written
 * only by those routes, so the policy preserves the "policy ⟹ routes wrapped"
 * invariant. Rows are org-owned (organization_id NOT NULL).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { bootstrapTestDb, type TestDbSeed } from "./testDb.js";

let seed: TestDbSeed;
let pool: Pool;
let depA: string;
let aiSystemA: string;
let vendorA: string;
let aiSystemB: string;
let vendorB: string;

async function seedAiSystem(p: Pool, orgId: string, name: string): Promise<string> {
  const r = await p.query<{ id: string }>(
    `INSERT INTO ai_systems (organization_id, name) VALUES ($1, $2) RETURNING id`,
    [orgId, name],
  );
  return r.rows[0].id;
}

async function seedVendor(p: Pool, orgId: string, name: string): Promise<string> {
  const r = await p.query<{ id: string }>(
    `INSERT INTO vendors (organization_id, name) VALUES ($1, $2) RETURNING id`,
    [orgId, name],
  );
  return r.rows[0].id;
}

const INSERT_DEP = `INSERT INTO ai_system_vendor_dependencies
    (organization_id, ai_system_id, vendor_id, dependency_role, notes)
  VALUES ($1, $2, $3, 'model_provider', 'rls harness dep')
  RETURNING id`;

beforeAll(async () => {
  seed = await bootstrapTestDb();

  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the ai_system_vendor_dependencies RLS test.");
  pool = new Pool({ connectionString: url, ssl: false });

  aiSystemA = await seedAiSystem(pool, seed.orgA.id, "AISVD Org A AI system");
  vendorA = await seedVendor(pool, seed.orgA.id, "AISVD Org A vendor");
  aiSystemB = await seedAiSystem(pool, seed.orgB.id, "AISVD Org B AI system");
  vendorB = await seedVendor(pool, seed.orgB.id, "AISVD Org B vendor");

  const a = await pool.query(INSERT_DEP, [seed.orgA.id, aiSystemA, vendorA]);
  depA = a.rows[0].id as string;
  await pool.query(INSERT_DEP, [seed.orgB.id, aiSystemB, vendorB]);
}, 120_000);

afterAll(async () => { await pool?.end(); });

describe("A04-G1 — ai_system_vendor_dependencies RLS enforcement", () => {
  it("app_request scoped to org A cannot see org B's deps, and sees its own", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgA.id]);

      const crossOrg = await client.query(
        "SELECT id FROM ai_system_vendor_dependencies WHERE organization_id = $1",
        [seed.orgB.id],
      );
      expect(crossOrg.rowCount).toBe(0);

      const visible = await client.query("SELECT organization_id FROM ai_system_vendor_dependencies");
      const orgs = visible.rows.map((r) => r.organization_id);
      expect(orgs).toContain(seed.orgA.id);
      expect(orgs).not.toContain(seed.orgB.id);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("app_request scoped to org A can INSERT a dep for org A (positive write)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgA.id]);

      await client.query("UPDATE ai_system_vendor_dependencies SET deleted_at = NOW() WHERE id = $1", [depA]);
      const inserted = await client.query(INSERT_DEP, [seed.orgA.id, aiSystemA, vendorA]);
      expect(inserted.rowCount).toBe(1);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("app_request scoped to org B cannot UPDATE or DELETE org A's dep (rowCount 0, DB-enforced)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgB.id]);

      const upd = await client.query("UPDATE ai_system_vendor_dependencies SET notes = 'hijacked' WHERE id = $1", [depA]);
      expect(upd.rowCount).toBe(0);
      const del = await client.query("UPDATE ai_system_vendor_dependencies SET deleted_at = NOW() WHERE id = $1", [depA]);
      expect(del.rowCount).toBe(0);
      const hardDel = await client.query("DELETE FROM ai_system_vendor_dependencies WHERE id = $1", [depA]);
      expect(hardDel.rowCount).toBe(0);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("app_request with an UNSET org GUC sees zero deps (fail-closed default)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      const res = await client.query("SELECT id FROM ai_system_vendor_dependencies");
      expect(res.rowCount).toBe(0);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("app_request with an EMPTY-STRING org GUC sees zero deps (NULLIF fail-closed)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', '', true)");
      const res = await client.query("SELECT id FROM ai_system_vendor_dependencies");
      expect(res.rowCount).toBe(0);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("app_request scoped to org A cannot INSERT a dep stamped for org B (WITH CHECK)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgA.id]);

      await expect(
        client.query(INSERT_DEP, [seed.orgB.id, aiSystemB, vendorB]),
      ).rejects.toThrow(/row-level security/i);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("the owner connection bypasses RLS (regression — sees all orgs' deps)", async () => {
    const res = await pool.query("SELECT DISTINCT organization_id FROM ai_system_vendor_dependencies");
    const orgs = res.rows.map((r) => r.organization_id);
    expect(orgs).toContain(seed.orgA.id);
    expect(orgs).toContain(seed.orgB.id);
  });
});
