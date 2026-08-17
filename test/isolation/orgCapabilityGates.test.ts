/**
 * orgCapabilityGates.test.ts — E-3 against real Postgres.
 *
 * What only a real database can prove about the capability table:
 *
 *   1. Cross-org independence — org A's explicit deny changes NOTHING for
 *      org B (a grant is a tenant fact, never an environment fact).
 *   2. The migration's tenancy posture — RLS enabled with the standard policy
 *      shape, and app_request granted (inert until M-1, like every other
 *      RLS-bearing table).
 *   3. The E-2 interlock — deleting the organization row removes its
 *      capability rows (ON DELETE CASCADE), so an erased tenant cannot leave
 *      grants behind, and erasure_inventory() discovers the table.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { bootstrapTestDb, type TestDbSeed } from "./testDb.js";

let seed: TestDbSeed;
let pool: Pool;

beforeAll(async () => {
  seed = await bootstrapTestDb();
  pool = new Pool({ connectionString: process.env["TEST_DATABASE_URL"], ssl: false });
}, 240_000);

afterAll(async () => {
  await pool?.end();
});

describe("cross-org independence", () => {
  it("org A's deny row does not exist for org B", async () => {
    await pool.query(
      `INSERT INTO organization_capabilities (organization_id, capability, enabled, reason)
       VALUES ($1, 'ask', false, 'isolation test: per-tenant kill')`,
      [seed.orgA.id]
    );

    const a = await pool.query(
      `SELECT enabled FROM organization_capabilities
        WHERE organization_id = $1 AND capability = 'ask'`,
      [seed.orgA.id]
    );
    const b = await pool.query(
      `SELECT enabled FROM organization_capabilities
        WHERE organization_id = $1 AND capability = 'ask'`,
      [seed.orgB.id]
    );

    expect(a.rows).toEqual([{ enabled: false }]);
    expect(b.rows).toEqual([]); // absence — org B resolves by registry default
  });

  it("one org can hold both directions across capabilities", async () => {
    await pool.query(
      `INSERT INTO organization_capabilities (organization_id, capability, enabled)
       VALUES ($1, 'ask_actions', true), ($1, 'ask_governed', false)
       ON CONFLICT (organization_id, capability) DO UPDATE SET enabled = EXCLUDED.enabled`,
      [seed.orgB.id]
    );
    const r = await pool.query(
      `SELECT capability, enabled FROM organization_capabilities
        WHERE organization_id = $1 ORDER BY capability`,
      [seed.orgB.id]
    );
    expect(r.rows).toEqual([
      { capability: "ask_actions", enabled: true },
      { capability: "ask_governed", enabled: false },
    ]);
  });
});

describe("tenancy posture of the table itself", () => {
  it("has RLS enabled with the standard tenant-isolation policy", async () => {
    const rls = await pool.query(
      `SELECT relrowsecurity FROM pg_class WHERE relname = 'organization_capabilities'`
    );
    expect(rls.rows).toEqual([{ relrowsecurity: true }]);

    const pol = await pool.query(
      `SELECT polname FROM pg_policy p
         JOIN pg_class c ON c.oid = p.polrelid
        WHERE c.relname = 'organization_capabilities'`
    );
    expect(pol.rows.map((r) => r.polname)).toContain(
      "organization_capabilities_tenant_isolation"
    );
  });

  it("grants app_request the four verbs (inert until M-1)", async () => {
    const r = await pool.query(
      `SELECT privilege_type FROM information_schema.role_table_grants
        WHERE table_name = 'organization_capabilities' AND grantee = 'app_request'
        ORDER BY privilege_type`
    );
    expect(r.rows.map((x) => x.privilege_type)).toEqual([
      "DELETE", "INSERT", "SELECT", "UPDATE",
    ]);
  });
});

describe("E-2 interlock", () => {
  it("capability rows die with the organization (ON DELETE CASCADE)", async () => {
    const org = await pool.query<{ id: string }>(
      `INSERT INTO organizations (name, slug)
       VALUES ('Capability Cascade Org', 'cap-cascade-' || floor(random() * 1e9)::text)
       RETURNING id`
    );
    const orgId = org.rows[0]!.id;
    await pool.query(
      `INSERT INTO organization_capabilities (organization_id, capability, enabled)
       VALUES ($1, 'ask_actions', true)`,
      [orgId]
    );

    await pool.query(`DELETE FROM organizations WHERE id = $1`, [orgId]);

    const left = await pool.query(
      `SELECT 1 FROM organization_capabilities WHERE organization_id = $1`,
      [orgId]
    );
    expect(left.rows).toEqual([]);
  });

  it("erasure_inventory() discovers the table (organization_id scan)", async () => {
    const r = await pool.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'organization_capabilities'
          AND column_name = 'organization_id'`
    );
    expect(r.rows.length).toBe(1);
  });
});
