/**
 * assetAtRiskDrillThrough.test.ts — the executive "Assets at risk" tile and the list it
 * opens are ONE number (Metric Contract, drill-through arm).
 *
 * The tile counts `at_risk_count` from a rollup computed in TypeScript
 * (gatherAssetRisk → rollupRiskByDimension: own_risk > 0). Its destination,
 * GET /api/assets?at_risk=true, has to reproduce that population from a SQL predicate.
 * Two languages, one definition — so the only thing standing between them and silent
 * drift is this file.
 *
 * Both sides are therefore DERIVED from `DECISION_RISK` (sqlAssetOwnRisk builds the CASE
 * from the same map the rollup scores with), and every assertion below compares the two
 * surfaces against each other rather than against a hardcoded number.
 *
 * The cases that matter, i.e. the ones a hand-written predicate gets wrong:
 *
 *   ROUNDING     `needs_review` (base 40) at 1% confidence scores 0.4 → rounds to 0 →
 *                NOT at risk. A `decision IN ('affected','needs_review',...)` predicate
 *                would have counted it, and the tile and the list would disagree by one.
 *   LATEST-WINS  applicability is a WORM ledger. An asset whose LATEST decision is
 *                not_affected is not at risk, however alarming its history. Both sides
 *                must resolve "current" the same way — hence the shared CTE.
 *   ZERO-BASE    not_affected (base 0) at 100% confidence is still 0. Presence of a
 *                decision is not risk.
 *   TENANCY      org B's at-risk assets appear in neither org A's tile nor its list.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import request from "supertest";
import type { Express, Request, Response } from "express";

import { bootstrapTestDb, type TestDbSeed } from "./testDb.js";
import { withTenant } from "../../src/api/infra/postgres.js";
import { getRiskDimensions } from "../../src/api/routes/riskIntelligence.js";

const ECL_FLAG = "SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED";
const EAR_FLAG = "SECURELOGIC_ASSET_REGISTRY_ENABLED";
const RISK_FLAG = "SECURELOGIC_RISK_INTELLIGENCE_ENABLED";

let seed: TestDbSeed;
let pool: Pool;
let app: Express;
const prevFlags: Record<string, string | undefined> = {};
let prevHash = 0;

/** The org-A assets, by the role each one plays in the contract. */
let epAffected: string;      // affected @100 → 90 → AT RISK
let epRoundsToZero: string;  // needs_review @1 → 0.4 → rounds to 0 → not at risk
let epSuperseded: string;    // affected, THEN not_affected → latest wins → not at risk
let epNoDecision: string;    // never assessed → not at risk
let epNotAffected: string;   // not_affected @100 → base 0 → not at risk
let crAtRisk: string;        // cloud_resource, needs_review @100 → 40 → AT RISK

function mockRes(): Response & { _status?: number; _json?: unknown } {
  const res = {
    _status: 0, _json: undefined,
    status(code: number) { (this as { _status: number })._status = code; return this; },
    json(body: unknown) { (this as { _json: unknown })._json = body; return this; }
  };
  return res as unknown as Response & { _status?: number; _json?: unknown };
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

async function seedCloudResourceAsset(orgId: string, name: string): Promise<string> {
  return withTenant(orgId, async () => {
    const detail = await pool.query(
      `INSERT INTO cloud_resources (organization_id, name, status, external_ref, provider)
       VALUES ($1, $2, 'active', $3, 'aws') RETURNING id`,
      [orgId, name, `ext-${name}`]
    );
    const asset = await pool.query(
      `INSERT INTO assets (organization_id, asset_type, backing_kind, backing_id, lifecycle_status)
       VALUES ($1, 'cloud_resource', 'cloud_resources', $2, 'active') RETURNING id`,
      [orgId, detail.rows[0].id]
    );
    await pool.query(`UPDATE cloud_resources SET asset_id = $1 WHERE id = $2`, [asset.rows[0].id, detail.rows[0].id]);
    return asset.rows[0].id as string;
  });
}

/** Append one decision to the WORM ledger. Called twice for the superseded asset. */
async function seedDecision(orgId: string, assetId: string, decision: string, confidence: number): Promise<void> {
  prevHash += 1;
  await pool.query(
    `INSERT INTO applicability_assessments
       (organization_id, signal_id, target_type, target_id, asset_id, decision, confidence,
        confidence_band, reasoning_steps, engine_version, schema_version, content_hash, prev_hash)
     VALUES ($1, gen_random_uuid(), 'vendor', gen_random_uuid(), $2, $3, $4,
        'high', '[]'::jsonb, 'v1', 'v1', $5, $6)`,
    [orgId, assetId, decision, confidence, `ar-h-${prevHash}`, `ar-p-${prevHash}`]
  );
}

/** The TILE's number: the rollup the executive dashboard reads. */
async function tileCounts(orgId: string): Promise<{ overall: number; byType: Record<string, number> }> {
  const res = mockRes();
  await withTenant(orgId, () =>
    getRiskDimensions(
      { organizationContext: { organizationId: orgId }, query: {} } as unknown as Request,
      res
    )
  );
  expect(res._status).toBe(200);
  const body = res._json as {
    risk: {
      overall: { at_risk_count: number };
      by_asset_type: Array<{ dimension: string; at_risk_count: number }>;
    };
  };
  const byType: Record<string, number> = {};
  for (const d of body.risk.by_asset_type) byType[d.dimension] = d.at_risk_count;
  return { overall: body.risk.overall.at_risk_count, byType };
}

/** The DESTINATION's number: the list the tile opens. */
async function listAtRisk(
  orgId: string,
  apiKey: string,
  assetType?: string
): Promise<{ total: number; ids: string[] }> {
  const q = new URLSearchParams({ at_risk: "true", limit: "100" });
  if (assetType) q.set("asset_type", assetType);
  const res = await request(app).get(`/api/assets?${q}`).set("X-Api-Key", apiKey);
  expect(res.status).toBe(200);
  return {
    total: res.body.total as number,
    ids: (res.body.assets as Array<{ asset_id: string }>).map((a) => a.asset_id),
  };
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  for (const f of [ECL_FLAG, EAR_FLAG, RISK_FLAG]) {
    prevFlags[f] = process.env[f];
    process.env[f] = "true";
  }
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the at-risk drill-through test.");
  pool = new Pool({ connectionString: url, ssl: false });

  // The list route is capability-gated; grant it to both orgs so the test proves the
  // FILTER's scoping, not the gate's (which enterpriseContextGating.test.ts owns).
  await pool.query(
    `UPDATE organizations SET enterprise_context_capability = true WHERE id = ANY($1::uuid[])`,
    [[seed.orgA.id, seed.orgB.id]]
  );

  // createApp imported only now — infra/postgres.ts needs DATABASE_URL at import.
  const { createApp } = await import("../../src/api/app.js");
  app = createApp({ isDev: false, publicApiDisabled: false });

  epAffected = await seedEndpointAsset(seed.orgA.id, "ar-affected");
  epRoundsToZero = await seedEndpointAsset(seed.orgA.id, "ar-rounds-to-zero");
  epSuperseded = await seedEndpointAsset(seed.orgA.id, "ar-superseded");
  epNoDecision = await seedEndpointAsset(seed.orgA.id, "ar-no-decision");
  epNotAffected = await seedEndpointAsset(seed.orgA.id, "ar-not-affected");
  crAtRisk = await seedCloudResourceAsset(seed.orgA.id, "ar-cloud-at-risk");

  await seedDecision(seed.orgA.id, epAffected, "affected", 100);        // 90
  await seedDecision(seed.orgA.id, epRoundsToZero, "needs_review", 1);  // 0.4 → 0
  await seedDecision(seed.orgA.id, epNotAffected, "not_affected", 100); // 0
  await seedDecision(seed.orgA.id, crAtRisk, "needs_review", 100);      // 40
  // The ledger, in order: alarming, then cleared. Only the LAST one counts.
  await seedDecision(seed.orgA.id, epSuperseded, "affected", 100);
  await seedDecision(seed.orgA.id, epSuperseded, "not_affected", 100);
  // epNoDecision: deliberately never assessed.

  // Org B: an at-risk asset that must appear in neither of org A's surfaces.
  const bAsset = await seedEndpointAsset(seed.orgB.id, "ar-org-b");
  await seedDecision(seed.orgB.id, bAsset, "affected", 100);
}, 180_000);

afterAll(async () => {
  for (const f of [ECL_FLAG, EAR_FLAG, RISK_FLAG]) {
    if (prevFlags[f] === undefined) delete process.env[f];
    else process.env[f] = prevFlags[f];
  }
  await pool?.end();
});

describe("Metric Contract — the 'Assets at risk' tile and the list it opens are one number", () => {
  it("the enterprise tile's count IS the total of its destination list", async () => {
    const tile = await tileCounts(seed.orgA.id);
    const list = await listAtRisk(seed.orgA.id, seed.orgA.apiKey);

    // The contract, asserted between the two surfaces — not against a literal.
    expect(list.total).toBe(tile.overall);

    // And it is the population we actually seeded: the 90 and the 40, nothing else.
    expect(tile.overall).toBe(2);
    expect(new Set(list.ids)).toEqual(new Set([epAffected, crAtRisk]));
  });

  it("a dimension tile's count IS the total of its dimension-scoped list", async () => {
    const tile = await tileCounts(seed.orgA.id);

    const endpoints = await listAtRisk(seed.orgA.id, seed.orgA.apiKey, "endpoint");
    expect(endpoints.total).toBe(tile.byType.endpoint);
    expect(endpoints.ids).toEqual([epAffected]);

    const cloud = await listAtRisk(seed.orgA.id, seed.orgA.apiKey, "cloud_resource");
    expect(cloud.total).toBe(tile.byType.cloud_resource);
    expect(cloud.ids).toEqual([crAtRisk]);

    // The scoped totals partition the enterprise total — the drill-through is a
    // refinement of the same population, not a different one.
    expect(endpoints.total + cloud.total).toBe(tile.overall);
  });

  it("a decision that ROUNDS to zero is not at risk (needs_review @1% → 0.4 → 0)", async () => {
    // The case a hand-written `decision IN (...)` predicate gets wrong: the decision is
    // one of the "risky" ones, but at 1% confidence it scores 0.4, rounds to 0, and the
    // rollup does not count it. The list must not either.
    const list = await listAtRisk(seed.orgA.id, seed.orgA.apiKey);
    expect(list.ids).not.toContain(epRoundsToZero);
  });

  it("latest-wins: an asset cleared by its most recent decision is not at risk", async () => {
    // epSuperseded's ledger reads affected@100 → not_affected@100. Both surfaces must
    // resolve "current" over the WORM ledger identically, or a cleared asset stays lit
    // on one screen and not the other.
    const list = await listAtRisk(seed.orgA.id, seed.orgA.apiKey);
    expect(list.ids).not.toContain(epSuperseded);
  });

  it("a zero-base decision and no decision at all are both not at risk", async () => {
    const list = await listAtRisk(seed.orgA.id, seed.orgA.apiKey);
    expect(list.ids).not.toContain(epNotAffected); // not_affected @100 is still 0
    expect(list.ids).not.toContain(epNoDecision);  // never assessed
  });

  it("the filter NARROWS: without at_risk the list is the whole registry", async () => {
    // Guards the degenerate pass — if at_risk were ignored, every assertion above that
    // compares two totals would still hold while the filter did nothing.
    const all = await request(app)
      .get("/api/assets?limit=100")
      .set("X-Api-Key", seed.orgA.apiKey);
    expect(all.status).toBe(200);
    expect(all.body.total).toBe(6); // all six org-A assets
    const atRisk = await listAtRisk(seed.orgA.id, seed.orgA.apiKey);
    expect(atRisk.total).toBeLessThan(all.body.total as number);
  });

  it("tenant isolation: org B's at-risk asset is in neither of org A's surfaces", async () => {
    const aList = await listAtRisk(seed.orgA.id, seed.orgA.apiKey);
    expect(aList.total).toBe(2); // org B's affected@100 endpoint is not among them

    // And org B sees its own — the filter is scoped, not globally broken.
    const bTile = await tileCounts(seed.orgB.id);
    const bList = await listAtRisk(seed.orgB.id, seed.orgB.apiKey);
    expect(bList.total).toBe(bTile.overall);
    expect(bList.total).toBe(1);
    expect(aList.ids).not.toContain(bList.ids[0]);
  });
});
