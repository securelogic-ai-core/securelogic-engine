/**
 * assessmentsRls.test.ts — A04-G1: DB-layer RLS enforcement on
 * `assessments` (migration 20260704_assessments_rls.sql).
 *
 * Written only by assess.ts (POST /assess persists inside withTenant(orgId);
 * the persistAssessment() explicit-tx pg.connect() nests as savepoints). Read
 * only by assessments.ts (asTenant()-wrapped GET list / GET :id).
 * organization_id NOT NULL.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { bootstrapTestDb, type TestDbSeed } from "./testDb.js";

let seed: TestDbSeed;
let pool: Pool;
let assessmentA: string;

const INSERT_ASSESSMENT = `INSERT INTO assessments (organization_id, type, framework)
  VALUES ($1, 'internal_posture', 'NIST') RETURNING id`;

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the assessments RLS test.");
  pool = new Pool({ connectionString: url, ssl: false });
  const a = await pool.query(INSERT_ASSESSMENT, [seed.orgA.id]);
  assessmentA = a.rows[0].id as string;
  await pool.query(INSERT_ASSESSMENT, [seed.orgB.id]);
}, 120_000);

afterAll(async () => { await pool?.end(); });

describe("A04-G1 — assessments RLS enforcement", () => {
  it("app_request scoped to org A cannot see org B's assessments, and sees its own", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgA.id]);
      const crossOrg = await client.query(
        "SELECT id FROM assessments WHERE organization_id = $1", [seed.orgB.id]);
      expect(crossOrg.rowCount).toBe(0);
      const visible = await client.query("SELECT organization_id FROM assessments");
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
      const inserted = await client.query(INSERT_ASSESSMENT, [seed.orgA.id]);
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
        "UPDATE assessments SET status = 'completed' WHERE id = $1", [assessmentA]);
      expect(upd.rowCount).toBe(0);
      const del = await client.query("DELETE FROM assessments WHERE id = $1", [assessmentA]);
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
      const res = await client.query("SELECT id FROM assessments");
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
      const res = await client.query("SELECT id FROM assessments");
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
        client.query(INSERT_ASSESSMENT, [seed.orgB.id]),
      ).rejects.toThrow(/row-level security/i);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("the owner connection bypasses RLS (regression — sees all orgs' assessments)", async () => {
    const res = await pool.query("SELECT DISTINCT organization_id FROM assessments");
    const orgs = res.rows.map((r) => r.organization_id);
    expect(orgs).toContain(seed.orgA.id);
    expect(orgs).toContain(seed.orgB.id);
  });
});
