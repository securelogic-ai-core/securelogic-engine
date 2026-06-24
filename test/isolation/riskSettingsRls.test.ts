/**
 * riskSettingsRls.test.ts — A04-G1: DB-layer RLS enforcement on `risk_settings`
 * (migration 20260703_risk_settings_rls.sql).
 *
 * The route family (riskSettings.ts GET + PUT) is asTenant()-wrapped; the other
 * reader (risks.ts) reads inside an asTenant()-wrapped handler. One row per org
 * (organization_id NOT NULL + UNIQUE).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { bootstrapTestDb, type TestDbSeed } from "./testDb.js";

let seed: TestDbSeed;
let pool: Pool;

const CADENCE = JSON.stringify({ Critical: 30, High: 60, Moderate: 90, Low: 180 });

const INSERT_SETTINGS = `INSERT INTO risk_settings (organization_id, cadence_by_rating)
  VALUES ($1, $2::jsonb) RETURNING id`;

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the risk_settings RLS test.");
  pool = new Pool({ connectionString: url, ssl: false });
  await pool.query(INSERT_SETTINGS, [seed.orgA.id, CADENCE]);
  await pool.query(INSERT_SETTINGS, [seed.orgB.id, CADENCE]);
}, 120_000);

afterAll(async () => { await pool?.end(); });

describe("A04-G1 — risk_settings RLS enforcement", () => {
  it("app_request scoped to org A cannot see org B's settings, and sees its own", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgA.id]);

      const crossOrg = await client.query(
        "SELECT id FROM risk_settings WHERE organization_id = $1", [seed.orgB.id]);
      expect(crossOrg.rowCount).toBe(0);

      const visible = await client.query("SELECT organization_id FROM risk_settings");
      const orgs = visible.rows.map((r) => r.organization_id);
      expect(orgs).toContain(seed.orgA.id);
      expect(orgs).not.toContain(seed.orgB.id);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("app_request scoped to org A can UPDATE its own settings row (positive write)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgA.id]);
      const upd = await client.query(
        "UPDATE risk_settings SET updated_at = NOW() WHERE organization_id = $1", [seed.orgA.id]);
      expect(upd.rowCount).toBe(1);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("app_request scoped to org B cannot UPDATE or DELETE org A's settings (rowCount 0)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgB.id]);
      const upd = await client.query(
        "UPDATE risk_settings SET cadence_by_rating = '{}'::jsonb WHERE organization_id = $1", [seed.orgA.id]);
      expect(upd.rowCount).toBe(0);
      const del = await client.query("DELETE FROM risk_settings WHERE organization_id = $1", [seed.orgA.id]);
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
      const res = await client.query("SELECT id FROM risk_settings");
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
      const res = await client.query("SELECT id FROM risk_settings");
      expect(res.rowCount).toBe(0);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("app_request scoped to org A cannot INSERT settings stamped for org B (WITH CHECK)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgA.id]);
      await expect(
        client.query("INSERT INTO risk_settings (organization_id, cadence_by_rating) VALUES ($1, $2::jsonb)",
          [seed.orgB.id, CADENCE]),
      ).rejects.toThrow(/row-level security/i);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("the owner connection bypasses RLS (regression — sees all orgs' settings)", async () => {
    const res = await pool.query("SELECT DISTINCT organization_id FROM risk_settings");
    const orgs = res.rows.map((r) => r.organization_id);
    expect(orgs).toContain(seed.orgA.id);
    expect(orgs).toContain(seed.orgB.id);
  });
});
