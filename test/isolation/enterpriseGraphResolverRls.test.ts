/**
 * enterpriseGraphResolverRls.test.ts — ECL Slice 2b: proves the graph traversal
 * (the repo's first WITH RECURSIVE) is (a) org-isolated, (b) depth-bounded, and
 * (c) cycle-safe. The traversal's isolation comes from the explicit
 * `organization_id = $org` filter on the unified edge view: with $org = orgA the CTE
 * can only ever follow org A's edges, so it can never reach another org's nodes —
 * even when seeded with another org's node id.
 *
 * The CTE below MIRRORS enterpriseGraphResolver.ts (the node query). It is executed
 * via the raw owner pool so the test asserts the SQL's org-scoping directly; RLS on
 * the underlying tables is covered by enterpriseEntitiesRls / enterpriseRelationshipsRls.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { bootstrapTestDb, type TestDbSeed } from "./testDb.js";

let seed: TestDbSeed;
let pool: Pool;
// org A path graph: a1 -> a2 -> a3 -> a1 (cycle back)
let a1: string, a2: string, a3: string;
let b1: string; // org B node (for the cross-org seed test)

// Mirror of enterpriseGraphResolver.ts node query (generic edges only is enough to
// prove isolation/bounding/cycle-safety; the ai_system_vendor_dependencies union is
// exercised by the route/app path).
const NODE_QUERY = `
  WITH RECURSIVE unified_edges AS (
    SELECT from_type, from_id, to_type, to_id FROM enterprise_relationships
     WHERE organization_id = $1 AND deleted_at IS NULL
  ),
  reachable AS (
    SELECT $2::text AS node_type, $3::uuid AS node_id, 0 AS depth,
           ARRAY[$2 || ':' || ($3::uuid)::text] AS visited
    UNION ALL
    SELECT e.to_type, e.to_id, r.depth + 1,
           r.visited || (e.to_type || ':' || (e.to_id)::text)
      FROM reachable r
      JOIN unified_edges e ON e.from_type = r.node_type AND e.from_id = r.node_id
     WHERE r.depth < $4
       AND NOT ((e.to_type || ':' || (e.to_id)::text) = ANY (r.visited))
  )
  SELECT node_id, MIN(depth)::int AS depth FROM reachable GROUP BY node_id`;

async function seedEntity(orgId: string, name: string): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO enterprise_entities (organization_id, entity_type, name) VALUES ($1, 'application', $2) RETURNING id`,
    [orgId, name]
  );
  return r.rows[0].id;
}
async function seedEdge(orgId: string, from: string, to: string): Promise<void> {
  await pool.query(
    `INSERT INTO enterprise_relationships (organization_id, from_type, from_id, to_type, to_id, relationship_type)
     VALUES ($1, 'enterprise_entity', $2, 'enterprise_entity', $3, 'depends_on')`,
    [orgId, from, to]
  );
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the enterprise graph resolver test.");
  pool = new Pool({ connectionString: url, ssl: false });

  a1 = await seedEntity(seed.orgA.id, "graph-a1");
  a2 = await seedEntity(seed.orgA.id, "graph-a2");
  a3 = await seedEntity(seed.orgA.id, "graph-a3");
  await seedEdge(seed.orgA.id, a1, a2);
  await seedEdge(seed.orgA.id, a2, a3);
  await seedEdge(seed.orgA.id, a3, a1); // cycle

  b1 = await seedEntity(seed.orgB.id, "graph-b1");
  const b2 = await seedEntity(seed.orgB.id, "graph-b2");
  await seedEdge(seed.orgB.id, b1, b2);
}, 120_000);

afterAll(async () => { await pool?.end(); });

describe("ECL Slice 2b — enterprise graph resolver", () => {
  it("traverses org A's connected graph and assigns min depth, cycle-safe", async () => {
    const r = await pool.query<{ node_id: string; depth: number }>(NODE_QUERY, [seed.orgA.id, "enterprise_entity", a1, 5]);
    const byId = new Map(r.rows.map((x) => [x.node_id, x.depth]));
    expect(byId.get(a1)).toBe(0);
    expect(byId.get(a2)).toBe(1);
    expect(byId.get(a3)).toBe(2);
    // cycle a3 -> a1 did not loop forever and did not lower a1's depth below 0
    expect(r.rows.length).toBe(3);
  });

  it("respects the depth bound", async () => {
    const r = await pool.query<{ node_id: string }>(NODE_QUERY, [seed.orgA.id, "enterprise_entity", a1, 1]);
    const ids = r.rows.map((x) => x.node_id);
    expect(ids).toContain(a1);
    expect(ids).toContain(a2);
    expect(ids).not.toContain(a3);
  });

  it("is org-isolated: org A traversal never reaches org B nodes", async () => {
    const r = await pool.query<{ node_id: string }>(NODE_QUERY, [seed.orgA.id, "enterprise_entity", a1, 5]);
    const ids = r.rows.map((x) => x.node_id);
    expect(ids).not.toContain(b1);
  });

  it("seeding another org's node under org A returns only the seed (cannot traverse org B's graph)", async () => {
    const r = await pool.query<{ node_id: string; depth: number }>(NODE_QUERY, [seed.orgA.id, "enterprise_entity", b1, 5]);
    // Only the seed echoes back; org B's edges are invisible under $org = orgA.
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].node_id).toBe(b1);
    expect(r.rows[0].depth).toBe(0);
  });
});
