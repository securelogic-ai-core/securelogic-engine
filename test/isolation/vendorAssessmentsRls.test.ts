/**
 * vendorAssessmentsRls.test.ts — A04-G1: DB-layer RLS enforcement on
 * `vendor_assessments` (migration 20260630_vendor_assessments_rls.sql).
 *
 * Certifies cross-org isolation for vendor_assessments at the database layer.
 * The table's route family (vendorAssessments.ts) is fully asTenant()-wrapped
 * (γ.3), so adding the policy keeps the "policy ⟹ routes wrapped" invariant —
 * no post-flip silent-zero-rows hazard. Mirrors risksRls.test.ts exactly.
 *
 * No app_request password needed — the harness superuser SET ROLE app_request
 * (NOBYPASSRLS, non-owner). bootstrapTestDb applies the full migration set
 * (app_request role + this policy). Every scoped case runs inside
 * BEGIN … ROLLBACK with SET LOCAL ROLE + a tx-local GUC via set_config(…, true).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { bootstrapTestDb, seedVendor, type TestDbSeed } from "./testDb.js";

let seed: TestDbSeed;
let pool: Pool;
let assessmentA: string;
let vendorA: string;
let vendorB: string;

/** A constraint-satisfying vendor_assessments INSERT for (org, vendor). Only RLS should reject it. */
const INSERT_ASSESSMENT = `INSERT INTO vendor_assessments
    (organization_id, vendor_id, assessment_type, overall_severity)
  VALUES ($1, $2, 'security', 'High')
  RETURNING id`;

beforeAll(async () => {
  seed = await bootstrapTestDb();

  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the vendor_assessments RLS test.");
  pool = new Pool({ connectionString: url, ssl: false });

  // Seed a vendor + assessment per org as the owner (RLS bypassed for seeding).
  vendorA = await seedVendor(pool, seed.orgA.id, { name: "VA Org A vendor" });
  vendorB = await seedVendor(pool, seed.orgB.id, { name: "VA Org B vendor" });
  const a = await pool.query(INSERT_ASSESSMENT, [seed.orgA.id, vendorA]);
  assessmentA = a.rows[0].id as string;
  await pool.query(INSERT_ASSESSMENT, [seed.orgB.id, vendorB]);
}, 120_000);

afterAll(async () => { await pool?.end(); });

describe("A04-G1 — vendor_assessments RLS enforcement", () => {
  it("app_request scoped to org A cannot see org B's assessments, and sees its own", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgA.id]);

      const crossOrg = await client.query(
        "SELECT id FROM vendor_assessments WHERE organization_id = $1",
        [seed.orgB.id],
      );
      expect(crossOrg.rowCount).toBe(0);

      const visible = await client.query("SELECT organization_id FROM vendor_assessments");
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

      const inserted = await client.query(INSERT_ASSESSMENT, [seed.orgA.id, vendorA]);
      expect(inserted.rowCount).toBe(1);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("app_request scoped to org B cannot UPDATE or DELETE org A's assessment (rowCount 0, DB-enforced)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgB.id]);

      const upd = await client.query("UPDATE vendor_assessments SET summary = 'hijacked' WHERE id = $1", [assessmentA]);
      expect(upd.rowCount).toBe(0);
      const del = await client.query("DELETE FROM vendor_assessments WHERE id = $1", [assessmentA]);
      expect(del.rowCount).toBe(0);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("app_request with an UNSET org GUC sees zero assessments (fail-closed default)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      const res = await client.query("SELECT id FROM vendor_assessments");
      expect(res.rowCount).toBe(0);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("app_request with an EMPTY-STRING org GUC sees zero assessments (NULLIF fail-closed)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', '', true)");
      const res = await client.query("SELECT id FROM vendor_assessments");
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
        client.query(INSERT_ASSESSMENT, [seed.orgB.id, vendorB]),
      ).rejects.toThrow(/row-level security/i);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("the owner connection bypasses RLS (regression — sees all orgs' assessments)", async () => {
    const res = await pool.query("SELECT DISTINCT organization_id FROM vendor_assessments");
    const orgs = res.rows.map((r) => r.organization_id);
    expect(orgs).toContain(seed.orgA.id);
    expect(orgs).toContain(seed.orgB.id);
  });
});
