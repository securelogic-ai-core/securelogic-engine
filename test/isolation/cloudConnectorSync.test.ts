/**
 * cloudConnectorSync.test.ts — ERIP E2.P5: real-Postgres proof that a native
 * cloud connector (Azure — OAuth client-creds via a fake HttpClient) configures
 * (20260813 CHECK admits 'azure'), syncs, and lands cloud_resource detail
 * assets with provider stamped from the adapter (not config). Org-isolated.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { bootstrapTestDb, type TestDbSeed } from "./testDb.js";
import { withTenant } from "../../src/api/infra/postgres.js";
import { upsertConnectorConfig } from "../../src/api/lib/connectorConfigStore.js";
import { claimNextJob, processClaimedJob } from "../../src/api/workers/connectorSyncWorker.js";
import type { HttpClient } from "../../src/api/lib/connectors/types.js";

const ECL_FLAG = "SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED";
const EAR_FLAG = "SECURELOGIC_ASSET_REGISTRY_ENABLED";

let seed: TestDbSeed;
let pool: Pool;
const prev: Record<string, string | undefined> = {};

const azureHttp: HttpClient = {
  async getJson(url) {
    if (url.includes("/resources")) {
      return {
        value: [
          { id: "/subscriptions/s/rg/vm-a", name: "vm-a", type: "Microsoft.Compute/virtualMachines", location: "eastus" },
          { id: "/subscriptions/s/rg/vm-b", name: "vm-b", type: "Microsoft.Compute/virtualMachines", location: "westus" }
        ]
      };
    }
    throw new Error(`unexpected GET ${url}`);
  },
  async postForm() {
    return { access_token: "fake-token" };
  }
};

beforeAll(async () => {
  seed = await bootstrapTestDb();
  for (const f of [ECL_FLAG, EAR_FLAG]) {
    prev[f] = process.env[f];
    process.env[f] = "true";
  }
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the cloud connector test.");
  pool = new Pool({ connectionString: url, ssl: false });
}, 120_000);

afterAll(async () => {
  for (const f of [ECL_FLAG, EAR_FLAG]) {
    if (prev[f] === undefined) delete process.env[f];
    else process.env[f] = prev[f];
  }
  await pool?.end();
});

describe("ERIP E2.P5 — native cloud connector sync", () => {
  it("configures 'azure' (20260813 CHECK) and syncs cloud_resource assets with provider='azure'", async () => {
    await withTenant(seed.orgA.id, async () => {
      await upsertConnectorConfig(seed.orgA.id, "azure", {
        tenant_id: "t", client_id: "c", client_secret: "s", subscription_id: "sub-1"
      }, true);
    });

    await pool.query(
      `INSERT INTO jobs (organization_id, job_type, payload)
       VALUES ($1, 'connector_sync', '{"connector_id":"azure"}'::jsonb)`,
      [seed.orgA.id]
    );
    const job = await claimNextJob("cloud-test-worker");
    expect(job).not.toBeNull();
    await processClaimedJob(job!, { http: azureHttp });

    const rows = await pool.query(
      `SELECT name, provider, external_ref FROM cloud_resources
        WHERE organization_id = $1 ORDER BY name`,
      [seed.orgA.id]
    );
    expect(rows.rows.map((r) => r.name)).toEqual(["vm-a", "vm-b"]);
    expect(rows.rows.every((r) => r.provider === "azure")).toBe(true);

    // Registered in the registry + visible through the federated view.
    const view = await pool.query(
      `SELECT count(*)::int AS n FROM asset_registry_v
        WHERE organization_id = $1 AND asset_type = 'cloud_resource'`,
      [seed.orgA.id]
    );
    expect(view.rows[0].n).toBe(2);

    // Org B saw nothing.
    const other = await pool.query(
      `SELECT count(*)::int AS n FROM cloud_resources WHERE organization_id = $1`,
      [seed.orgB.id]
    );
    expect(other.rows[0].n).toBe(0);
  });
});
