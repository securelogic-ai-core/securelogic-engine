/**
 * risksRls.test.ts — A04-G1 Batch A.1: DB-layer RLS enforcement on `risks`
 * (migration 20260620_batch_a1_rls_policies.sql).
 *
 * This is the test that ACTUALLY CERTIFIES cross-org isolation for `risks` at
 * the database layer. The γ.1 wrap PR (risksTenantWrap.test.ts) proved the
 * route sets the GUC and runs in a per-request transaction, but explicitly
 * deferred RLS certification to Batch A — its cross-org checks were
 * WHERE-clause assertions, not DB-enforced. Here the policy filters at the
 * engine level: even a query with NO `WHERE organization_id` only sees its own
 * org's rows, and an UPDATE/DELETE aimed at another org's row affects zero rows.
 *
 * Why no app_request password is needed — see findingsRls.test.ts. The harness
 * DB connects as the Postgres superuser, which can `SET ROLE app_request`
 * (NOBYPASSRLS, non-owner) without the role's password. The app_request role
 * exists because bootstrapTestDb applies the full migration set (incl.
 * 20260618_create_app_request_role.sql and the Batch A.1 policy migration).
 *
 * Mechanics: every scoped assertion runs inside BEGIN … ROLLBACK with
 * `SET LOCAL ROLE app_request` (tx-scoped role) and a tx-local GUC via
 * set_config(…, true). ROLLBACK reverts both — no state leaks between cases.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { bootstrapTestDb, seedRisk, type TestDbSeed } from "./testDb.js";

let seed: TestDbSeed;
let pool: Pool;
let riskA: string;
let riskB: string;

/** A valid risks INSERT for `org`, mirroring seedRisk's constraint-satisfying
 *  column set. Only RLS (not a CHECK constraint) should ever reject it. */
const INSERT_RISK = `INSERT INTO risks
    (organization_id, title, domain, likelihood, impact, risk_rating, residual_rating, status)
  VALUES ($1, 'rls-test risk', 'Vendor Risk', 'possible', 'High', 'High', 'High', 'open')
  RETURNING id`;

beforeAll(async () => {
  // Drops + applies the full migration set (creates app_request, enables RLS on
  // risks via the Batch A.1 migration) + seeds the two orgs.
  seed = await bootstrapTestDb();

  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error("TEST_DATABASE_URL is not set for the risks RLS test.");
  }
  // Own pool, connected as the harness superuser (same URL the harness uses).
  pool = new Pool({ connectionString: url, ssl: false });

  // Seed one risk per org as the owner (RLS bypassed for seeding).
  riskA = await seedRisk(pool, seed.orgA.id, { title: "Org A risk" });
  riskB = await seedRisk(pool, seed.orgB.id, { title: "Org B risk" });
}, 120_000);

afterAll(async () => {
  await pool?.end();
});

describe("A04-G1 Batch A.1 — risks RLS enforcement", () => {
  it("app_request scoped to org A cannot see org B's risks, and sees its own", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [
        seed.orgA.id,
      ]);

      // Even an explicit WHERE for org B returns nothing — the policy filters first.
      const crossOrg = await client.query(
        "SELECT id FROM risks WHERE organization_id = $1",
        [seed.orgB.id],
      );
      expect(crossOrg.rowCount).toBe(0);

      // Positive control: an unfiltered read returns ONLY org A's row.
      const visible = await client.query("SELECT id FROM risks");
      const ids = visible.rows.map((r) => r.id);
      expect(ids).toContain(riskA);
      expect(ids).not.toContain(riskB);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("app_request scoped to org A can INSERT a risk for org A and read it back (positive write)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [
        seed.orgA.id,
      ]);

      const inserted = await client.query(INSERT_RISK, [seed.orgA.id]);
      expect(inserted.rowCount).toBe(1);
      const newId = inserted.rows[0].id as string;

      const readBack = await client.query("SELECT id FROM risks WHERE id = $1", [
        newId,
      ]);
      expect(readBack.rowCount).toBe(1);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("app_request scoped to org B cannot UPDATE or DELETE org A's risk (rowCount 0, DB-enforced)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [
        seed.orgB.id,
      ]);

      // org A's row is invisible to the USING clause → both statements match
      // zero rows even though riskA exists (proven by the owner-bypass case).
      const upd = await client.query(
        "UPDATE risks SET title = 'hijacked' WHERE id = $1",
        [riskA],
      );
      expect(upd.rowCount).toBe(0);

      const del = await client.query("DELETE FROM risks WHERE id = $1", [riskA]);
      expect(del.rowCount).toBe(0);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("app_request with an UNSET org GUC sees zero risks (fail-closed default)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      // Deliberately do NOT set app.current_org_id.
      const res = await client.query("SELECT id FROM risks");
      expect(res.rowCount).toBe(0);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("app_request with an EMPTY-STRING org GUC sees zero risks (NULLIF fail-closed, never permissive)", async () => {
    // Pins the NULLIF(…, '') contract: a reset/empty GUC collapses to NULL →
    // zero rows, and does NOT 500 on ''::uuid. Same machinery as the unset case.
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', '', true)");

      const res = await client.query("SELECT id FROM risks");
      expect(res.rowCount).toBe(0);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("app_request scoped to org A cannot INSERT a risk stamped for org B (WITH CHECK)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [
        seed.orgA.id,
      ]);

      await expect(
        client.query(INSERT_RISK, [seed.orgB.id]),
      ).rejects.toThrow(/row-level security/i);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("the owner connection bypasses RLS (regression — sees all orgs' risks)", async () => {
    const res = await pool.query("SELECT id FROM risks");
    const ids = res.rows.map((r) => r.id);
    expect(ids).toContain(riskA);
    expect(ids).toContain(riskB);
  });
});
