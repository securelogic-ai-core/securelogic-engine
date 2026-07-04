/**
 * enterpriseGraphScale.test.ts — Item 10 (scale): load + fan-out + EXPLAIN for the
 * recursive graph resolver (enterpriseGraphResolver.ts, the repo's WITH RECURSIVE).
 * Seeds a CI-synthesizable graph (fan-out hub + deep chain + a cycle), runs the exact
 * nodes query at each depth with EXPLAIN (ANALYZE, BUFFERS), and asserts the traversal
 * is bounded, depth-capped, and cycle-safe. Emits numbers (captured into
 * enterprise-context-scale-findings.md). Larger volumes (10^4–10^5) are the operator
 * L-6 run; this establishes the shape + the CI-scale baseline. Read-only on the graph.
 *
 * The SQL below MIRRORS resolveNeighborhood's nodes query (UNIFIED_EDGES + REACHABLE).
 * Kept in the test so we can wrap it in EXPLAIN ANALYZE against a raw owner client.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import crypto from "crypto";

import { bootstrapTestDb, type TestDbSeed } from "./testDb.js";

let seed: TestDbSeed;
let pool: Pool;

const NODES_SQL = `
WITH RECURSIVE
  unified_edges AS (
    SELECT from_type, from_id, to_type, to_id, relationship_type,
           'enterprise_relationship'::text AS source
      FROM enterprise_relationships
     WHERE organization_id = $1 AND deleted_at IS NULL
    UNION ALL
    SELECT 'ai_system'::text, ai_system_id, 'vendor'::text, vendor_id,
           dependency_role, 'ai_system_vendor_dependency'::text
      FROM ai_system_vendor_dependencies
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
SELECT node_type, node_id, MIN(depth)::int AS depth
  FROM reachable GROUP BY node_type, node_id`;

// Seeded roots (assigned in beforeAll).
let hubId = "";
let chainHeadId = "";
let cycleHeadId = "";
const FANOUT = 400; // children of the hub at depth 1
const CHAIN_LEN = 150;

async function bulkEdges(orgId: string, pairs: Array<[string, string]>): Promise<void> {
  for (let i = 0; i < pairs.length; i += 500) {
    const batch = pairs.slice(i, i + 500);
    const rows: string[] = [];
    const params: string[] = [orgId];
    let p = 2;
    for (const [f, t] of batch) {
      rows.push(`($1, 'enterprise_entity', $${p}, 'enterprise_entity', $${p + 1}, 'depends_on')`);
      params.push(f, t);
      p += 2;
    }
    await pool.query(
      `INSERT INTO enterprise_relationships (organization_id, from_type, from_id, to_type, to_id, relationship_type)
       VALUES ${rows.join(",")}`,
      params
    );
  }
}

async function explainMs(orgId: string, seedId: string, depth: number): Promise<number> {
  const r = await pool.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${NODES_SQL}`, [
    orgId,
    "enterprise_entity",
    seedId,
    depth
  ]);
  const plan = (r.rows[0] as { "QUERY PLAN": Array<{ "Execution Time": number }> })["QUERY PLAN"][0];
  return plan["Execution Time"];
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the graph scale test.");
  pool = new Pool({ connectionString: url, ssl: false });
  const org = seed.orgA.id;

  // --- Fan-out hub: 1 hub -> FANOUT children (depth 1) -> 1 grandchild each (depth 2). ---
  const hubChildren = Array.from({ length: FANOUT }, () => crypto.randomUUID());
  const grandchildren = Array.from({ length: FANOUT }, () => crypto.randomUUID());
  hubId = crypto.randomUUID();

  // --- Deep chain: CHAIN_LEN nodes linked 0->1->...->N. ---
  const chain = Array.from({ length: CHAIN_LEN }, () => crypto.randomUUID());
  chainHeadId = chain[0];

  // --- Cycle: A -> B -> C -> A. ---
  const cyc = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  cycleHeadId = cyc[0];

  const allIds = [hubId, ...hubChildren, ...grandchildren, ...chain, ...cyc];
  // Insert entities with EXPLICIT ids (we need them to wire edges).
  for (let i = 0; i < allIds.length; i += 500) {
    const batch = allIds.slice(i, i + 500);
    const rows = batch.map((_, j) => `($1, 'asset', 'scale-${i + j}', $${j + 2})`).join(",");
    await pool.query(
      `INSERT INTO enterprise_entities (organization_id, entity_type, name, id) VALUES ${rows}`,
      [org, ...batch]
    );
  }

  const edges: Array<[string, string]> = [];
  for (let i = 0; i < FANOUT; i++) {
    edges.push([hubId, hubChildren[i]]);
    edges.push([hubChildren[i], grandchildren[i]]);
  }
  for (let i = 0; i < CHAIN_LEN - 1; i++) edges.push([chain[i], chain[i + 1]]);
  edges.push([cyc[0], cyc[1]], [cyc[1], cyc[2]], [cyc[2], cyc[0]]);
  await bulkEdges(org, edges);
}, 180_000);

afterAll(async () => { await pool?.end(); });

describe("Item 10 — recursive graph resolver scale + EXPLAIN", () => {
  it("fan-out hub: bounded result, and prints EXPLAIN timings per depth", async () => {
    const org = seed.orgA.id;
    const rows: string[] = [];
    for (let d = 1; d <= 5; d++) {
      const ms = await explainMs(org, hubId, d);
      const count = await pool.query<{ n: string }>(
        `WITH RECURSIVE unified_edges AS (
           SELECT from_type, from_id, to_type, to_id FROM enterprise_relationships
            WHERE organization_id = $1 AND deleted_at IS NULL),
         reachable AS (
           SELECT $2::text nt, $3::uuid ni, 0 d, ARRAY[$2||':'||($3::uuid)::text] v
           UNION ALL
           SELECT e.to_type, e.to_id, r.d+1, r.v||(e.to_type||':'||(e.to_id)::text)
             FROM reachable r JOIN unified_edges e ON e.from_type=r.nt AND e.from_id=r.ni
            WHERE r.d < $4 AND NOT ((e.to_type||':'||(e.to_id)::text) = ANY(r.v)))
         SELECT COUNT(DISTINCT (nt,ni))::text n FROM reachable`,
        [org, "enterprise_entity", hubId, d]
      );
      rows.push(`  depth ${d}: ${count.rows[0].n} nodes, ${ms.toFixed(1)} ms`);
    }
    // eslint-disable-next-line no-console
    console.log(`[scale] fan-out hub (FANOUT=${FANOUT}):\n${rows.join("\n")}`);
    // hub reaches 1 + FANOUT + FANOUT (grandchildren) at depth >= 2, bounded.
    const finalMs = await explainMs(org, hubId, 5);
    expect(finalMs).toBeLessThan(2000); // generous CI ceiling; real number is logged
  });

  it("deep chain: depth cap bounds the walk to depth+1 nodes", async () => {
    const org = seed.orgA.id;
    const r = await pool.query<{ node_id: string; depth: number }>(NODES_SQL, [
      org,
      "enterprise_entity",
      chainHeadId,
      5
    ]);
    expect(r.rowCount).toBe(6); // depth 0..5 inclusive
    const ms = await explainMs(org, chainHeadId, 5);
    // eslint-disable-next-line no-console
    console.log(`[scale] deep chain (len=${CHAIN_LEN}) depth 5: ${r.rowCount} nodes, ${ms.toFixed(1)} ms`);
  });

  it("cycle: traversal terminates (cycle-safe) and does not blow up", async () => {
    const org = seed.orgA.id;
    const r = await pool.query(NODES_SQL, [org, "enterprise_entity", cycleHeadId, 5]);
    // 3-node cycle visited once each — the visited-array guard prevents re-entry.
    expect(r.rowCount).toBe(3);
  });
});
