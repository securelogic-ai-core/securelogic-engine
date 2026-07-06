/**
 * executiveRiskSummary.test.ts — ERIP Epic 4: real-Postgres proof that
 * GET /api/executive/risk-summary composes the dimensional risk rollup with
 * the org's latest posture snapshot, org-scoped.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { bootstrapTestDb, type TestDbSeed } from "./testDb.js";
import { withTenant } from "../../src/api/infra/postgres.js";
import { getExecutiveRiskSummary } from "../../src/api/routes/riskIntelligence.js";
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

const reqFor = (orgId: string): Request =>
  ({ organizationContext: { organizationId: orgId }, query: {} }) as unknown as Request;

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

async function seedDecision(orgId: string, assetId: string): Promise<void> {
  prevHash += 1;
  await pool.query(
    `INSERT INTO applicability_assessments
       (organization_id, signal_id, target_type, target_id, asset_id, decision, confidence,
        confidence_band, reasoning_steps, engine_version, schema_version, content_hash, prev_hash)
     VALUES ($1, gen_random_uuid(), 'vendor', gen_random_uuid(), $2, 'affected', 100,
        'high', '[]'::jsonb, 'v1', 'v1', $3, $4)`,
    [orgId, assetId, `eh-${prevHash}`, `ep-${prevHash}`]
  );
}

async function seedPosture(orgId: string): Promise<void> {
  await pool.query(
    `INSERT INTO posture_snapshots (organization_id, snapshot_date, overall_score, overall_severity,
        open_finding_count, open_action_count, overdue_action_count, computation_rationale)
     VALUES ($1, CURRENT_DATE, 68, 'Moderate', 3, 2, 0, '{}'::jsonb)`,
    [orgId]
  );
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  for (const f of [ECL_FLAG, EAR_FLAG, RISK_FLAG]) {
    prev[f] = process.env[f];
    process.env[f] = "true";
  }
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the executive summary test.");
  pool = new Pool({ connectionString: url, ssl: false });
}, 120_000);

afterAll(async () => {
  for (const f of [ECL_FLAG, EAR_FLAG, RISK_FLAG]) {
    if (prev[f] === undefined) delete process.env[f];
    else process.env[f] = prev[f];
  }
  await pool?.end();
});

describe("ERIP Epic 4 — executive risk summary", () => {
  it("composes dimensional risk + latest posture, org-scoped", async () => {
    const hot = await seedEndpoint(seed.orgA.id, "ex-hot-01");
    await seedEndpoint(seed.orgA.id, "ex-cool-02");
    await seedDecision(seed.orgA.id, hot);
    await seedPosture(seed.orgA.id);

    const res = mockRes();
    await withTenant(seed.orgA.id, () => getExecutiveRiskSummary(reqFor(seed.orgA.id), res));
    expect(res._status).toBe(200);
    const body = res._json as {
      executive_summary: {
        headline: { overall_risk_band: string; total_assets: number; at_risk_assets: number; top_dimensions: Array<{ dimension: string }> };
        heatmap: Array<{ dimension: string }>;
        posture: { overall_score: number; overall_severity: string } | null;
      };
    };
    expect(body.executive_summary.headline.overall_risk_band).toBe("critical"); // affected@100 = 90
    expect(body.executive_summary.headline.total_assets).toBe(2);
    expect(body.executive_summary.headline.at_risk_assets).toBe(1);
    expect(body.executive_summary.headline.top_dimensions[0].dimension).toBe("endpoint");
    expect(body.executive_summary.posture).toMatchObject({ overall_score: 68, overall_severity: "Moderate" });
  });

  it("returns posture null when the org has no snapshot", async () => {
    await seedEndpoint(seed.orgB.id, "ex-b-01");
    const res = mockRes();
    await withTenant(seed.orgB.id, () => getExecutiveRiskSummary(reqFor(seed.orgB.id), res));
    const body = res._json as { executive_summary: { posture: unknown; headline: { total_assets: number } } };
    expect(body.executive_summary.posture).toBeNull();
    expect(body.executive_summary.headline.total_assets).toBe(1); // org-scoped, no org-A leak
  });
});
