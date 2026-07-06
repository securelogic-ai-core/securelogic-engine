/**
 * assetRiskPropagation.test.ts — ERIP E3.P1: real-Postgres proof that
 * GET /api/assets/:id/risk-propagation resolves an asset's outbound graph
 * neighbourhood, seeds own-risk from CURRENT applicability decisions
 * (ERIP-AD-16), and propagates a dependency's risk to the seed with a trace
 * (ERIP-AD-17). Org-isolated; no canonical mutation.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { bootstrapTestDb, type TestDbSeed } from "./testDb.js";
import { withTenant } from "../../src/api/infra/postgres.js";
import { getAssetRiskPropagation } from "../../src/api/routes/assets.js";
import type { Request, Response } from "express";

const ECL_FLAG = "SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED";
const EAR_FLAG = "SECURELOGIC_ASSET_REGISTRY_ENABLED";
const RISK_FLAG = "SECURELOGIC_RISK_INTELLIGENCE_ENABLED";

let seed: TestDbSeed;
let pool: Pool;
const prev: Record<string, string | undefined> = {};
let prevHashCounter = 0;

function mockRes(): Response & { _status?: number; _json?: unknown } {
  const res = {
    _status: 0, _json: undefined,
    status(code: number) { (this as { _status: number })._status = code; return this; },
    json(body: unknown) { (this as { _json: unknown })._json = body; return this; }
  };
  return res as unknown as Response & { _status?: number; _json?: unknown };
}

function reqFor(orgId: string, id: string): Request {
  return { organizationContext: { organizationId: orgId }, params: { id }, query: {} } as unknown as Request;
}

async function seedEndpointAsset(orgId: string, name: string): Promise<string> {
  return withTenant(orgId, async () => {
    const detail = await pool.query(
      `INSERT INTO endpoints (organization_id, name, status, external_ref, hostname)
       VALUES ($1, $2, 'active', $3, $2) RETURNING id`,
      [orgId, name, `ext-${name}`]
    );
    const asset = await pool.query(
      `INSERT INTO assets (organization_id, asset_type, backing_kind, backing_id, lifecycle_status)
       VALUES ($1, 'endpoint', 'endpoints', $2, 'active') RETURNING id`,
      [orgId, detail.rows[0].id]
    );
    await pool.query(`UPDATE endpoints SET asset_id = $1 WHERE id = $2`, [asset.rows[0].id, detail.rows[0].id]);
    return asset.rows[0].id as string;
  });
}

async function seedVendor(orgId: string, name: string): Promise<string> {
  const r = await pool.query(
    `INSERT INTO vendors (organization_id, name) VALUES ($1, $2) RETURNING id`,
    [orgId, name]
  );
  return r.rows[0].id as string;
}

async function seedEdge(orgId: string, fromAssetId: string, toVendorId: string): Promise<void> {
  await pool.query(
    `INSERT INTO enterprise_relationships (organization_id, from_type, from_id, to_type, to_id, relationship_type)
     VALUES ($1, 'asset', $2, 'vendor', $3, 'depends_on')`,
    [orgId, fromAssetId, toVendorId]
  );
}

async function seedApplicability(orgId: string, vendorId: string, decision: string, confidence: number): Promise<void> {
  prevHashCounter += 1;
  await pool.query(
    `INSERT INTO applicability_assessments
       (organization_id, signal_id, target_type, target_id, decision, confidence, confidence_band,
        reasoning_steps, engine_version, schema_version, content_hash, prev_hash)
     VALUES ($1, gen_random_uuid(), 'vendor', $2, $3, $4, 'high',
        '[]'::jsonb, 'v1', 'v1', $5, $6)`,
    [orgId, vendorId, decision, confidence, `hash-${prevHashCounter}`, `prev-${prevHashCounter}`]
  );
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  for (const f of [ECL_FLAG, EAR_FLAG, RISK_FLAG]) {
    prev[f] = process.env[f];
    process.env[f] = "true";
  }
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the risk propagation test.");
  pool = new Pool({ connectionString: url, ssl: false });
}, 120_000);

afterAll(async () => {
  for (const f of [ECL_FLAG, EAR_FLAG, RISK_FLAG]) {
    if (prev[f] === undefined) delete process.env[f];
    else process.env[f] = prev[f];
  }
  await pool?.end();
});

describe("ERIP E3.P1 — asset risk propagation", () => {
  it("inherits a flagged dependency's risk with a decayed contributor trace", async () => {
    const assetId = await seedEndpointAsset(seed.orgA.id, "app-host-01");
    const vendorId = await seedVendor(seed.orgA.id, "Critical Vendor A");
    await seedEdge(seed.orgA.id, assetId, vendorId);
    // Vendor is 'affected' at full confidence → own-risk 90.
    await seedApplicability(seed.orgA.id, vendorId, "affected", 100);

    const res = mockRes();
    await withTenant(seed.orgA.id, () => getAssetRiskPropagation(reqFor(seed.orgA.id, assetId), res));
    expect(res._status).toBe(200);
    const body = res._json as {
      neighbourhood_size: number;
      risk: {
        direct_risk: number;
        inherited_risk: number;
        total_risk: number;
        contributors: Array<{ node_type: string; node_id: string; own_risk: number; depth: number; contribution: number }>;
      };
    };
    expect(body.neighbourhood_size).toBe(2); // the asset + the vendor
    expect(body.risk.direct_risk).toBe(0); // the asset has no own applicability decision
    // vendor own 90, one hop, default decay 0.6 → contribution 54.
    expect(body.risk.contributors).toHaveLength(1);
    expect(body.risk.contributors[0]).toMatchObject({ node_type: "vendor", node_id: vendorId, own_risk: 90, depth: 1, contribution: 54 });
    expect(body.risk.inherited_risk).toBe(54);
    expect(body.risk.total_risk).toBe(54);
  });

  it("an asset with no risky dependencies scores zero", async () => {
    const assetId = await seedEndpointAsset(seed.orgA.id, "isolated-host-02");
    const res = mockRes();
    await withTenant(seed.orgA.id, () => getAssetRiskPropagation(reqFor(seed.orgA.id, assetId), res));
    const body = res._json as { risk: { total_risk: number; contributors: unknown[] } };
    expect(body.risk.total_risk).toBe(0);
    expect(body.risk.contributors).toEqual([]);
  });

  it("does not cross org boundaries", async () => {
    // Org B has its own asset+vendor+decision; org A's query must not see it.
    const assetB = await seedEndpointAsset(seed.orgB.id, "b-host-03");
    const vendorB = await seedVendor(seed.orgB.id, "B Vendor");
    await seedEdge(seed.orgB.id, assetB, vendorB);
    await seedApplicability(seed.orgB.id, vendorB, "affected", 100);

    // Query org A for org B's asset id → not found (org-scoped registry lookup).
    const res = mockRes();
    await withTenant(seed.orgA.id, () => getAssetRiskPropagation(reqFor(seed.orgA.id, assetB), res));
    expect(res._status).toBe(404);
  });

  it("404s for an unknown asset", async () => {
    const res = mockRes();
    await withTenant(seed.orgA.id, () =>
      getAssetRiskPropagation(reqFor(seed.orgA.id, "00000000-0000-4000-8000-000000000000"), res)
    );
    expect(res._status).toBe(404);
  });
});
