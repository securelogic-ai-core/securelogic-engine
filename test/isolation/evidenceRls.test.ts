/**
 * evidenceRls.test.ts — A04-G1: DB-layer RLS enforcement on
 * `evidence` (migration 20260705_evidence_rls.sql).
 *
 * Written only by evidence.ts (POST /evidence INSERT, asTenant()-wrapped).
 * Read by evidence.ts (asTenant() GET list / GET :id), dashboard.ts (asTenant()
 * evidence-count read), and auditPackage.ts (withTenant() control-test read) —
 * all carry an explicit organization_id predicate. No UPDATE/DELETE in app code.
 * organization_id NOT NULL.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { bootstrapTestDb, type TestDbSeed } from "./testDb.js";

let seed: TestDbSeed;
let pool: Pool;
let evidenceA: string;

// source_type and evidence_type must satisfy the CHECK constraints from
// 20260420_evidence_primitives.sql; title must be non-empty.
const INSERT_EVIDENCE = `INSERT INTO evidence
  (organization_id, source_type, source_id, title, evidence_type)
  VALUES ($1, 'control_test', gen_random_uuid(), 'RLS test evidence', 'document')
  RETURNING id`;

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the evidence RLS test.");
  pool = new Pool({ connectionString: url, ssl: false });
  const a = await pool.query(INSERT_EVIDENCE, [seed.orgA.id]);
  evidenceA = a.rows[0].id as string;
  await pool.query(INSERT_EVIDENCE, [seed.orgB.id]);
}, 120_000);

afterAll(async () => { await pool?.end(); });

describe("A04-G1 — evidence RLS enforcement", () => {
  it("app_request scoped to org A cannot see org B's evidence, and sees its own", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgA.id]);
      const crossOrg = await client.query(
        "SELECT id FROM evidence WHERE organization_id = $1", [seed.orgB.id]);
      expect(crossOrg.rowCount).toBe(0);
      const visible = await client.query("SELECT organization_id FROM evidence");
      const orgs = visible.rows.map((r) => r.organization_id);
      expect(orgs).toContain(seed.orgA.id);
      expect(orgs).not.toContain(seed.orgB.id);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("app_request scoped to org A can INSERT evidence for org A (positive write)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgA.id]);
      const inserted = await client.query(INSERT_EVIDENCE, [seed.orgA.id]);
      expect(inserted.rowCount).toBe(1);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("app_request scoped to org B cannot UPDATE or DELETE org A's evidence (rowCount 0)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgB.id]);
      const upd = await client.query(
        "UPDATE evidence SET title = 'changed' WHERE id = $1", [evidenceA]);
      expect(upd.rowCount).toBe(0);
      const del = await client.query("DELETE FROM evidence WHERE id = $1", [evidenceA]);
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
      const res = await client.query("SELECT id FROM evidence");
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
      const res = await client.query("SELECT id FROM evidence");
      expect(res.rowCount).toBe(0);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("app_request scoped to org A cannot INSERT evidence stamped for org B (WITH CHECK)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgA.id]);
      await expect(
        client.query(INSERT_EVIDENCE, [seed.orgB.id]),
      ).rejects.toThrow(/row-level security/i);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("the owner connection bypasses RLS (regression — sees all orgs' evidence)", async () => {
    const res = await pool.query("SELECT DISTINCT organization_id FROM evidence");
    const orgs = res.rows.map((r) => r.organization_id);
    expect(orgs).toContain(seed.orgA.id);
    expect(orgs).toContain(seed.orgB.id);
  });
});
