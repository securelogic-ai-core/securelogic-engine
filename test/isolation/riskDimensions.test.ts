/**
 * riskDimensions.test.ts — ERIP Epic 3: real-Postgres proof that
 * GET /api/risk/dimensions rolls per-asset own-risk (from CURRENT applicability
 * decisions) into executive dimensions over asset_registry_v, org-scoped.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { bootstrapTestDb, type TestDbSeed } from "./testDb.js";
import { withTenant } from "../../src/api/infra/postgres.js";
import { getRiskDimensions } from "../../src/api/routes/riskIntelligence.js";
import type { Request, Response } from "express";

const ECL_FLAG = "SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED";
const EAR_FLAG = "SECURELOGIC_ASSET_REGISTRY_ENABLED";
const RISK_FLAG = "SECURELOGIC_RISK_INTELLIGENCE_ENABLED";

let seed: TestDbSeed;
let pool: Pool;
const prev: Record<string, string | undefined> = {};
let prevHash = 0;

function mockRes(): Response & { _status?: number; _json?: unknown } {
  const res = {
    _status: 0, _json: undefined,
    status(code: number) { (this as { _status: number })._status = code; return this; },
    json(body: unknown) { (this as { _json: unknown })._json = body; return this; }
  };
  return res as unknown as Response & { _status?: number; _json?: unknown };
}

function reqFor(orgId: string): Request {
  return { organizationContext: { organizationId: orgId }, query: {} } as unknown as Request;
}

async function seedEndpoint(orgId: string, name: string): Promise<string> {
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

async function seedDecisionForAsset(orgId: string, assetId: string, decision: string, confidence: number): Promise<void> {
  prevHash += 1;
  await pool.query(
    `INSERT INTO applicability_assessments
       (organization_id, signal_id, target_type, target_id, asset_id, decision, confidence,
        confidence_band, reasoning_steps, engine_version, schema_version, content_hash, prev_hash)
     VALUES ($1, gen_random_uuid(), 'vendor', gen_random_uuid(), $2, $3, $4,
        'high', '[]'::jsonb, 'v1', 'v1', $5, $6)`,
    [orgId, assetId, decision, confidence, `dh-${prevHash}`, `dp-${prevHash}`]
  );
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  for (const f of [ECL_FLAG, EAR_FLAG, RISK_FLAG]) {
    prev[f] = process.env[f];
    process.env[f] = "true";
  }
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the risk dimensions test.");
  pool = new Pool({ connectionString: url, ssl: false });
}, 120_000);

afterAll(async () => {
  for (const f of [ECL_FLAG, EAR_FLAG, RISK_FLAG]) {
    if (prev[f] === undefined) delete process.env[f];
    else process.env[f] = prev[f];
  }
  await pool?.end();
});

describe("ERIP Epic 3 — risk dimensions rollup", () => {
  it("rolls per-asset own-risk into an endpoint dimension, org-scoped", async () => {
    const hot = await seedEndpoint(seed.orgA.id, "rd-hot-01");
    const cool = await seedEndpoint(seed.orgA.id, "rd-cool-02");
    await seedDecisionForAsset(seed.orgA.id, hot, "affected", 100); // own-risk 90 → critical
    // cool has no decision → own-risk 0

    // Org B noise that must not leak in.
    const bAsset = await seedEndpoint(seed.orgB.id, "rd-b-03");
    await seedDecisionForAsset(seed.orgB.id, bAsset, "affected", 100);

    const res = mockRes();
    await withTenant(seed.orgA.id, () => getRiskDimensions(reqFor(seed.orgA.id), res));
    expect(res._status).toBe(200);
    const body = res._json as {
      risk: {
        overall: { asset_count: number; at_risk_count: number; max_risk: number };
        by_asset_type: Array<{ dimension: string; asset_count: number; at_risk_count: number; max_risk: number; bands: Record<string, number> }>;
      };
    };
    const endpoint = body.risk.by_asset_type.find((d) => d.dimension === "endpoint")!;
    expect(endpoint.asset_count).toBe(2); // both org-A endpoints, org-B excluded
    expect(endpoint.at_risk_count).toBe(1);
    expect(endpoint.max_risk).toBe(90);
    expect(endpoint.bands).toMatchObject({ critical: 1, none: 1 });
    expect(body.risk.overall.asset_count).toBe(2);
  });
});
