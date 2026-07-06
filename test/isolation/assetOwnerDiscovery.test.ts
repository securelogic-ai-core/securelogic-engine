/**
 * assetOwnerDiscovery.test.ts — ERIP E2.P4: real-Postgres owner + metadata
 * discovery (ERIP-AD-13, suggest-only). A ServiceNow sync carries assigned_to
 * (owner hint) + os/ip (metadata) into the observation ledger; the discovery
 * endpoint resolves the owner and matches it to an org user WITHOUT assigning
 * anything canonical.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { bootstrapTestDb, type TestDbSeed } from "./testDb.js";
import { withTenant } from "../../src/api/infra/postgres.js";
import { upsertConnectorConfig } from "../../src/api/lib/connectorConfigStore.js";
import { claimNextJob, processClaimedJob } from "../../src/api/workers/connectorSyncWorker.js";
import { getAssetDiscovery } from "../../src/api/routes/assets.js";
import type { HttpClient } from "../../src/api/lib/connectors/types.js";
import type { Request, Response } from "express";

const ECL_FLAG = "SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED";
const EAR_FLAG = "SECURELOGIC_ASSET_REGISTRY_ENABLED";

let seed: TestDbSeed;
let pool: Pool;
const prev: Record<string, string | undefined> = {};

function cmdbHttp(rows: unknown[]): HttpClient {
  return {
    async getJson(url) {
      if (url.includes("/api/now/table/cmdb_ci")) return { result: rows };
      throw new Error(`unexpected GET ${url}`);
    }
  };
}

function mockRes(): Response & { _status?: number; _json?: unknown } {
  const res = {
    _status: 0, _json: undefined,
    status(code: number) { (this as { _status: number })._status = code; return this; },
    json(body: unknown) { (this as { _json: unknown })._json = body; return this; }
  };
  return res as unknown as Response & { _status?: number; _json?: unknown };
}

async function runCmdbSync(orgId: string, rows: unknown[]): Promise<void> {
  await pool.query(
    `INSERT INTO jobs (organization_id, job_type, payload)
     VALUES ($1, 'connector_sync', '{"connector_id":"servicenow_cmdb"}'::jsonb)`,
    [orgId]
  );
  const job = await claimNextJob("owner-test-worker");
  expect(job).not.toBeNull();
  await processClaimedJob(job!, { http: cmdbHttp(rows) });
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  for (const f of [ECL_FLAG, EAR_FLAG]) {
    prev[f] = process.env[f];
    process.env[f] = "true";
  }
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the owner discovery test.");
  pool = new Pool({ connectionString: url, ssl: false });
  await withTenant(seed.orgA.id, async () => {
    await upsertConnectorConfig(seed.orgA.id, "servicenow_cmdb", {
      instance_url: "https://corp.service-now.com", username: "u", password: "p"
    }, true);
  });
}, 120_000);

afterAll(async () => {
  for (const f of [ECL_FLAG, EAR_FLAG]) {
    if (prev[f] === undefined) delete process.env[f];
    else process.env[f] = prev[f];
  }
  await pool?.end();
});

describe("ERIP E2.P4 — owner + metadata discovery", () => {
  it("carries owner_hint + metadata into observations and suggests a matching org user", async () => {
    // A user in org A whose email the CMDB will report as the CI owner.
    const email = `owner-${Date.now()}@corp.com`;
    const user = await pool.query(
      `INSERT INTO users (organization_id, email, name, password_hash)
       VALUES ($1, $2, 'Discovered Owner', 'x') RETURNING id`,
      [seed.orgA.id, email]
    );
    const userId = user.rows[0].id as string;

    await runCmdbSync(seed.orgA.id, [
      {
        sys_id: "ci-owner-1",
        name: "billing-app-01",
        sys_class_name: "cmdb_ci_server",
        sys_updated_on: "2026-07-05 10:00:00",
        assigned_to: email,
        os: "RHEL 9",
        ip_address: "10.1.2.3"
      }
    ]);

    // The observation carries the hint + metadata.
    const obs = await pool.query(
      `SELECT owner_hint, metadata FROM connector_asset_observations
        WHERE organization_id = $1 AND external_ref = 'ci-owner-1'`,
      [seed.orgA.id]
    );
    expect(obs.rows[0].owner_hint).toBe(email);
    expect(obs.rows[0].metadata).toMatchObject({ os: "RHEL 9", ip_address: "10.1.2.3" });

    // Resolve the enterprise_entity asset id the sync created (CMDB → import lane).
    const asset = await pool.query(
      `SELECT a.id FROM assets a
         JOIN enterprise_entities e ON e.id = a.backing_id
        WHERE a.organization_id = $1 AND e.external_ref = 'ci-owner-1' LIMIT 1`,
      [seed.orgA.id]
    );
    expect(asset.rowCount).toBe(1);
    const assetId = asset.rows[0].id as string;

    const res = mockRes();
    await withTenant(seed.orgA.id, () =>
      getAssetDiscovery({ organizationContext: { organizationId: seed.orgA.id }, params: { id: assetId } } as unknown as Request, res)
    );
    expect(res._status).toBe(200);
    const body = res._json as {
      discovery: { effective_owner_hint: { value: string } | null; metadata: Record<string, string> };
      suggested_owner: { user_id: string; email: string } | null;
    };
    expect(body.discovery.effective_owner_hint?.value).toBe(email);
    expect(body.discovery.metadata).toMatchObject({ os: "RHEL 9", ip_address: "10.1.2.3" });
    // Suggest-only: the endpoint surfaces the match; nothing is assigned.
    expect(body.suggested_owner).toEqual({ user_id: userId, email, name: "Discovered Owner" });

    // Canonical owner was NOT auto-assigned by discovery.
    const canonical = await pool.query(
      `SELECT owner_user_id FROM enterprise_entities WHERE external_ref = 'ci-owner-1' AND organization_id = $1`,
      [seed.orgA.id]
    );
    expect(canonical.rows[0].owner_user_id).toBeNull();
  });

  it("suggests no owner when the hint matches no org user", async () => {
    await runCmdbSync(seed.orgA.id, [
      {
        sys_id: "ci-owner-2",
        name: "unowned-host-02",
        sys_class_name: "cmdb_ci_server",
        sys_updated_on: "2026-07-05 11:00:00",
        assigned_to: "stranger@nowhere.example"
      }
    ]);
    const asset = await pool.query(
      `SELECT a.id FROM assets a JOIN enterprise_entities e ON e.id = a.backing_id
        WHERE a.organization_id = $1 AND e.external_ref = 'ci-owner-2' LIMIT 1`,
      [seed.orgA.id]
    );
    const res = mockRes();
    await withTenant(seed.orgA.id, () =>
      getAssetDiscovery({ organizationContext: { organizationId: seed.orgA.id }, params: { id: asset.rows[0].id } } as unknown as Request, res)
    );
    const body = res._json as { discovery: { effective_owner_hint: { value: string } | null }; suggested_owner: unknown };
    expect(body.discovery.effective_owner_hint?.value).toBe("stranger@nowhere.example");
    expect(body.suggested_owner).toBeNull();
  });
});
