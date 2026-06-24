/**
 * riskTreatmentsRls.test.ts — A04-G1: DB-layer RLS enforcement on
 * `risk_treatments` (migration 20260703_risk_treatments_rls.sql).
 *
 * Written only by riskTreatments.ts (asTenant()-wrapped, incl. explicit-tx
 * POST/PATCH). Other readers (risks, evidence, intelligence) read inside their
 * wrapped handlers. organization_id NOT NULL; risk_id FKs to risks (seeded here).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { bootstrapTestDb, type TestDbSeed } from "./testDb.js";

let seed: TestDbSeed;
let pool: Pool;
let treatmentA: string;
let riskA: string;
let riskB: string;

async function seedRisk(p: Pool, orgId: string, title: string): Promise<string> {
  const r = await p.query<{ id: string }>(
    `INSERT INTO risks (organization_id, title, domain, likelihood, impact, risk_rating, residual_rating, status)
     VALUES ($1, $2, 'Vendor Risk', 'possible', 'High', 'High', 'High', 'open') RETURNING id`,
    [orgId, title],
  );
  return r.rows[0].id;
}

const INSERT_TREATMENT = `INSERT INTO risk_treatments (organization_id, risk_id)
  VALUES ($1, $2) RETURNING id`;

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the risk_treatments RLS test.");
  pool = new Pool({ connectionString: url, ssl: false });
  riskA = await seedRisk(pool, seed.orgA.id, "RLS risk A");
  riskB = await seedRisk(pool, seed.orgB.id, "RLS risk B");
  const a = await pool.query(INSERT_TREATMENT, [seed.orgA.id, riskA]);
  treatmentA = a.rows[0].id as string;
  await pool.query(INSERT_TREATMENT, [seed.orgB.id, riskB]);
}, 120_000);

afterAll(async () => { await pool?.end(); });

describe("A04-G1 — risk_treatments RLS enforcement", () => {
  it("app_request scoped to org A cannot see org B's treatments, and sees its own", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgA.id]);
      const crossOrg = await client.query(
        "SELECT id FROM risk_treatments WHERE organization_id = $1", [seed.orgB.id]);
      expect(crossOrg.rowCount).toBe(0);
      const visible = await client.query("SELECT organization_id FROM risk_treatments");
      const orgs = visible.rows.map((r) => r.organization_id);
      expect(orgs).toContain(seed.orgA.id);
      expect(orgs).not.toContain(seed.orgB.id);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("app_request scoped to org A can INSERT a treatment for org A (positive write)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgA.id]);
      const inserted = await client.query(INSERT_TREATMENT, [seed.orgA.id, riskA]);
      expect(inserted.rowCount).toBe(1);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("app_request scoped to org B cannot UPDATE or DELETE org A's treatment (rowCount 0)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgB.id]);
      const upd = await client.query(
        "UPDATE risk_treatments SET status = 'in_progress' WHERE id = $1", [treatmentA]);
      expect(upd.rowCount).toBe(0);
      const del = await client.query("DELETE FROM risk_treatments WHERE id = $1", [treatmentA]);
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
      const res = await client.query("SELECT id FROM risk_treatments");
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
      const res = await client.query("SELECT id FROM risk_treatments");
      expect(res.rowCount).toBe(0);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("app_request scoped to org A cannot INSERT a treatment stamped for org B (WITH CHECK)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgA.id]);
      await expect(
        client.query(INSERT_TREATMENT, [seed.orgB.id, riskB]),
      ).rejects.toThrow(/row-level security/i);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("the owner connection bypasses RLS (regression — sees all orgs' treatments)", async () => {
    const res = await pool.query("SELECT DISTINCT organization_id FROM risk_treatments");
    const orgs = res.rows.map((r) => r.organization_id);
    expect(orgs).toContain(seed.orgA.id);
    expect(orgs).toContain(seed.orgB.id);
  });
});
