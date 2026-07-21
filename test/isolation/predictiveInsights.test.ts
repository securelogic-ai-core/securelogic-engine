/**
 * predictiveInsights.test.ts — ERIP E5b: real-Postgres proof that
 * GET /api/predictive/insights reads persisted forecasts and returns grounded
 * executive insights (deterministic path when no LLM key), org-scoped.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { bootstrapTestDb, type TestDbSeed } from "./testDb.js";
import { withTenant } from "../../src/api/infra/postgres.js";
import { getPredictiveInsights } from "../../src/api/routes/predictiveIntelligence.js";
import type { Request, Response } from "express";

const EAR = "SECURELOGIC_ASSET_REGISTRY_ENABLED";
const PRED = "SECURELOGIC_PREDICTIVE_INTELLIGENCE_ENABLED";

let seed: TestDbSeed;
let pool: Pool;
const prev: Record<string, string | undefined> = {};
let prevKey: string | undefined;

function mockRes(): Response & { _status?: number; _json?: unknown } {
  const res = {
    _status: 0, _json: undefined,
    status(c: number) { (this as { _status: number })._status = c; return this; },
    json(b: unknown) { (this as { _json: unknown })._json = b; return this; }
  };
  return res as unknown as Response & { _status?: number; _json?: unknown };
}
const reqFor = (orgId: string): Request => ({ organizationContext: { organizationId: orgId }, query: {}, params: {} }) as unknown as Request;

async function seedForecast(orgId: string, dimension: string, metric: string, trend: string, projected: number, confidence: number): Promise<void> {
  await pool.query(
    `INSERT INTO risk_forecasts
       (organization_id, dimension, metric, horizon_days, method, projected_value, trend, confidence, in_sample_rmse, sample_size, reasoning, forecast_date)
     VALUES ($1, $2, $3, 30, 'holt_linear', $4, $5, $6, 1, 8, '["fit"]'::jsonb, CURRENT_DATE)
     ON CONFLICT (organization_id, dimension, metric, horizon_days) DO UPDATE SET projected_value = EXCLUDED.projected_value`,
    [orgId, dimension, metric, projected, trend, confidence]
  );
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  for (const f of [EAR, PRED]) { prev[f] = process.env[f]; process.env[f] = "true"; }
  // Force the deterministic path deterministically (CI may or may not set a key).
  prevKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL not set for predictive insights test.");
  pool = new Pool({ connectionString: url, ssl: false });
}, 120_000);

afterAll(async () => {
  for (const f of [EAR, PRED]) { if (prev[f] === undefined) delete process.env[f]; else process.env[f] = prev[f]; }
  if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = prevKey;
  await pool?.end();
});

describe("ERIP E5b — predictive insights endpoint", () => {
  it("returns grounded deterministic insights over the org's forecasts", async () => {
    await seedForecast(seed.orgA.id, "vendor", "avg_risk", "increasing", 88, 80);
    await seedForecast(seed.orgA.id, "endpoint", "avg_risk", "increasing", 55, 60);

    const res = mockRes();
    await withTenant(seed.orgA.id, () => getPredictiveInsights(reqFor(seed.orgA.id), res));
    expect(res._status).toBe(200);
    const body = res._json as { insights: { source: string; headline: string; recommendations: Array<{ dimension: string }> } };
    expect(body.insights.source).toBe("deterministic"); // no ANTHROPIC_API_KEY
    expect(body.insights.headline).toContain("vendor");
    // Every recommendation references a real forecast dimension (grounding).
    expect(body.insights.recommendations.every((r) => ["vendor", "endpoint"].includes(r.dimension))).toBe(true);
  });

  it("org B with no forecasts gets a no-increase headline (org-scoped)", async () => {
    const res = mockRes();
    await withTenant(seed.orgB.id, () => getPredictiveInsights(reqFor(seed.orgB.id), res));
    const body = res._json as { insights: { headline: string; recommendations: unknown[] } };
    expect(body.insights.headline).toContain("No dimension");
    expect(body.insights.recommendations).toEqual([]);
  });
});
