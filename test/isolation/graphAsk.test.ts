/**
 * graphAsk.test.ts — ERIP E7: real-Postgres proof that POST /api/graph/ask
 * resolves an asset's dependency neighbourhood, enriches each node with label +
 * own-risk + criticality, runs the impact analysis, and returns a grounded
 * answer. With no ANTHROPIC_API_KEY the answer degrades deterministically — but
 * it is still fully grounded in the org's own graph evidence. Org-scoped.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { bootstrapTestDb, type TestDbSeed } from "./testDb.js";
import { withTenant } from "../../src/api/infra/postgres.js";
import { askGraph } from "../../src/api/routes/knowledgeGraph.js";
import type { Request, Response } from "express";

const ECL_FLAG = "SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED";
const EAR_FLAG = "SECURELOGIC_ASSET_REGISTRY_ENABLED";
const KG_FLAG = "SECURELOGIC_KNOWLEDGE_GRAPH_ENABLED";

let seed: TestDbSeed;
let pool: Pool;
let hashSeq = 0;
const prev: Record<string, string | undefined> = {};

function mockRes(): Response & { _status?: number; _json?: unknown } {
  const res = {
    _status: 0, _json: undefined,
    status(code: number) { (this as { _status: number })._status = code; return this; },
    json(body: unknown) { (this as { _json: unknown })._json = body; return this; }
  };
  return res as unknown as Response & { _status?: number; _json?: unknown };
}
const reqFor = (orgId: string, body: unknown): Request =>
  ({ organizationContext: { organizationId: orgId }, body }) as unknown as Request;

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
/** Give a vendor node active own-risk via its CURRENT applicability decision. */
async function seedVendorDecision(orgId: string, vendorId: string, decision: string, confidence: number): Promise<void> {
  hashSeq += 1;
  await pool.query(
    `INSERT INTO applicability_assessments
       (organization_id, signal_id, target_type, target_id, asset_id, decision, confidence,
        confidence_band, reasoning_steps, engine_version, schema_version, content_hash, prev_hash)
     VALUES ($1, gen_random_uuid(), 'vendor', $2, NULL, $3, $4,
        'high', '[]'::jsonb, 'v1', 'v1', $5, $6)`,
    [orgId, vendorId, decision, confidence, `ga-${hashSeq}`, `gp-${hashSeq}`]
  );
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  for (const f of [ECL_FLAG, EAR_FLAG, KG_FLAG]) {
    prev[f] = process.env[f];
    process.env[f] = "true";
  }
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the graph-ask test.");
  pool = new Pool({ connectionString: url, ssl: false });
}, 120_000);

afterAll(async () => {
  for (const f of [ECL_FLAG, EAR_FLAG, KG_FLAG]) {
    if (prev[f] === undefined) delete process.env[f];
    else process.env[f] = prev[f];
  }
  await pool?.end();
});

describe("ERIP E7 — POST /api/graph/ask (NL question + impact analysis)", () => {
  it("answers grounded in the org's own graph, surfacing the at-risk dependency + business impact", async () => {
    const assetId = await seedEndpointAsset(seed.orgA.id, "ask-app-01");
    const vendorId = await seedVendor(seed.orgA.id, "Ask Downstream Vendor");
    await seedEdge(seed.orgA.id, assetId, vendorId);
    await seedVendorDecision(seed.orgA.id, vendorId, "affected", 100); // own-risk 90

    const res = mockRes();
    await withTenant(seed.orgA.id, () =>
      askGraph(reqFor(seed.orgA.id, { asset_id: assetId, question: "What is the blast radius if this app is compromised?" }), res)
    );
    expect(res._status).toBe(200);
    const body = res._json as {
      asset_id: string;
      question: string;
      answer: { source: string; answer: string; citations: string[] };
      analysis: {
        business_impact_score: number;
        business_impact_band: string;
        blast_radius: { reachable_count: number; max_depth: number };
        at_risk_dependencies: Array<{ label: string | null; node_type: string; own_risk: number }>;
      };
    };

    // No API key in the harness → deterministic, but grounded in real graph facts.
    expect(body.answer.source).toBe("deterministic");
    expect(body.answer.answer).toContain("ask-app-01");
    expect(body.answer.answer).toContain("Ask Downstream Vendor");
    expect(body.answer.citations).toEqual(expect.arrayContaining(["ask-app-01", "Ask Downstream Vendor"]));

    // The vendor is an at-risk dependency with own-risk 90; impact is non-trivial.
    expect(body.analysis.blast_radius.reachable_count).toBe(1);
    expect(body.analysis.at_risk_dependencies).toHaveLength(1);
    expect(body.analysis.at_risk_dependencies[0]).toMatchObject({ label: "Ask Downstream Vendor", node_type: "vendor", own_risk: 90 });
    expect(body.analysis.business_impact_score).toBeGreaterThan(0);
    expect(body.analysis.business_impact_band).not.toBe("none");
  });

  it("does not cross orgs — 404 for another org's asset", async () => {
    const assetB = await seedEndpointAsset(seed.orgB.id, "ask-b-02");
    const res = mockRes();
    await withTenant(seed.orgA.id, () =>
      askGraph(reqFor(seed.orgA.id, { asset_id: assetB, question: "impact?" }), res)
    );
    expect(res._status).toBe(404);
  });

  it("rejects a blank question", async () => {
    const assetId = await seedEndpointAsset(seed.orgA.id, "ask-app-03");
    const res = mockRes();
    await withTenant(seed.orgA.id, () => askGraph(reqFor(seed.orgA.id, { asset_id: assetId, question: "   " }), res));
    expect(res._status).toBe(400);
  });
});
