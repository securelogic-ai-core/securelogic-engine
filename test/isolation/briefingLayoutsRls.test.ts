/**
 * briefingLayoutsRls.test.ts — A04-G1: DB-layer RLS enforcement on
 * `briefing_layouts` (migration 20260721_briefing_layouts.sql).
 *
 * The table is read+written only by briefingLayouts.ts, whose 3-handler route
 * family is asTenant()-wrapped. Every row carries organization_id NOT NULL and
 * user_id NOT NULL; the org-scoped NULLIF policy covers all rows (cross-USER
 * isolation within an org is route-enforced — see briefingLayouts.test.ts).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { bootstrapTestDb, seedUser, type TestDbSeed } from "./testDb.js";

let seed: TestDbSeed;
let pool: Pool;
let layoutA: string;
let userAId: string;
let userBId: string;

const ENVELOPE = JSON.stringify({
  version: 1,
  modules: [{ moduleId: "my_work", instanceKey: "my_work", config: {} }],
});

const INSERT = `INSERT INTO briefing_layouts (organization_id, user_id, layout)
  VALUES ($1, $2, $3::jsonb) RETURNING id`;

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the briefing_layouts RLS test.");
  pool = new Pool({ connectionString: url, ssl: false });
  userAId = (await seedUser(pool, seed.orgA.id, {})).id;
  userBId = (await seedUser(pool, seed.orgB.id, {})).id;
  layoutA = (await pool.query(INSERT, [seed.orgA.id, userAId, ENVELOPE])).rows[0].id as string;
  await pool.query(INSERT, [seed.orgB.id, userBId, ENVELOPE]);
}, 120_000);

afterAll(async () => { await pool?.end(); });

describe("A04-G1 — briefing_layouts RLS enforcement", () => {
  it("app_request scoped to org A cannot see org B's layouts, and sees its own", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgA.id]);

      const crossOrg = await client.query(
        "SELECT id FROM briefing_layouts WHERE organization_id = $1", [seed.orgB.id]);
      expect(crossOrg.rowCount).toBe(0);

      const visible = await client.query("SELECT organization_id FROM briefing_layouts");
      const orgs = visible.rows.map((r) => r.organization_id);
      expect(orgs).toContain(seed.orgA.id);
      expect(orgs).not.toContain(seed.orgB.id);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("app_request scoped to org B cannot UPDATE or DELETE org A's layout (rowCount 0)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgB.id]);
      const upd = await client.query(
        "UPDATE briefing_layouts SET layout = $2::jsonb WHERE id = $1", [layoutA, ENVELOPE]);
      expect(upd.rowCount).toBe(0);
      const del = await client.query("DELETE FROM briefing_layouts WHERE id = $1", [layoutA]);
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
      const res = await client.query("SELECT id FROM briefing_layouts");
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
      const res = await client.query("SELECT id FROM briefing_layouts");
      expect(res.rowCount).toBe(0);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("app_request scoped to org A cannot INSERT a layout stamped for org B (WITH CHECK)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgA.id]);
      await expect(
        client.query(INSERT, [seed.orgB.id, userBId, ENVELOPE]),
      ).rejects.toThrow(/row-level security/i);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("the owner connection bypasses RLS (regression — sees all orgs' layouts)", async () => {
    const res = await pool.query("SELECT DISTINCT organization_id FROM briefing_layouts");
    const orgs = res.rows.map((r) => r.organization_id);
    expect(orgs).toContain(seed.orgA.id);
    expect(orgs).toContain(seed.orgB.id);
  });
});
