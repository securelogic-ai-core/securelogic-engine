/**
 * riskTrends.test.ts — ERIP E4: real-Postgres proof that the trends/KPIs/export
 * endpoints read the risk_history series and produce executive views,
 * org-scoped.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { bootstrapTestDb, type TestDbSeed } from "./testDb.js";
import { withTenant } from "../../src/api/infra/postgres.js";
import { getRiskTrends, getRiskKpis, exportRiskHistory } from "../../src/api/routes/riskIntelligence.js";
import type { Request, Response } from "express";

const ECL = "SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED";
const EAR = "SECURELOGIC_ASSET_REGISTRY_ENABLED";
const RISK = "SECURELOGIC_RISK_INTELLIGENCE_ENABLED";

let seed: TestDbSeed;
let pool: Pool;
const prev: Record<string, string | undefined> = {};

function mockRes(): Response & { _status?: number; _json?: unknown; _text?: string; _type?: string } {
  const res = {
    _status: 0, _json: undefined, _text: undefined, _type: undefined,
    status(c: number) { (this as { _status: number })._status = c; return this; },
    json(b: unknown) { (this as { _json: unknown })._json = b; return this; },
    type(t: string) { (this as { _type: string })._type = t; return this; },
    send(b: string) { (this as { _text: string })._text = b; return this; }
  };
  return res as unknown as Response & { _status?: number; _json?: unknown; _text?: string; _type?: string };
}

function reqFor(orgId: string, query: Record<string, string> = {}): Request {
  return { organizationContext: { organizationId: orgId }, query } as unknown as Request;
}

/** Insert a risk_history row `daysAgo` back. */
async function seedHistory(orgId: string, dimension: string, daysAgo: number, avg: number, atRisk: number, max: number, count: number): Promise<void> {
  await pool.query(
    `INSERT INTO risk_history (organization_id, snapshot_date, dimension, asset_count, at_risk_count, max_risk, avg_risk, bands)
     VALUES ($1, CURRENT_DATE - $2::int, $3, $4, $5, $6, $7, '{}'::jsonb)
     ON CONFLICT (organization_id, snapshot_date, dimension) DO UPDATE SET avg_risk = EXCLUDED.avg_risk`,
    [orgId, daysAgo, dimension, count, atRisk, max, avg]
  );
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  for (const f of [ECL, EAR, RISK]) { prev[f] = process.env[f]; process.env[f] = "true"; }
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL not set for risk trends test.");
  pool = new Pool({ connectionString: url, ssl: false });
}, 120_000);

afterAll(async () => {
  for (const f of [ECL, EAR, RISK]) { if (prev[f] === undefined) delete process.env[f]; else process.env[f] = prev[f]; }
  await pool?.end();
});

describe("ERIP E4 — executive trends / KPIs / export", () => {
  it("builds a rising enterprise trend + KPI scorecard", async () => {
    await seedHistory(seed.orgA.id, "enterprise", 20, 30, 1, 60, 10);
    await seedHistory(seed.orgA.id, "enterprise", 10, 45, 2, 75, 10);
    await seedHistory(seed.orgA.id, "enterprise", 0, 60, 3, 90, 10);
    await seedHistory(seed.orgA.id, "endpoint", 0, 60, 3, 90, 10);

    const tRes = mockRes();
    await withTenant(seed.orgA.id, () => getRiskTrends(reqFor(seed.orgA.id, { days: "30" }), tRes));
    expect(tRes._status).toBe(200);
    const tBody = tRes._json as { trends: Array<{ dimension: string; direction: string; avg_risk_change: number; points: unknown[] }> };
    expect(tBody.trends[0].dimension).toBe("enterprise"); // enterprise first
    expect(tBody.trends[0].direction).toBe("up");
    expect(tBody.trends[0].avg_risk_change).toBe(30); // 60 - 30
    expect(tBody.trends[0].points).toHaveLength(3);

    const kRes = mockRes();
    await withTenant(seed.orgA.id, () => getRiskKpis(reqFor(seed.orgA.id, { days: "30" }), kRes));
    const kBody = kRes._json as { kpis: Array<{ key: string; value: number; change: number }> };
    const avg = kBody.kpis.find((c) => c.key === "average_risk")!;
    expect(avg).toMatchObject({ value: 60, change: 30 });
  });

  it("exports CSV, org-scoped", async () => {
    const res = mockRes();
    await withTenant(seed.orgA.id, () => exportRiskHistory(reqFor(seed.orgA.id, { days: "30", format: "csv" }), res));
    expect(res._status).toBe(200);
    expect(res._type).toBe("text/csv");
    expect(res._text!.split("\n")[0]).toBe("dimension,snapshot_date,asset_count,at_risk_count,max_risk,avg_risk");
    expect(res._text!).toContain("enterprise,");

    // Org B (no history) → header only.
    const bRes = mockRes();
    await withTenant(seed.orgB.id, () => exportRiskHistory(reqFor(seed.orgB.id, { days: "30", format: "csv" }), bRes));
    expect(bRes._text!.split("\n")).toHaveLength(1);
  });

  it("rejects an out-of-range window", async () => {
    const res = mockRes();
    await withTenant(seed.orgA.id, () => getRiskTrends(reqFor(seed.orgA.id, { days: "9999" }), res));
    expect(res._status).toBe(400);
  });
});
