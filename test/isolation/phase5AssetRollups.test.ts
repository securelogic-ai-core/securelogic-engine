/**
 * phase5AssetRollups.test.ts — EAR Phase 5: the §4 exit criterion on real
 * Postgres — "exec dashboard asset totals reconcile against per-type counts
 * across all types."
 *
 * Seeds one asset of every backing family (vendor, ai_system, application
 * entity, endpoint detail asset) in org A, then proves:
 *   - the stats endpoint's registry rollup (stats.assets) counts them ALL,
 *   - total ≡ Σ by_type ≡ the per-type table counts (the reconciliation),
 *   - the key is ABSENT while the registry flag is off (dark posture), and
 *   - org B's rollup is fully isolated (all zeros).
 * Both Phase-5 consumers (R6 stats + /api/dashboard/summary) aggregate the
 * same org-scoped GROUP BY over asset_registry_v — this reconciliation is the
 * shared invariant.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import type { Request, Response } from "express";

import { bootstrapTestDb, type TestDbSeed } from "./testDb.js";
import { withTenant } from "../../src/api/infra/postgres.js";
import { getEnterpriseContextStats } from "../../src/api/routes/enterpriseContextStats.js";
import { createDetailAsset } from "../../src/api/lib/assetDetailPersistence.js";

const EAR_FLAG = "SECURELOGIC_ASSET_REGISTRY_ENABLED";

let seed: TestDbSeed;
let pool: Pool;
let prevEar: string | undefined;

type CapturedRes = Response & { _status: number; _json: unknown };
function mockReqRes(orgId: string): { req: Request; res: CapturedRes } {
  const req = { organizationContext: { organizationId: orgId } } as unknown as Request;
  const res = {
    _status: 0,
    _json: undefined as unknown,
    status(code: number) { this._status = code; return this; },
    json(body: unknown) { this._json = body; return this; }
  };
  return { req, res: res as unknown as CapturedRes };
}

async function statsFor(orgId: string): Promise<Record<string, unknown>> {
  const { req, res } = mockReqRes(orgId);
  await withTenant(orgId, () => getEnterpriseContextStats(req, res));
  expect(res._status).toBe(200);
  return (res._json as { stats: Record<string, unknown> }).stats;
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  prevEar = process.env[EAR_FLAG];
  process.env[EAR_FLAG] = "true";
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the phase 5 rollup test.");
  pool = new Pool({ connectionString: url, ssl: false });

  await pool.query(`INSERT INTO vendors (organization_id, name, criticality) VALUES ($1, 'Rollup Vendor', 'high')`, [seed.orgA.id]);
  await pool.query(`INSERT INTO ai_systems (organization_id, name) VALUES ($1, 'Rollup Model')`, [seed.orgA.id]);
  await pool.query(
    `INSERT INTO enterprise_entities (organization_id, entity_type, name, criticality)
     VALUES ($1, 'application', 'Rollup App', 'critical')`,
    [seed.orgA.id]
  );
  await withTenant(seed.orgA.id, () =>
    createDetailAsset(seed.orgA.id, {
      asset_type: "endpoint",
      name: "rollup-laptop",
      criticality: "medium",
      status: "active",
      external_ref: "rollup:ep-1",
      typed: { hostname: "rollup-laptop.corp" }
    })
  );
}, 120_000);

afterAll(async () => {
  if (prevEar === undefined) delete process.env[EAR_FLAG]; else process.env[EAR_FLAG] = prevEar;
  await pool?.end();
});

describe("EAR Phase 5 — registry-wide asset rollup", () => {
  it("stats.assets totals reconcile against per-type counts across all types (§4 exit)", async () => {
    const stats = await statsFor(seed.orgA.id);
    const assets = stats.assets as {
      total: number;
      by_type: Record<string, number>;
      by_criticality: Record<string, number>;
    };
    expect(assets).toBeDefined();

    // Reconciliation 1: total ≡ Σ by_type.
    const sumByType = Object.values(assets.by_type).reduce((s, n) => s + n, 0);
    expect(assets.total).toBe(sumByType);

    // Reconciliation 2: by_type ≡ the authoritative per-type table counts.
    const [vendors, aiSystems, apps, endpoints] = await Promise.all([
      pool.query(`SELECT count(*)::int AS n FROM vendors WHERE organization_id = $1`, [seed.orgA.id]),
      pool.query(`SELECT count(*)::int AS n FROM ai_systems WHERE organization_id = $1`, [seed.orgA.id]),
      pool.query(`SELECT count(*)::int AS n FROM enterprise_entities WHERE organization_id = $1 AND entity_type = 'application'`, [seed.orgA.id]),
      pool.query(`SELECT count(*)::int AS n FROM endpoints WHERE organization_id = $1`, [seed.orgA.id])
    ]);
    expect(assets.by_type.vendor).toBe(vendors.rows[0].n);
    expect(assets.by_type.ai_system).toBe(aiSystems.rows[0].n);
    expect(assets.by_type.application).toBe(apps.rows[0].n);
    expect(assets.by_type.endpoint).toBe(endpoints.rows[0].n);
    expect(assets.by_type.endpoint).toBeGreaterThanOrEqual(1);

    // Criticality rollup sees each backing table's column through the view.
    expect(assets.by_criticality.high).toBeGreaterThanOrEqual(1);     // vendor
    expect(assets.by_criticality.critical).toBeGreaterThanOrEqual(1); // application
    expect(assets.by_criticality.medium).toBeGreaterThanOrEqual(1);   // endpoint
  });

  it("dark posture: the assets key is absent while the registry flag is off", async () => {
    process.env[EAR_FLAG] = "false";
    try {
      const stats = await statsFor(seed.orgA.id);
      expect(stats).not.toHaveProperty("assets");
    } finally {
      process.env[EAR_FLAG] = "true";
    }
  });

  it("tenant isolation: org B's rollup is empty", async () => {
    const stats = await statsFor(seed.orgB.id);
    const assets = stats.assets as { total: number; by_type: Record<string, number> };
    expect(assets.total).toBe(0);
    expect(assets.by_type).toEqual({});
  });
});
