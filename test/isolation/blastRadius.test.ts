/**
 * blastRadius.test.ts — ERIP Epic 7: real-Postgres proof that
 * GET /api/graph/blast-radius/:assetId resolves an asset's dependency
 * neighbourhood over the ONE graph substrate, labels every node from its
 * canonical home, and summarizes — org-scoped.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { bootstrapTestDb, type TestDbSeed } from "./testDb.js";
import { withTenant } from "../../src/api/infra/postgres.js";
import { getBlastRadius } from "../../src/api/routes/knowledgeGraph.js";
import type { Request, Response } from "express";

const ECL_FLAG = "SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED";
const EAR_FLAG = "SECURELOGIC_ASSET_REGISTRY_ENABLED";
const KG_FLAG = "SECURELOGIC_KNOWLEDGE_GRAPH_ENABLED";

let seed: TestDbSeed;
let pool: Pool;
const prev: Record<string, string | undefined> = {};

function mockRes(): Response & { _status?: number; _json?: unknown } {
  const res = {
    _status: 0, _json: undefined,
    status(code: number) { (this as { _status: number })._status = code; return this; },
    json(body: unknown) { (this as { _json: unknown })._json = body; return this; }
  };
  return res as unknown as Response & { _status?: number; _json?: unknown };
}
const reqFor = (orgId: string, assetId: string): Request =>
  ({ organizationContext: { organizationId: orgId }, params: { assetId }, query: {} }) as unknown as Request;

async function seedEndpointAsset(orgId: string, name: string): Promise<string> {
  return withTenant(orgId, async () => {
    const d = await pool.query(
      `INSERT INTO endpoints (organization_id, name, status, external_ref, hostname)
       VALUES ($1, $2, 'active', $3, $2) RETURNING id`,
      [orgId, name, `ext-${name}`]
    );
    const a = await pool.query(
      `INSERT INTO assets (organization_id, asset_type, backing_kind, backing_id, lifecycle_status)
       VALUES ($1, 'endpoint', 'endpoints', $2, 'active') RETURNING id`,
      [orgId, d.rows[0].id]
    );
    await pool.query(`UPDATE endpoints SET asset_id = $1 WHERE id = $2`, [a.rows[0].id, d.rows[0].id]);
    return a.rows[0].id as string;
  });
}
async function seedVendor(orgId: string, name: string): Promise<string> {
  const r = await pool.query(`INSERT INTO vendors (organization_id, name) VALUES ($1, $2) RETURNING id`, [orgId, name]);
  return r.rows[0].id as string;
}
async function seedEdge(orgId: string, fromAsset: string, toVendor: string): Promise<void> {
  await pool.query(
    `INSERT INTO enterprise_relationships (organization_id, from_type, from_id, to_type, to_id, relationship_type)
     VALUES ($1, 'asset', $2, 'vendor', $3, 'depends_on')`,
    [orgId, fromAsset, toVendor]
  );
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  for (const f of [ECL_FLAG, EAR_FLAG, KG_FLAG]) {
    prev[f] = process.env[f];
    process.env[f] = "true";
  }
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the blast radius test.");
  pool = new Pool({ connectionString: url, ssl: false });
}, 120_000);

afterAll(async () => {
  for (const f of [ECL_FLAG, EAR_FLAG, KG_FLAG]) {
    if (prev[f] === undefined) delete process.env[f];
    else process.env[f] = prev[f];
  }
  await pool?.end();
});

describe("ERIP Epic 7 — blast-radius dependency graph", () => {
  it("resolves + labels the neighbourhood and summarizes, org-scoped", async () => {
    const assetId = await seedEndpointAsset(seed.orgA.id, "br-app-01");
    const vendorId = await seedVendor(seed.orgA.id, "Downstream Vendor");
    await seedEdge(seed.orgA.id, assetId, vendorId);

    const res = mockRes();
    await withTenant(seed.orgA.id, () => getBlastRadius(reqFor(seed.orgA.id, assetId), res));
    expect(res._status).toBe(200);
    const body = res._json as {
      root: { node_type: string; node_id: string };
      nodes: Array<{ node_type: string; node_id: string; label: string | null; depth: number }>;
      edges: unknown[];
      summary: { reachable_count: number; by_type: Record<string, number>; max_depth: number; edge_count: number };
    };
    expect(body.root).toEqual({ node_type: "asset", node_id: assetId });
    // The vendor node is labelled from its canonical home.
    const vendorNode = body.nodes.find((n) => n.node_type === "vendor" && n.node_id === vendorId)!;
    expect(vendorNode.label).toBe("Downstream Vendor");
    expect(vendorNode.depth).toBe(1);
    // The root is labelled from asset_registry_v.
    const rootNode = body.nodes.find((n) => n.node_type === "asset" && n.node_id === assetId)!;
    expect(rootNode.label).toBe("br-app-01");
    expect(body.summary).toMatchObject({ reachable_count: 1, by_type: { vendor: 1 }, max_depth: 1, edge_count: 1 });
  });

  it("404s for an unknown asset and does not cross orgs", async () => {
    const assetB = await seedEndpointAsset(seed.orgB.id, "br-b-02");
    const res = mockRes();
    await withTenant(seed.orgA.id, () => getBlastRadius(reqFor(seed.orgA.id, assetB), res));
    expect(res._status).toBe(404); // org-A cannot resolve org-B's asset
  });
});
