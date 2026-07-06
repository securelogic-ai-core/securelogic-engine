/**
 * postureForecast.test.ts — ERIP Epic 5: real-Postgres proof that
 * GET /api/predictive/posture-forecast fits the org's posture-score history
 * and projects it at a horizon, deterministically and org-scoped.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { bootstrapTestDb, type TestDbSeed } from "./testDb.js";
import { withTenant } from "../../src/api/infra/postgres.js";
import { getPostureForecast } from "../../src/api/routes/predictiveIntelligence.js";
import type { Request, Response } from "express";

const PRED_FLAG = "SECURELOGIC_PREDICTIVE_INTELLIGENCE_ENABLED";

let seed: TestDbSeed;
let pool: Pool;
let prevFlag: string | undefined;

function mockRes(): Response & { _status?: number; _json?: unknown } {
  const res = {
    _status: 0, _json: undefined,
    status(code: number) { (this as { _status: number })._status = code; return this; },
    json(body: unknown) { (this as { _json: unknown })._json = body; return this; }
  };
  return res as unknown as Response & { _status?: number; _json?: unknown };
}

function reqFor(orgId: string, horizon?: string): Request {
  return {
    organizationContext: { organizationId: orgId },
    query: horizon ? { horizon_days: horizon } : {}
  } as unknown as Request;
}

/** Insert a posture snapshot `daysAgo` back with the given score. */
async function seedSnapshot(orgId: string, daysAgo: number, score: number): Promise<void> {
  await pool.query(
    `INSERT INTO posture_snapshots (organization_id, snapshot_date, overall_score, overall_severity,
        open_finding_count, open_action_count, overdue_action_count, computation_rationale)
     VALUES ($1, CURRENT_DATE - $2::int, $3, 'Moderate', 1, 1, 0, '{}'::jsonb)`,
    [orgId, daysAgo, score]
  );
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  prevFlag = process.env[PRED_FLAG];
  process.env[PRED_FLAG] = "true";
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the posture forecast test.");
  pool = new Pool({ connectionString: url, ssl: false });
}, 120_000);

afterAll(async () => {
  if (prevFlag === undefined) delete process.env[PRED_FLAG];
  else process.env[PRED_FLAG] = prevFlag;
  await pool?.end();
});

describe("ERIP Epic 5 — posture forecast", () => {
  it("fits a rising posture series and projects an increasing trend", async () => {
    // Scores 40→50→60→70 over the last 30..0 days (steady rise).
    await seedSnapshot(seed.orgA.id, 30, 40);
    await seedSnapshot(seed.orgA.id, 20, 50);
    await seedSnapshot(seed.orgA.id, 10, 60);
    await seedSnapshot(seed.orgA.id, 0, 70);

    const res = mockRes();
    await withTenant(seed.orgA.id, () => getPostureForecast(reqFor(seed.orgA.id, "30"), res));
    expect(res._status).toBe(200);
    const body = res._json as {
      metric: string;
      horizon_days: number;
      observations: unknown[];
      forecast: { trend: string; slope: number; projected_value: number; insufficient_data: boolean; confidence: number };
    };
    expect(body.metric).toBe("posture_overall_score");
    expect(body.observations).toHaveLength(4);
    expect(body.forecast.insufficient_data).toBe(false);
    expect(body.forecast.trend).toBe("increasing");
    expect(body.forecast.slope).toBeGreaterThan(0);
    expect(body.forecast.projected_value).toBeGreaterThan(70); // beyond the last observation
    expect(body.forecast.confidence).toBeGreaterThan(0);
  });

  it("reports insufficient_data when the org has a single snapshot", async () => {
    await seedSnapshot(seed.orgB.id, 0, 55);
    const res = mockRes();
    await withTenant(seed.orgB.id, () => getPostureForecast(reqFor(seed.orgB.id), res));
    const body = res._json as { observations: unknown[]; forecast: { insufficient_data: boolean; projected_value: number } };
    expect(body.observations).toHaveLength(1); // org-scoped — org-A's 4 not visible
    expect(body.forecast.insufficient_data).toBe(true);
    expect(body.forecast.projected_value).toBe(55);
  });

  it("rejects an out-of-range horizon", async () => {
    const res = mockRes();
    await withTenant(seed.orgA.id, () => getPostureForecast(reqFor(seed.orgA.id, "9999"), res));
    expect(res._status).toBe(400);
  });
});
