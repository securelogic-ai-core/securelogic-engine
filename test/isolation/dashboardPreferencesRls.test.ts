/**
 * dashboardPreferencesRls.test.ts — A04-G1: DB-layer RLS enforcement on
 * `dashboard_preferences` (migration 20260703_dashboard_preferences_rls.sql).
 *
 * The table is read+written only by dashboardPreferences.ts, whose 5-handler
 * route family is asTenant()-wrapped. Every row carries organization_id (NOT
 * NULL) — personal rows and org_default rows (user_id NULL) alike — so the
 * org-scoped policy covers all rows. Cert seeds org_default rows (user_id NULL)
 * to avoid the users FK.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { bootstrapTestDb, type TestDbSeed } from "./testDb.js";

let seed: TestDbSeed;
let pool: Pool;
let prefA: string;

const INSERT_ORG_DEFAULT = `INSERT INTO dashboard_preferences
    (organization_id, user_id, preference_type, layout)
  VALUES ($1, NULL, 'org_default', '[]'::jsonb)
  RETURNING id`;

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the dashboard_preferences RLS test.");
  pool = new Pool({ connectionString: url, ssl: false });
  const a = await pool.query(INSERT_ORG_DEFAULT, [seed.orgA.id]);
  prefA = a.rows[0].id as string;
  await pool.query(INSERT_ORG_DEFAULT, [seed.orgB.id]);
}, 120_000);

afterAll(async () => { await pool?.end(); });

describe("A04-G1 — dashboard_preferences RLS enforcement", () => {
  it("app_request scoped to org A cannot see org B's prefs, and sees its own", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgA.id]);

      const crossOrg = await client.query(
        "SELECT id FROM dashboard_preferences WHERE organization_id = $1", [seed.orgB.id]);
      expect(crossOrg.rowCount).toBe(0);

      const visible = await client.query("SELECT organization_id FROM dashboard_preferences");
      const orgs = visible.rows.map((r) => r.organization_id);
      expect(orgs).toContain(seed.orgA.id);
      expect(orgs).not.toContain(seed.orgB.id);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("app_request scoped to org A can INSERT an org_default pref for org A (positive write)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgA.id]);
      await client.query("DELETE FROM dashboard_preferences WHERE id = $1", [prefA]);
      const inserted = await client.query(INSERT_ORG_DEFAULT, [seed.orgA.id]);
      expect(inserted.rowCount).toBe(1);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("app_request scoped to org B cannot UPDATE or DELETE org A's pref (rowCount 0)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgB.id]);
      const upd = await client.query(
        "UPDATE dashboard_preferences SET layout = '[{}]'::jsonb WHERE id = $1", [prefA]);
      expect(upd.rowCount).toBe(0);
      const del = await client.query("DELETE FROM dashboard_preferences WHERE id = $1", [prefA]);
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
      const res = await client.query("SELECT id FROM dashboard_preferences");
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
      const res = await client.query("SELECT id FROM dashboard_preferences");
      expect(res.rowCount).toBe(0);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("app_request scoped to org A cannot INSERT a pref stamped for org B (WITH CHECK)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgA.id]);
      await expect(
        client.query(INSERT_ORG_DEFAULT, [seed.orgB.id]),
      ).rejects.toThrow(/row-level security/i);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("the owner connection bypasses RLS (regression — sees all orgs' prefs)", async () => {
    const res = await pool.query("SELECT DISTINCT organization_id FROM dashboard_preferences");
    const orgs = res.rows.map((r) => r.organization_id);
    expect(orgs).toContain(seed.orgA.id);
    expect(orgs).toContain(seed.orgB.id);
  });
});
