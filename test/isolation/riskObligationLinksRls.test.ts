/**
 * riskObligationLinksRls.test.ts — A04-G1: DB-layer RLS enforcement on
 * `risk_obligation_links` (migration 20260701_risk_obligation_links_rls.sql).
 *
 * Certifies cross-org isolation at the database layer. The table's whole route
 * family (riskObligationLinks.ts) is asTenant()-wrapped as of Wave 0d (all four
 * handlers; DELETE's terminal moved 204.send → 200.json), so the policy preserves
 * the "policy ⟹ routes wrapped" invariant. Mirror of riskControlLinksRls.test.ts.
 *
 * bootstrapTestDb applies the full migration set (app_request role + this policy).
 * Every scoped case runs inside BEGIN … ROLLBACK with SET LOCAL ROLE app_request
 * + a tx-local GUC via set_config(…, true).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { bootstrapTestDb, seedRisk, type TestDbSeed } from "./testDb.js";

let seed: TestDbSeed;
let pool: Pool;
let linkA: string;
let riskA: string;
let obligationA: string;
let riskB: string;
let obligationB: string;

/** Seed one obligation for an org (organization_id + title are NOT NULL). */
async function seedObligation(p: Pool, orgId: string, title: string): Promise<string> {
  const r = await p.query<{ id: string }>(
    `INSERT INTO obligations (organization_id, title) VALUES ($1, $2) RETURNING id`,
    [orgId, title],
  );
  return r.rows[0].id;
}

/** A constraint-satisfying risk_obligation_links INSERT. Only RLS should reject it. */
const INSERT_LINK = `INSERT INTO risk_obligation_links
    (organization_id, risk_id, obligation_id, note)
  VALUES ($1, $2, $3, 'rls harness link')
  RETURNING id`;

beforeAll(async () => {
  seed = await bootstrapTestDb();

  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the risk_obligation_links RLS test.");
  pool = new Pool({ connectionString: url, ssl: false });

  // Seed as the owner (RLS bypassed): a risk + obligation + link per org.
  riskA = await seedRisk(pool, seed.orgA.id, { title: "ROL Org A risk" });
  obligationA = await seedObligation(pool, seed.orgA.id, "ROL Org A obligation");
  riskB = await seedRisk(pool, seed.orgB.id, { title: "ROL Org B risk" });
  obligationB = await seedObligation(pool, seed.orgB.id, "ROL Org B obligation");

  const a = await pool.query(INSERT_LINK, [seed.orgA.id, riskA, obligationA]);
  linkA = a.rows[0].id as string;
  await pool.query(INSERT_LINK, [seed.orgB.id, riskB, obligationB]);
}, 120_000);

afterAll(async () => { await pool?.end(); });

describe("A04-G1 — risk_obligation_links RLS enforcement", () => {
  it("app_request scoped to org A cannot see org B's links, and sees its own", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgA.id]);

      const crossOrg = await client.query(
        "SELECT id FROM risk_obligation_links WHERE organization_id = $1",
        [seed.orgB.id],
      );
      expect(crossOrg.rowCount).toBe(0);

      const visible = await client.query("SELECT organization_id FROM risk_obligation_links");
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

      // Soft-delete the seeded link first so the partial unique index does not collide.
      await client.query("UPDATE risk_obligation_links SET deleted_at = NOW() WHERE id = $1", [linkA]);
      const inserted = await client.query(INSERT_LINK, [seed.orgA.id, riskA, obligationA]);
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

      const upd = await client.query("UPDATE risk_obligation_links SET note = 'hijacked' WHERE id = $1", [linkA]);
      expect(upd.rowCount).toBe(0);
      const del = await client.query("UPDATE risk_obligation_links SET deleted_at = NOW() WHERE id = $1", [linkA]);
      expect(del.rowCount).toBe(0);
      const hardDel = await client.query("DELETE FROM risk_obligation_links WHERE id = $1", [linkA]);
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
      const res = await client.query("SELECT id FROM risk_obligation_links");
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
      const res = await client.query("SELECT id FROM risk_obligation_links");
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
        client.query(INSERT_LINK, [seed.orgB.id, riskB, obligationB]),
      ).rejects.toThrow(/row-level security/i);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("the owner connection bypasses RLS (regression — sees all orgs' links)", async () => {
    const res = await pool.query("SELECT DISTINCT organization_id FROM risk_obligation_links");
    const orgs = res.rows.map((r) => r.organization_id);
    expect(orgs).toContain(seed.orgA.id);
    expect(orgs).toContain(seed.orgB.id);
  });
});
