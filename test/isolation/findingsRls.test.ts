/**
 * findingsRls.test.ts — A04-G1 phase 2 pilot: DB-layer RLS enforcement on
 * `findings` (migration 20260619_findings_rls_pilot.sql).
 *
 * Unlike crossOrgIsolation.test.ts (which drives the app over HTTP to prove
 * APP-layer scoping), this proves DATABASE-layer enforcement: even a connection
 * that issues a query with NO `WHERE organization_id` filter only sees its own
 * org's rows, because the RLS policy filters at the engine level.
 *
 * Why no app_request password is needed
 * -------------------------------------
 * The harness DB connects as the Postgres superuser (CI: POSTGRES_USER=harness).
 * A superuser can `SET ROLE app_request` WITHOUT the target role's password.
 * After the switch the current role is app_request — NOBYPASSRLS and not the
 * table owner — so RLS policies apply. The app_request role itself exists
 * because bootstrapTestDb applies the full migration set, including
 * 20260618_create_app_request_role.sql. This makes the test fully runnable in
 * CI today, ahead of any operator-side DATABASE_URL flip.
 *
 * Mechanics: every scoped assertion runs inside BEGIN … ROLLBACK with
 * `SET LOCAL ROLE app_request` (tx-scoped role) and a tx-local GUC via
 * set_config(…, true). ROLLBACK reverts both — no state leaks between cases.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { bootstrapTestDb, seedFinding, type TestDbSeed } from "./testDb.js";

let seed: TestDbSeed;
let pool: Pool;
let findingA: string;
let findingB: string;

beforeAll(async () => {
  // Drops + applies the full migration set (creates app_request, enables RLS on
  // findings) + seeds the two orgs.
  seed = await bootstrapTestDb();

  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error("TEST_DATABASE_URL is not set for the findings RLS test.");
  }
  // Own pool, connected as the harness superuser (same URL the harness uses).
  pool = new Pool({ connectionString: url, ssl: false });

  // Seed one finding per org as the owner (RLS bypassed for seeding).
  findingA = await seedFinding(pool, seed.orgA.id);
  findingB = await seedFinding(pool, seed.orgB.id);
}, 120_000);

afterAll(async () => {
  await pool?.end();
});

describe("A04-G1 phase 2 — findings RLS enforcement", () => {
  it("app_request scoped to org A cannot see org B's findings, and sees its own", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [
        seed.orgA.id,
      ]);

      // Even an explicit WHERE for org B returns nothing — the policy filters first.
      const crossOrg = await client.query(
        "SELECT id FROM findings WHERE organization_id = $1",
        [seed.orgB.id],
      );
      expect(crossOrg.rowCount).toBe(0);

      // Positive control: an unfiltered read returns ONLY org A's row.
      const visible = await client.query("SELECT id FROM findings");
      const ids = visible.rows.map((r) => r.id);
      expect(ids).toContain(findingA);
      expect(ids).not.toContain(findingB);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("app_request with an UNSET org GUC sees zero findings (fail-closed default)", async () => {
    // NOTE: this connection comes from the pool and may have served the scoped
    // assertion above — so app.current_org_id is in the SET-then-reset state,
    // where current_setting(…, true) reads back as '' (empty string), NOT NULL.
    // The policy's NULLIF(…, '') collapses that to NULL → zero rows. Without
    // NULLIF this query would 500 on ''::uuid (the bug the pilot caught).
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      // Deliberately do NOT set app.current_org_id.
      const res = await client.query("SELECT id FROM findings");
      expect(res.rowCount).toBe(0);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("the owner connection bypasses RLS (regression — sees all orgs' findings)", async () => {
    const res = await pool.query("SELECT id FROM findings");
    const ids = res.rows.map((r) => r.id);
    expect(ids).toContain(findingA);
    expect(ids).toContain(findingB);
  });

  it("app_request scoped to org A cannot INSERT a finding stamped for org B (WITH CHECK)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [
        seed.orgA.id,
      ]);

      await expect(
        client.query(
          `INSERT INTO findings (organization_id, title, severity, description, source_type)
           VALUES ($1, 'cross-org write', 'high', 'should be rejected', 'manual')`,
          [seed.orgB.id],
        ),
      ).rejects.toThrow(/row-level security/i);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("app_request with an EMPTY-STRING org GUC sees zero findings (NULLIF fail-closed, never permissive)", async () => {
    // Pins the NULLIF(…, '') contract: an empty-string GUC collapses to NULL →
    // zero rows. It is NOT silently permissive (does not return all rows), and
    // — crucially — it does NOT 500 on ''::uuid the way the naive template
    // would. This is the same machinery that protects the unset case above.
    // See policy-templates.md §I.
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', '', true)");

      const res = await client.query("SELECT id FROM findings");
      expect(res.rowCount).toBe(0);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });
});
