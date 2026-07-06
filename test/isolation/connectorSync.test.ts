/**
 * connectorSync.test.ts — EAR Phase 3b: real-Postgres end-to-end for the
 * connector sync worker — the §4 Phase-3 exit criterion: "a connector sync
 * produces registry assets under mock credentials."
 *
 *   - enterprise_connectors config round-trip (encrypt-at-rest passthrough in
 *     test env; RLS + cross-org write rejection).
 *   - Defender (endpoint category) sync: claim → fetch (fake HttpClient) →
 *     endpoint detail rows + registry rows + asset_registry_v projection +
 *     job succeeded + last_sync_* updated — one tenant tx.
 *   - Re-sync idempotency: same inventory → zero new rows, counted as existing.
 *   - Identity-provider sync: accounts land in enterprise_entities
 *     (provenance 'connector', external_ref persisted) AND the IdP itself
 *     lands once as an identity_system detail asset.
 *   - runOneTick claims nothing while either flag is off (double fence).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { bootstrapTestDb, type TestDbSeed } from "./testDb.js";
import { withTenant } from "../../src/api/infra/postgres.js";
import { upsertConnectorConfig } from "../../src/api/lib/connectorConfigStore.js";
import {
  claimNextJob,
  processClaimedJob,
  runOneTick
} from "../../src/api/workers/connectorSyncWorker.js";
import type { HttpClient } from "../../src/api/lib/connectors/types.js";

const ECL_FLAG = "SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED";
const EAR_FLAG = "SECURELOGIC_ASSET_REGISTRY_ENABLED";

let seed: TestDbSeed;
let pool: Pool;
let prevEcl: string | undefined;
let prevEar: string | undefined;

/** Fake Defender API: one OAuth leg + two machines. */
const defenderHttp: HttpClient = {
  async getJson(url) {
    if (url.includes("/api/machines")) {
      return {
        value: [
          { id: "m-001", computerDnsName: "laptop-001.corp", osPlatform: "Windows11", exposureLevel: "High" },
          { id: "m-002", computerDnsName: "laptop-002.corp", osPlatform: "macOS", exposureLevel: "Low" }
        ]
      };
    }
    throw new Error(`unexpected GET ${url}`);
  },
  async postForm() {
    return { access_token: "fake-token" };
  }
};

/** Fake Okta API: two active users, one deprovisioned. */
const oktaHttp: HttpClient = {
  async getJson(url) {
    if (url.includes("/api/v1/users")) {
      return [
        { id: "u-1", status: "ACTIVE", profile: { displayName: "Jane Doe", login: "jane@corp.com" } },
        { id: "u-2", status: "ACTIVE", profile: { displayName: "Ravi Patel", login: "ravi@corp.com" } },
        { id: "u-3", status: "DEPROVISIONED", profile: { displayName: "Gone User" } }
      ];
    }
    throw new Error(`unexpected GET ${url}`);
  }
};

async function enqueue(orgId: string, connectorId: string): Promise<string> {
  const r = await pool.query(
    `INSERT INTO jobs (organization_id, job_type, payload)
     VALUES ($1, 'connector_sync', $2::jsonb) RETURNING id`,
    [orgId, JSON.stringify({ connector_id: connectorId })]
  );
  return r.rows[0].id as string;
}

async function drainOne(http: HttpClient): Promise<void> {
  const job = await claimNextJob("test-worker");
  expect(job).not.toBeNull();
  await processClaimedJob(job!, { http });
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  prevEcl = process.env[ECL_FLAG];
  prevEar = process.env[EAR_FLAG];
  process.env[ECL_FLAG] = "true";
  process.env[EAR_FLAG] = "true";
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the connector sync test.");
  pool = new Pool({ connectionString: url, ssl: false });
}, 120_000);

afterAll(async () => {
  if (prevEcl === undefined) delete process.env[ECL_FLAG]; else process.env[ECL_FLAG] = prevEcl;
  if (prevEar === undefined) delete process.env[EAR_FLAG]; else process.env[EAR_FLAG] = prevEar;
  await pool?.end();
});

describe("EAR Phase 3b — connector sync end-to-end", () => {
  it("configures a connector (config encrypted-at-rest column, RLS enforced)", async () => {
    await withTenant(seed.orgA.id, async () => {
      await upsertConnectorConfig(seed.orgA.id, "microsoft_defender", {
        tenant_id: "t-1", client_id: "c-1", client_secret: "s3cret"
      }, true);
      await upsertConnectorConfig(seed.orgA.id, "identity_provider", {
        base_url: "https://corp.okta.com", api_token: "tok-1"
      }, true);
    });

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgB.id]);
      const read = await client.query(`SELECT count(*)::int AS n FROM enterprise_connectors`);
      expect(read.rows[0].n).toBe(0); // orgA's configs invisible to orgB
      await expect(
        client.query(
          `INSERT INTO enterprise_connectors (organization_id, connector_id, config_encrypted)
           VALUES ($1, 'wiz', '{}')`,
          [seed.orgA.id]
        )
      ).rejects.toThrow(/row-level security/i);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("a Defender sync produces endpoint detail rows + registry assets + view rows, atomically with job completion", async () => {
    const jobId = await enqueue(seed.orgA.id, "microsoft_defender");
    await drainOne(defenderHttp);

    const job = await pool.query(`SELECT status, result FROM jobs WHERE id = $1`, [jobId]);
    expect(job.rows[0].status).toBe("succeeded");
    expect(job.rows[0].result).toMatchObject({ detail_created: 2, detail_existing: 0 });

    const endpoints = await pool.query(
      `SELECT name, external_ref, criticality, asset_id FROM endpoints
        WHERE organization_id = $1 ORDER BY external_ref`,
      [seed.orgA.id]
    );
    expect(endpoints.rows).toHaveLength(2);
    expect(endpoints.rows[0]).toMatchObject({ name: "laptop-001.corp", external_ref: "m-001", criticality: "high" });
    expect(endpoints.rows[0].asset_id).toBeTruthy();

    const view = await pool.query(
      `SELECT asset_type, backing_kind FROM asset_registry_v
        WHERE organization_id = $1 AND asset_type = 'endpoint'`,
      [seed.orgA.id]
    );
    expect(view.rows).toHaveLength(2);

    const status = await pool.query(
      `SELECT last_sync_status, last_sync_summary FROM enterprise_connectors
        WHERE organization_id = $1 AND connector_id = 'microsoft_defender'`,
      [seed.orgA.id]
    );
    expect(status.rows[0].last_sync_status).toBe("succeeded");
    expect(status.rows[0].last_sync_summary).toMatchObject({ detail_created: 2 });
  });

  it("re-sync is idempotent: identical inventory creates nothing new", async () => {
    await enqueue(seed.orgA.id, "microsoft_defender");
    await drainOne(defenderHttp);

    const endpoints = await pool.query(
      `SELECT count(*)::int AS n FROM endpoints WHERE organization_id = $1`,
      [seed.orgA.id]
    );
    expect(endpoints.rows[0].n).toBe(2);

    const status = await pool.query(
      `SELECT last_sync_summary FROM enterprise_connectors
        WHERE organization_id = $1 AND connector_id = 'microsoft_defender'`,
      [seed.orgA.id]
    );
    expect(status.rows[0].last_sync_summary).toMatchObject({ detail_created: 0, detail_existing: 2 });
  });

  it("an IdP sync lands accounts in enterprise_entities and the IdP itself as one identity_system asset", async () => {
    await enqueue(seed.orgA.id, "identity_provider");
    await drainOne(oktaHttp);

    const accounts = await pool.query(
      `SELECT name, external_ref, provenance FROM enterprise_entities
        WHERE organization_id = $1 AND entity_type = 'identity' ORDER BY external_ref`,
      [seed.orgA.id]
    );
    expect(accounts.rows).toHaveLength(2); // deprovisioned user skipped by the adapter
    expect(accounts.rows[0]).toMatchObject({ name: "Jane Doe", external_ref: "u-1", provenance: "connector" });

    const idp = await pool.query(
      `SELECT name, external_ref FROM identity_systems WHERE organization_id = $1`,
      [seed.orgA.id]
    );
    expect(idp.rows).toEqual([
      expect.objectContaining({ name: "corp.okta.com", external_ref: "identity_provider:corp.okta.com" })
    ]);

    // Account re-sync dedups on external_ref (the pre-pass), not just name.
    await enqueue(seed.orgA.id, "identity_provider");
    await drainOne(oktaHttp);
    const again = await pool.query(
      `SELECT count(*)::int AS n FROM enterprise_entities
        WHERE organization_id = $1 AND entity_type = 'identity'`,
      [seed.orgA.id]
    );
    expect(again.rows[0].n).toBe(2);
  });

  it("a sync against an unconfigured org fails non-retryably without touching other orgs", async () => {
    const jobId = await enqueue(seed.orgB.id, "microsoft_defender");
    await drainOne(defenderHttp);
    const job = await pool.query(`SELECT status, error FROM jobs WHERE id = $1`, [jobId]);
    expect(["failed", "dead_lettered"]).toContain(job.rows[0].status);
    const endpointsB = await pool.query(
      `SELECT count(*)::int AS n FROM endpoints WHERE organization_id = $1`,
      [seed.orgB.id]
    );
    expect(endpointsB.rows[0].n).toBe(0);
  });

  it("P7: a CMDB sync persists dependency edges (resolved by external_ref) idempotently", async () => {
    await withTenant(seed.orgA.id, () =>
      upsertConnectorConfig(seed.orgA.id, "servicenow_cmdb", {
        instance_url: "https://corp.service-now.com", username: "svc", password: "pw"
      }, true)
    );
    const cmdbHttp: HttpClient = {
      async getJson() {
        return {
          result: [
            { sys_id: "ci-app", name: "Order Service", sys_class_name: "cmdb_ci_business_app", depends_on: ["ci-srv", "ci-missing"] },
            { sys_id: "ci-srv", name: "app-server-01", sys_class_name: "cmdb_ci_server" }
          ]
        };
      }
    };

    await enqueue(seed.orgA.id, "servicenow_cmdb");
    await drainOne(cmdbHttp);

    const status = await pool.query(
      `SELECT last_sync_summary FROM enterprise_connectors
        WHERE organization_id = $1 AND connector_id = 'servicenow_cmdb'`,
      [seed.orgA.id]
    );
    // ci-app→ci-srv resolves; ci-app→ci-missing cannot (never ingested).
    expect(status.rows[0].last_sync_summary).toMatchObject({
      relationships_created: 1,
      relationships_unresolved: 1
    });

    const edges = await pool.query(
      `SELECT r.from_type, r.to_type, r.relationship_type, r.note
         FROM enterprise_relationships r
         JOIN enterprise_entities f ON f.id = r.from_id AND f.external_ref = 'ci-app'
        WHERE r.organization_id = $1 AND r.deleted_at IS NULL`,
      [seed.orgA.id]
    );
    expect(edges.rows).toEqual([
      expect.objectContaining({
        from_type: "enterprise_entity",
        to_type: "enterprise_entity",
        relationship_type: "depends_on",
        note: "connector:servicenow_cmdb"
      })
    ]);

    // Re-sync: entities dedup by external_ref, the edge dedups by the live unique index.
    await enqueue(seed.orgA.id, "servicenow_cmdb");
    await drainOne(cmdbHttp);
    const again = await pool.query(
      `SELECT last_sync_summary FROM enterprise_connectors
        WHERE organization_id = $1 AND connector_id = 'servicenow_cmdb'`,
      [seed.orgA.id]
    );
    expect(again.rows[0].last_sync_summary).toMatchObject({
      relationships_created: 0,
      relationships_existing: 1
    });
    const count = await pool.query(
      `SELECT count(*)::int AS n FROM enterprise_relationships
        WHERE organization_id = $1 AND deleted_at IS NULL AND note = 'connector:servicenow_cmdb'`,
      [seed.orgA.id]
    );
    expect(count.rows[0].n).toBe(1);
  });

  it("runOneTick refuses to claim while either flag is off (double fence)", async () => {
    const jobId = await enqueue(seed.orgA.id, "microsoft_defender");
    try {
      process.env[EAR_FLAG] = "false";
      expect(await runOneTick({ http: defenderHttp })).toBe(0);
      process.env[EAR_FLAG] = "true";
      process.env[ECL_FLAG] = "false";
      expect(await runOneTick({ http: defenderHttp })).toBe(0);
    } finally {
      process.env[ECL_FLAG] = "true";
      process.env[EAR_FLAG] = "true";
      await pool.query(`DELETE FROM jobs WHERE id = $1`, [jobId]);
    }
  });
});
