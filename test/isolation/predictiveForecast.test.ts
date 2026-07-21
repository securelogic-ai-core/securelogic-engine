/**
 * predictiveForecast.test.ts — ERIP E5: real-Postgres proof that the inference
 * worker fits forecasts over risk_history, persists them, the read API returns
 * them, re-running re-fits (retraining), and it self-gates + org-isolates.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { bootstrapTestDb, type TestDbSeed } from "./testDb.js";
import { withTenant } from "../../src/api/infra/postgres.js";
import { runForecastInference } from "../../src/api/workers/predictiveForecastWorker.js";
import { getRiskForecasts } from "../../src/api/routes/predictiveIntelligence.js";
import type { Request, Response } from "express";

const EAR = "SECURELOGIC_ASSET_REGISTRY_ENABLED";
const PRED = "SECURELOGIC_PREDICTIVE_INTELLIGENCE_ENABLED";

let seed: TestDbSeed;
let pool: Pool;
const prev: Record<string, string | undefined> = {};

function mockRes(): Response & { _status?: number; _json?: unknown } {
  const res = {
    _status: 0, _json: undefined,
    status(c: number) { (this as { _status: number })._status = c; return this; },
    json(b: unknown) { (this as { _json: unknown })._json = b; return this; }
  };
  return res as unknown as Response & { _status?: number; _json?: unknown };
}
const reqFor = (orgId: string): Request => ({ organizationContext: { organizationId: orgId }, query: {}, params: {} }) as unknown as Request;

/** Seed a risk_history point `daysAgo` back. */
async function seedHistory(orgId: string, dimension: string, daysAgo: number, avg: number, atRisk: number): Promise<void> {
  await pool.query(
    `INSERT INTO risk_history (organization_id, snapshot_date, dimension, asset_count, at_risk_count, max_risk, avg_risk, bands)
     VALUES ($1, CURRENT_DATE - $2::int, $3, 10, $4, 90, $5, '{}'::jsonb)
     ON CONFLICT (organization_id, snapshot_date, dimension) DO UPDATE SET avg_risk = EXCLUDED.avg_risk, at_risk_count = EXCLUDED.at_risk_count`,
    [orgId, daysAgo, dimension, atRisk, avg]
  );
}

async function forecasts(orgId: string): Promise<Array<{ dimension: string; metric: string; trend: string; projected_value: string; confidence: number }>> {
  const r = await pool.query(
    `SELECT dimension, metric, trend, projected_value::text, confidence FROM risk_forecasts
      WHERE organization_id = $1 ORDER BY dimension, metric`,
    [orgId]
  );
  return r.rows;
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  for (const f of [EAR, PRED]) { prev[f] = process.env[f]; process.env[f] = "true"; }
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL not set for predictive forecast test.");
  pool = new Pool({ connectionString: url, ssl: false });
}, 120_000);

afterAll(async () => {
  for (const f of [EAR, PRED]) { if (prev[f] === undefined) delete process.env[f]; else process.env[f] = prev[f]; }
  await pool?.end();
});

describe("ERIP E5 — predictive forecast inference", () => {
  it("fits + persists forecasts over a rising history, read via the API", async () => {
    // A steadily rising enterprise series over the last ~40 days.
    for (let d = 40; d >= 0; d -= 8) {
      const step = (40 - d) / 8; // 0..5
      await seedHistory(seed.orgA.id, "enterprise", d, 30 + step * 8, 1 + step);
    }

    const n = await runForecastInference({ today: () => "2026-07-06" });
    expect(n).toBeGreaterThanOrEqual(1);

    const rows = await forecasts(seed.orgA.id);
    const avg = rows.find((r) => r.dimension === "enterprise" && r.metric === "avg_risk")!;
    expect(avg.trend).toBe("increasing");
    expect(Number(avg.projected_value)).toBeGreaterThan(70); // beyond the last observed
    expect(avg.confidence).toBeGreaterThan(0);
    const atRisk = rows.find((r) => r.metric === "at_risk_count")!;
    expect(atRisk.trend).toBe("increasing");

    // Read API returns them.
    const res = mockRes();
    await withTenant(seed.orgA.id, () => getRiskForecasts(reqFor(seed.orgA.id), res));
    expect(res._status).toBe(200);
    const body = res._json as { forecasts: Array<{ metric: string; reasoning: string[] }> };
    expect(body.forecasts.length).toBeGreaterThanOrEqual(2);
    expect(body.forecasts.every((f) => Array.isArray(f.reasoning) && f.reasoning.length > 0)).toBe(true);
  });

  it("re-running upserts (retraining) — no duplicate rows for the same key", async () => {
    const before = (await forecasts(seed.orgA.id)).length;
    await runForecastInference({ today: () => "2026-07-07" });
    const after = (await forecasts(seed.orgA.id)).length;
    expect(after).toBe(before); // same (dimension, metric, horizon) keys upserted
  });

  it("self-gates + org-isolates: flag off writes nothing; RLS blocks cross-org", async () => {
    process.env[PRED] = "false";
    try {
      expect(await runForecastInference({ today: () => "2026-07-08" })).toBe(0);
    } finally {
      process.env[PRED] = "true";
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgB.id]);
      const r = await client.query(`SELECT count(*)::int AS n FROM risk_forecasts WHERE organization_id = $1`, [seed.orgA.id]);
      expect(r.rows[0].n).toBe(0); // org B cannot see org A forecasts
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });
});
