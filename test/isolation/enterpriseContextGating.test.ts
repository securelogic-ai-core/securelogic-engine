/**
 * enterpriseContextGating.test.ts — Item 9 (GATE A): the SCHEMA half of ECL gating —
 * the caps + capability columns (migrations 20260728/20260729) and the edge-count
 * semantics that enforceEnterpriseEdgeLimit relies on. The TS function/middleware
 * logic is unit-tested with mocked pg; this proves the columns, defaults, and query
 * against real Postgres. Raw-pool style (mirrors enterpriseEntitiesRls.test.ts).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import crypto from "crypto";

import { bootstrapTestDb, type TestDbSeed } from "./testDb.js";
import { resolveEnterpriseContextCapability } from "../../src/api/lib/enterpriseContextCapability.js";

let seed: TestDbSeed;
let pool: Pool;

async function seedEdge(orgId: string): Promise<void> {
  await pool.query(
    `INSERT INTO enterprise_relationships (organization_id, from_type, from_id, to_type, to_id, relationship_type)
     VALUES ($1, 'vendor', $2, 'vendor', $3, 'depends_on')`,
    [orgId, crypto.randomUUID(), crypto.randomUUID()]
  );
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the ECL gating test.");
  pool = new Pool({ connectionString: url, ssl: false });
}, 120_000);

afterAll(async () => { await pool?.end(); });

describe("Item 9 — ECL caps + capability columns", () => {
  it("organizations carries the caps with the GATE-A defaults + the capability override column", async () => {
    const r = await pool.query<{ ent: number; edges: number; cap: boolean | null }>(
      `SELECT max_enterprise_entities AS ent, max_enterprise_edges AS edges, enterprise_context_capability AS cap
         FROM organizations WHERE id = $1`,
      [seed.orgA.id]
    );
    expect(r.rows[0].ent).toBe(10000);
    expect(r.rows[0].edges).toBe(50000);
    expect(r.rows[0].cap).toBeNull(); // NULL = inherit default
  });

  it("the edge-count query (enforceEnterpriseEdgeLimit) counts only this org's live edges", async () => {
    await seedEdge(seed.orgA.id);
    await seedEdge(seed.orgA.id);
    await seedEdge(seed.orgB.id);

    const countFor = async (orgId: string) => {
      const r = await pool.query<{ used: string }>(
        `SELECT (SELECT COUNT(*) FROM enterprise_relationships
                  WHERE organization_id = o.id AND deleted_at IS NULL)::text AS used
           FROM organizations o WHERE o.id = $1`,
        [orgId]
      );
      return parseInt(r.rows[0].used, 10);
    };
    expect(await countFor(seed.orgA.id)).toBe(2);
    expect(await countFor(seed.orgB.id)).toBe(1);
  });

  it("lowering an org's edge cap makes used >= cap (the 409 condition)", async () => {
    await pool.query("UPDATE organizations SET max_enterprise_edges = 2 WHERE id = $1", [seed.orgA.id]);
    const r = await pool.query<{ used: string; cap: number }>(
      `SELECT (SELECT COUNT(*) FROM enterprise_relationships
                WHERE organization_id = o.id AND deleted_at IS NULL)::text AS used,
              o.max_enterprise_edges AS cap
         FROM organizations o WHERE o.id = $1`,
      [seed.orgA.id]
    );
    const used = parseInt(r.rows[0].used, 10);
    expect(used >= r.rows[0].cap).toBe(true);
  });

  it("the capability override column round-trips and drives the resolver", async () => {
    // explicit revoke
    await pool.query("UPDATE organizations SET enterprise_context_capability = false WHERE id = $1", [seed.orgA.id]);
    let r = await pool.query<{ cap: boolean | null }>(
      "SELECT enterprise_context_capability AS cap FROM organizations WHERE id = $1", [seed.orgA.id]
    );
    expect(r.rows[0].cap).toBe(false);
    expect(resolveEnterpriseContextCapability("platform", r.rows[0].cap)).toBe(false);

    // explicit grant to a non-platform tier
    await pool.query("UPDATE organizations SET enterprise_context_capability = true WHERE id = $1", [seed.orgA.id]);
    r = await pool.query<{ cap: boolean | null }>(
      "SELECT enterprise_context_capability AS cap FROM organizations WHERE id = $1", [seed.orgA.id]
    );
    expect(resolveEnterpriseContextCapability("professional", r.rows[0].cap)).toBe(true);

    // back to inherit
    await pool.query("UPDATE organizations SET enterprise_context_capability = NULL WHERE id = $1", [seed.orgA.id]);
    r = await pool.query<{ cap: boolean | null }>(
      "SELECT enterprise_context_capability AS cap FROM organizations WHERE id = $1", [seed.orgA.id]
    );
    expect(r.rows[0].cap).toBeNull();
    expect(resolveEnterpriseContextCapability("platform", r.rows[0].cap)).toBe(true);
  });
});
