/**
 * dependencyAssessmentsRls.test.ts — A04-G1: DB-layer RLS enforcement on
 * `dependency_assessments` (migration 20260703_dependency_assessments_rls.sql).
 *
 * Written only by dependencyAssessments.ts (asTenant()-wrapped, incl. its
 * explicit-tx POST/PATCH which nest as savepoints under the wrap). Other readers
 * (evidence, intelligence) read inside their wrapped handlers. organization_id
 * NOT NULL. dependency_id FKs to dependencies, seeded here.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { bootstrapTestDb, type TestDbSeed } from "./testDb.js";

let seed: TestDbSeed;
let pool: Pool;
let assessA: string;
let depA: string;
let depB: string;

async function seedDependency(p: Pool, orgId: string, name: string): Promise<string> {
  const r = await p.query<{ id: string }>(
    `INSERT INTO dependencies (organization_id, name, dependency_type, criticality)
     VALUES ($1, $2, 'api', 'High') RETURNING id`,
    [orgId, name],
  );
  return r.rows[0].id;
}

const INSERT_ASSESS = `INSERT INTO dependency_assessments (organization_id, dependency_id)
  VALUES ($1, $2) RETURNING id`;

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the dependency_assessments RLS test.");
  pool = new Pool({ connectionString: url, ssl: false });
  depA = await seedDependency(pool, seed.orgA.id, "RLS dep A");
  depB = await seedDependency(pool, seed.orgB.id, "RLS dep B");
  const a = await pool.query(INSERT_ASSESS, [seed.orgA.id, depA]);
  assessA = a.rows[0].id as string;
  await pool.query(INSERT_ASSESS, [seed.orgB.id, depB]);
}, 120_000);

afterAll(async () => { await pool?.end(); });

describe("A04-G1 — dependency_assessments RLS enforcement", () => {
  it("app_request scoped to org A cannot see org B's assessments, and sees its own", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgA.id]);
      const crossOrg = await client.query(
        "SELECT id FROM dependency_assessments WHERE organization_id = $1", [seed.orgB.id]);
      expect(crossOrg.rowCount).toBe(0);
      const visible = await client.query("SELECT organization_id FROM dependency_assessments");
      const orgs = visible.rows.map((r) => r.organization_id);
      expect(orgs).toContain(seed.orgA.id);
      expect(orgs).not.toContain(seed.orgB.id);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("app_request scoped to org A can INSERT an assessment for org A (positive write)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgA.id]);
      const inserted = await client.query(INSERT_ASSESS, [seed.orgA.id, depA]);
      expect(inserted.rowCount).toBe(1);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("app_request scoped to org B cannot UPDATE or DELETE org A's assessment (rowCount 0)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgB.id]);
      const upd = await client.query(
        "UPDATE dependency_assessments SET status = 'flagged' WHERE id = $1", [assessA]);
      expect(upd.rowCount).toBe(0);
      const del = await client.query("DELETE FROM dependency_assessments WHERE id = $1", [assessA]);
      expect(del.rowCount).toBe(0);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("app_request with an UNSET org GUC sees zero rows (fail-closed default)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      const res = await client.query("SELECT id FROM dependency_assessments");
      expect(res.rowCount).toBe(0);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("app_request with an EMPTY-STRING org GUC sees zero rows (NULLIF fail-closed)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', '', true)");
      const res = await client.query("SELECT id FROM dependency_assessments");
      expect(res.rowCount).toBe(0);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("app_request scoped to org A cannot INSERT an assessment stamped for org B (WITH CHECK)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgA.id]);
      await expect(
        client.query(INSERT_ASSESS, [seed.orgB.id, depB]),
      ).rejects.toThrow(/row-level security/i);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("the owner connection bypasses RLS (regression — sees all orgs' assessments)", async () => {
    const res = await pool.query("SELECT DISTINCT organization_id FROM dependency_assessments");
    const orgs = res.rows.map((r) => r.organization_id);
    expect(orgs).toContain(seed.orgA.id);
    expect(orgs).toContain(seed.orgB.id);
  });
});
