/**
 * signalControlLinksRls.test.ts — A04-G1: DB-layer RLS enforcement on
 * `signal_control_links` (migration 20260702_signal_control_links_rls.sql).
 *
 * Mirror of signalVendorLinksRls.test.ts. The table's whole route family
 * (signalControlLinks.ts) is asTenant()-wrapped and the table is written only by
 * those routes, so the policy preserves the "policy ⟹ routes wrapped" invariant.
 * Link rows are org-owned (organization_id NOT NULL).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { bootstrapTestDb, type TestDbSeed } from "./testDb.js";

let seed: TestDbSeed;
let pool: Pool;
let linkA: string;
let signalA: string;
let controlA: string;
let signalB: string;
let controlB: string;

async function seedSignal(p: Pool, orgId: string, dedup: string): Promise<string> {
  const r = await p.query<{ id: string }>(
    `INSERT INTO cyber_signals
       (organization_id, source, signal_type, severity, normalized_summary, dedup_hash)
     VALUES ($1, 'test', 'breach', 'High', 'rls harness signal', $2)
     RETURNING id`,
    [orgId, dedup],
  );
  return r.rows[0].id;
}

async function seedControl(p: Pool, orgId: string, name: string): Promise<string> {
  const r = await p.query<{ id: string }>(
    `INSERT INTO controls (organization_id, name) VALUES ($1, $2) RETURNING id`,
    [orgId, name],
  );
  return r.rows[0].id;
}

const INSERT_LINK = `INSERT INTO signal_control_links
    (organization_id, signal_id, control_id, note)
  VALUES ($1, $2, $3, 'rls harness link')
  RETURNING id`;

beforeAll(async () => {
  seed = await bootstrapTestDb();

  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the signal_control_links RLS test.");
  pool = new Pool({ connectionString: url, ssl: false });

  signalA = await seedSignal(pool, seed.orgA.id, "rls-scl-a");
  controlA = await seedControl(pool, seed.orgA.id, "SCL Org A control");
  signalB = await seedSignal(pool, seed.orgB.id, "rls-scl-b");
  controlB = await seedControl(pool, seed.orgB.id, "SCL Org B control");

  const a = await pool.query(INSERT_LINK, [seed.orgA.id, signalA, controlA]);
  linkA = a.rows[0].id as string;
  await pool.query(INSERT_LINK, [seed.orgB.id, signalB, controlB]);
}, 120_000);

afterAll(async () => { await pool?.end(); });

describe("A04-G1 — signal_control_links RLS enforcement", () => {
  it("app_request scoped to org A cannot see org B's links, and sees its own", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgA.id]);

      const crossOrg = await client.query(
        "SELECT id FROM signal_control_links WHERE organization_id = $1",
        [seed.orgB.id],
      );
      expect(crossOrg.rowCount).toBe(0);

      const visible = await client.query("SELECT organization_id FROM signal_control_links");
      const orgs = visible.rows.map((r) => r.organization_id);
      expect(orgs).toContain(seed.orgA.id);
      expect(orgs).not.toContain(seed.orgB.id);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("app_request scoped to org A can INSERT a link for org A (positive write)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgA.id]);

      await client.query("UPDATE signal_control_links SET deleted_at = NOW() WHERE id = $1", [linkA]);
      const inserted = await client.query(INSERT_LINK, [seed.orgA.id, signalA, controlA]);
      expect(inserted.rowCount).toBe(1);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("app_request scoped to org B cannot UPDATE or DELETE org A's link (rowCount 0, DB-enforced)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgB.id]);

      const upd = await client.query("UPDATE signal_control_links SET note = 'hijacked' WHERE id = $1", [linkA]);
      expect(upd.rowCount).toBe(0);
      const del = await client.query("UPDATE signal_control_links SET deleted_at = NOW() WHERE id = $1", [linkA]);
      expect(del.rowCount).toBe(0);
      const hardDel = await client.query("DELETE FROM signal_control_links WHERE id = $1", [linkA]);
      expect(hardDel.rowCount).toBe(0);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("app_request with an UNSET org GUC sees zero links (fail-closed default)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      const res = await client.query("SELECT id FROM signal_control_links");
      expect(res.rowCount).toBe(0);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("app_request with an EMPTY-STRING org GUC sees zero links (NULLIF fail-closed)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', '', true)");
      const res = await client.query("SELECT id FROM signal_control_links");
      expect(res.rowCount).toBe(0);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("app_request scoped to org A cannot INSERT a link stamped for org B (WITH CHECK)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgA.id]);

      await expect(
        client.query(INSERT_LINK, [seed.orgB.id, signalB, controlB]),
      ).rejects.toThrow(/row-level security/i);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("the owner connection bypasses RLS (regression — sees all orgs' links)", async () => {
    const res = await pool.query("SELECT DISTINCT organization_id FROM signal_control_links");
    const orgs = res.rows.map((r) => r.organization_id);
    expect(orgs).toContain(seed.orgA.id);
    expect(orgs).toContain(seed.orgB.id);
  });
});
