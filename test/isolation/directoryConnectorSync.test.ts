/**
 * directoryConnectorSync.test.ts — ERIP E2.P6: real-Postgres proof that a
 * wave-2 connector configures (20260814 CHECK admits 'github') and syncs.
 * GitHub repos take the import lane → enterprise_entities application rows,
 * registered + visible in the federated view. Org-isolated.
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

const githubHttp: HttpClient = {
  async getJson(url) {
    if (url.includes("/orgs/acme/repos")) {
      return [
        { id: 1, name: "api", full_name: "acme/api", description: "core api" },
        { id: 2, name: "web", full_name: "acme/web", description: "web app" }
      ];
    }
    throw new Error(`unexpected GET ${url}`);
  }
};

beforeAll(async () => {
  seed = await bootstrapTestDb();
  for (const f of [ECL_FLAG, EAR_FLAG]) {
    prev[f] = process.env[f];
    process.env[f] = "true";
  }
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the directory connector test.");
  pool = new Pool({ connectionString: url, ssl: false });
}, 120_000);

afterAll(async () => {
  for (const f of [ECL_FLAG, EAR_FLAG]) {
    if (prev[f] === undefined) delete process.env[f];
    else process.env[f] = prev[f];
  }
  await pool?.end();
});

describe("ERIP E2.P6 — directory connector sync", () => {
  it("configures 'github' (20260814 CHECK) and syncs repos as application entities", async () => {
    await withTenant(seed.orgA.id, async () => {
      await upsertConnectorConfig(seed.orgA.id, "github", {
        base_url: "https://api.github.com", org: "acme", token: "ghp_x"
      }, true);
    });

    await pool.query(
      `INSERT INTO jobs (organization_id, job_type, payload)
       VALUES ($1, 'connector_sync', '{"connector_id":"github"}'::jsonb)`,
      [seed.orgA.id]
    );
    const job = await claimNextJob("dir-test-worker");
    expect(job).not.toBeNull();
    await processClaimedJob(job!, { http: githubHttp });

    const rows = await pool.query(
      `SELECT name, entity_type, external_ref FROM enterprise_entities
        WHERE organization_id = $1 AND external_ref LIKE 'github:%' ORDER BY name`,
      [seed.orgA.id]
    );
    expect(rows.rows.map((r) => r.name)).toEqual(["acme/api", "acme/web"]);
    expect(rows.rows.every((r) => r.entity_type === "application")).toBe(true);

    // Observations recorded for the discovery ledger.
    const obs = await pool.query(
      `SELECT count(*)::int AS n FROM connector_asset_observations
        WHERE organization_id = $1 AND connector_id = 'github'`,
      [seed.orgA.id]
    );
    expect(obs.rows[0].n).toBe(2);

    // Org B unaffected.
    const other = await pool.query(
      `SELECT count(*)::int AS n FROM enterprise_entities WHERE organization_id = $1 AND external_ref LIKE 'github:%'`,
      [seed.orgB.id]
    );
    expect(other.rows[0].n).toBe(0);
  });
});
