/**
 * dependenciesRls.test.ts — A04-G1: DB-layer RLS enforcement on `dependencies`
 * (migration 20260703_dependencies_rls.sql).
 *
 * Written only by dependencies.ts (asTenant()-wrapped, incl. explicit-tx
 * POST/PATCH and the serialized /summary GET). Other readers (dashboard,
 * dependencyAssessments, intelligence) read inside their wrapped handlers.
 * organization_id NOT NULL.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { bootstrapTestDb, type TestDbSeed } from "./testDb.js";

let seed: TestDbSeed;
let pool: Pool;
let depA: string;

const INSERT_DEP = `INSERT INTO dependencies (organization_id, name, dependency_type, criticality)
  VALUES ($1, $2, 'api', 'High') RETURNING id`;

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the dependencies RLS test.");
  pool = new Pool({ connectionString: url, ssl: false });
  const a = await pool.query(INSERT_DEP, [seed.orgA.id, "RLS dep A"]);
  depA = a.rows[0].id as string;
  await pool.query(INSERT_DEP, [seed.orgB.id, "RLS dep B"]);
}, 120_000);

afterAll(async () => { await pool?.end(); });

describe("A04-G1 — dependencies RLS enforcement", () => {
  it("app_request scoped to org A cannot see org B's dependencies, and sees its own", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgA.id]);
      const crossOrg = await client.query(
        "SELECT id FROM dependencies WHERE organization_id = $1", [seed.orgB.id]);
      expect(crossOrg.rowCount).toBe(0);
      const visible = await client.query("SELECT organization_id FROM dependencies");
      const orgs = visible.rows.map((r) => r.organization_id);
      expect(orgs).toContain(seed.orgA.id);
      expect(orgs).not.toContain(seed.orgB.id);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("app_request scoped to org A can INSERT a dependency for org A (positive write)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgA.id]);
      const inserted = await client.query(INSERT_DEP, [seed.orgA.id, "RLS dep A2"]);
      expect(inserted.rowCount).toBe(1);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("app_request scoped to org B cannot UPDATE or DELETE org A's dependency (rowCount 0)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgB.id]);
      const upd = await client.query(
        "UPDATE dependencies SET status = 'deprecated' WHERE id = $1", [depA]);
      expect(upd.rowCount).toBe(0);
      const del = await client.query("DELETE FROM dependencies WHERE id = $1", [depA]);
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
      const res = await client.query("SELECT id FROM dependencies");
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
      const res = await client.query("SELECT id FROM dependencies");
      expect(res.rowCount).toBe(0);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("app_request scoped to org A cannot INSERT a dependency stamped for org B (WITH CHECK)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgA.id]);
      await expect(
        client.query(INSERT_DEP, [seed.orgB.id, "RLS dep B2"]),
      ).rejects.toThrow(/row-level security/i);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("the owner connection bypasses RLS (regression — sees all orgs' dependencies)", async () => {
    const res = await pool.query("SELECT DISTINCT organization_id FROM dependencies");
    const orgs = res.rows.map((r) => r.organization_id);
    expect(orgs).toContain(seed.orgA.id);
    expect(orgs).toContain(seed.orgB.id);
  });
});
