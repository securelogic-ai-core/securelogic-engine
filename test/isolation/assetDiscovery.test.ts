/**
 * assetDiscovery.test.ts — ERIP E2.P3: real-Postgres behavior of
 * GET /api/assets/:id/discovery. Two connectors observe the same host under
 * different external_refs; the discovery view correlates them by name,
 * resolves the effective fields by precedence, scores confidence, and stays
 * org-isolated. Canonical stores are never mutated (ERIP-AD-8).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { bootstrapTestDb, type TestDbSeed } from "./testDb.js";
import { withTenant } from "../../src/api/infra/postgres.js";
import { getAssetDiscovery } from "../../src/api/routes/assets.js";
import type { Request, Response } from "express";

const ECL_FLAG = "SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED";
const EAR_FLAG = "SECURELOGIC_ASSET_REGISTRY_ENABLED";

let seed: TestDbSeed;
let pool: Pool;
const prev: Record<string, string | undefined> = {};

function mockRes(): Response & { _status?: number; _json?: unknown } {
  const res = {
    _status: 0,
    _json: undefined,
    status(code: number) { (this as { _status: number })._status = code; return this; },
    json(body: unknown) { (this as { _json: unknown })._json = body; return this; }
  };
  return res as unknown as Response & { _status?: number; _json?: unknown };
}

function reqFor(orgId: string, id: string): Request {
  return { organizationContext: { organizationId: orgId }, params: { id } } as unknown as Request;
}

/** Insert an endpoint detail asset + its registry row, return the registry id. */
async function seedEndpointAsset(orgId: string, name: string, externalRef: string): Promise<string> {
  return withTenant(orgId, async () => {
    const detail = await pool.query(
      `INSERT INTO endpoints (organization_id, name, status, external_ref, hostname)
       VALUES ($1, $2, 'active', $3, $2) RETURNING id`,
      [orgId, name, externalRef]
    );
    const detailId = detail.rows[0].id as string;
    const asset = await pool.query(
      `INSERT INTO assets (organization_id, asset_type, backing_kind, backing_id, lifecycle_status)
       VALUES ($1, 'endpoint', 'endpoints', $2, 'active') RETURNING id`,
      [orgId, detailId]
    );
    await pool.query(`UPDATE endpoints SET asset_id = $1 WHERE id = $2`, [asset.rows[0].id, detailId]);
    return asset.rows[0].id as string;
  });
}

async function seedObservation(
  orgId: string,
  connectorId: string,
  externalRef: string,
  name: string,
  stale = false
): Promise<void> {
  await withTenant(orgId, async () => {
    await pool.query(
      `INSERT INTO connector_asset_observations
         (organization_id, connector_id, external_ref, lane, entity_type, name, stale)
       VALUES ($1, $2, $3, 'detail', 'endpoint', $4, $5)`,
      [orgId, connectorId, externalRef, name, stale]
    );
  });
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  for (const f of [ECL_FLAG, EAR_FLAG]) {
    prev[f] = process.env[f];
    process.env[f] = "true";
  }
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the asset discovery test.");
  pool = new Pool({ connectionString: url, ssl: false });
}, 120_000);

afterAll(async () => {
  for (const f of [ECL_FLAG, EAR_FLAG]) {
    if (prev[f] === undefined) delete process.env[f];
    else process.env[f] = prev[f];
  }
  await pool?.end();
});

describe("ERIP E2.P3 — asset discovery view", () => {
  it("correlates two connectors by name and resolves effective fields by precedence", async () => {
    const name = "host-corr-01";
    const assetId = await seedEndpointAsset(seed.orgA.id, name, "def-100");
    // Defender saw it as def-100 (its own external_ref, matches the backing);
    // Tenable saw the same host under a different ref, same name.
    await seedObservation(seed.orgA.id, "microsoft_defender", "def-100", name);
    await seedObservation(seed.orgA.id, "tenable", "ten-777", name);

    const res = mockRes();
    await withTenant(seed.orgA.id, () => getAssetDiscovery(reqFor(seed.orgA.id, assetId), res));
    expect(res._status).toBe(200);
    const body = res._json as {
      discovery: { source_count: number; sources: string[]; confidence: number; effective_name: { winning_connector: string } };
      observations: unknown[];
    };
    expect(body.discovery.source_count).toBe(2);
    expect(body.discovery.sources).toEqual(["microsoft_defender", "tenable"]);
    // endpoint (rank 3) outranks vulnerability (rank 2) → Defender wins the name.
    expect(body.discovery.effective_name.winning_connector).toBe("microsoft_defender");
    expect(body.discovery.confidence).toBeGreaterThan(60);
    expect(body.observations).toHaveLength(2);
  });

  it("an asset with no observations returns an empty discovery set", async () => {
    const assetId = await seedEndpointAsset(seed.orgA.id, "host-lonely-02", "def-200");
    const res = mockRes();
    await withTenant(seed.orgA.id, () => getAssetDiscovery(reqFor(seed.orgA.id, assetId), res));
    expect(res._status).toBe(200);
    const body = res._json as { discovery: { source_count: number; confidence: number } };
    expect(body.discovery.source_count).toBe(0);
    expect(body.discovery.confidence).toBe(0);
  });

  it("does not leak another org's observations (org-scoped correlation)", async () => {
    const name = "host-shared-name-03";
    // Same host NAME exists in both orgs; org B also has an observation for it.
    const assetIdA = await seedEndpointAsset(seed.orgA.id, name, "def-300");
    await seedObservation(seed.orgA.id, "microsoft_defender", "def-300", name);
    await seedEndpointAsset(seed.orgB.id, name, "def-300b");
    await seedObservation(seed.orgB.id, "tenable", "ten-300b", name);

    const res = mockRes();
    await withTenant(seed.orgA.id, () => getAssetDiscovery(reqFor(seed.orgA.id, assetIdA), res));
    const body = res._json as { discovery: { sources: string[] } };
    // Only org A's Defender observation — org B's tenable row is invisible.
    expect(body.discovery.sources).toEqual(["microsoft_defender"]);
  });

  it("404s for an unknown asset id", async () => {
    const res = mockRes();
    await withTenant(seed.orgA.id, () =>
      getAssetDiscovery(reqFor(seed.orgA.id, "00000000-0000-4000-8000-000000000000"), res)
    );
    expect(res._status).toBe(404);
  });
});
