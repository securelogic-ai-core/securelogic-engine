/**
 * connectorObservations.test.ts — ERIP E2.P2: real-Postgres behavior of the
 * discovery-fact ledger, incremental sync, and drift reconciliation
 * (ERIP-AD-8/10/11).
 *
 *   - A ServiceNow full sync records one observation per CI, stamps
 *     last_full_sync_seen_at, and seeds the sync_cursor.
 *   - The next run is incremental (fetchDelta uses the cursor): it does NOT
 *     re-report unchanged CIs and does NOT mark them stale.
 *   - A later full sync that omits a previously-seen CI marks it stale
 *     (drift_stale) without deleting any canonical row; re-reporting it clears
 *     the stale flag and counts as drift_reappeared.
 *   - Observations are org-isolated under RLS.
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

/** A ServiceNow CMDB fake whose CI set + timestamps are swappable per run. */
function cmdbHttp(rows: Array<{ sys_id: string; name: string; sys_updated_on: string; sys_class_name?: string }>): HttpClient {
  return {
    async getJson(url) {
      if (url.includes("/api/now/table/cmdb_ci")) {
        // Honor the incremental filter the adapter appends: sys_updated_on>WATERMARK.
        const m = /sysparm_query=sys_updated_on%3E([^&]+)/.exec(url);
        if (m) {
          const since = decodeURIComponent(m[1]).replace(/\+/g, " ");
          return { result: rows.filter((r) => r.sys_updated_on > since) };
        }
        return { result: rows };
      }
      throw new Error(`unexpected GET ${url}`);
    }
  };
}

async function enqueue(orgId: string): Promise<void> {
  await pool.query(
    `INSERT INTO jobs (organization_id, job_type, payload)
     VALUES ($1, 'connector_sync', '{"connector_id":"servicenow_cmdb"}'::jsonb)`,
    [orgId]
  );
}

async function runSync(http: HttpClient): Promise<void> {
  const job = await claimNextJob("obs-test-worker");
  expect(job).not.toBeNull();
  await processClaimedJob(job!, { http });
}

async function observations(orgId: string): Promise<Array<{ external_ref: string; stale: boolean; last_full_sync_seen_at: string | null }>> {
  const r = await pool.query(
    `SELECT external_ref, stale, last_full_sync_seen_at
       FROM connector_asset_observations
      WHERE organization_id = $1 AND connector_id = 'servicenow_cmdb'
      ORDER BY external_ref`,
    [orgId]
  );
  return r.rows;
}

async function cursor(orgId: string): Promise<Record<string, string> | null> {
  const r = await pool.query(
    `SELECT sync_cursor FROM enterprise_connectors WHERE organization_id = $1 AND connector_id = 'servicenow_cmdb'`,
    [orgId]
  );
  return r.rows[0]?.sync_cursor ?? null;
}

async function lastSummary(orgId: string): Promise<Record<string, unknown>> {
  const r = await pool.query(
    `SELECT last_sync_summary FROM enterprise_connectors WHERE organization_id = $1 AND connector_id = 'servicenow_cmdb'`,
    [orgId]
  );
  return r.rows[0]?.last_sync_summary ?? {};
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  for (const f of [ECL_FLAG, EAR_FLAG]) {
    prev[f] = process.env[f];
    process.env[f] = "true";
  }
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the connector observations test.");
  pool = new Pool({ connectionString: url, ssl: false });

  await withTenant(seed.orgA.id, async () => {
    await upsertConnectorConfig(seed.orgA.id, "servicenow_cmdb", {
      instance_url: "https://corp.service-now.com", username: "u", password: "p"
    }, true);
  });
  await withTenant(seed.orgB.id, async () => {
    await upsertConnectorConfig(seed.orgB.id, "servicenow_cmdb", {
      instance_url: "https://other.service-now.com", username: "u", password: "p"
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

describe("ERIP E2.P2 — observations, incremental sync, drift", () => {
  it("full sync records observations + seeds the cursor; org-isolated", async () => {
    await enqueue(seed.orgA.id);
    await runSync(
      cmdbHttp([
        { sys_id: "ci-1", name: "App One", sys_updated_on: "2026-07-01 08:00:00", sys_class_name: "cmdb_ci_appl" },
        { sys_id: "ci-2", name: "Host Two", sys_updated_on: "2026-07-02 09:00:00", sys_class_name: "cmdb_ci_server" }
      ])
    );

    const obs = await observations(seed.orgA.id);
    expect(obs.map((o) => o.external_ref)).toEqual(["ci-1", "ci-2"]);
    expect(obs.every((o) => !o.stale && o.last_full_sync_seen_at !== null)).toBe(true);
    expect(await cursor(seed.orgA.id)).toEqual({ sys_updated_on: "2026-07-02 09:00:00" });

    const summary = await lastSummary(seed.orgA.id);
    expect(summary.sync_mode).toBe("full");
    expect(summary.observed).toBe(2);

    // Org B saw nothing.
    expect(await observations(seed.orgB.id)).toHaveLength(0);
  });

  it("incremental sync uses the cursor and does not mark unchanged CIs stale", async () => {
    // Same two CIs plus a newer third; the cursor filters out ci-1/ci-2.
    await enqueue(seed.orgA.id);
    await runSync(
      cmdbHttp([
        { sys_id: "ci-1", name: "App One", sys_updated_on: "2026-07-01 08:00:00", sys_class_name: "cmdb_ci_appl" },
        { sys_id: "ci-2", name: "Host Two", sys_updated_on: "2026-07-02 09:00:00", sys_class_name: "cmdb_ci_server" },
        { sys_id: "ci-3", name: "Host Three", sys_updated_on: "2026-07-04 10:00:00", sys_class_name: "cmdb_ci_server" }
      ])
    );

    const summary = await lastSummary(seed.orgA.id);
    expect(summary.sync_mode).toBe("delta");
    expect(summary.observed).toBe(1); // only ci-3 came through the delta
    expect(summary.drift_stale).toBe(0);

    const obs = await observations(seed.orgA.id);
    expect(obs.map((o) => o.external_ref)).toEqual(["ci-1", "ci-2", "ci-3"]);
    expect(obs.every((o) => !o.stale)).toBe(true); // delta never staled the unseen ones
    expect(await cursor(seed.orgA.id)).toEqual({ sys_updated_on: "2026-07-04 10:00:00" });
  });

  it("a full sync that omits a CI marks it stale; re-reporting it reappears", async () => {
    // Force the next run to be FULL by clearing the cursor.
    await pool.query(
      `UPDATE enterprise_connectors SET sync_cursor = NULL WHERE organization_id = $1 AND connector_id = 'servicenow_cmdb'`,
      [seed.orgA.id]
    );
    // ci-2 is gone from the source this run.
    await enqueue(seed.orgA.id);
    await runSync(
      cmdbHttp([
        { sys_id: "ci-1", name: "App One", sys_updated_on: "2026-07-01 08:00:00", sys_class_name: "cmdb_ci_appl" },
        { sys_id: "ci-3", name: "Host Three", sys_updated_on: "2026-07-04 10:00:00", sys_class_name: "cmdb_ci_server" }
      ])
    );

    let summary = await lastSummary(seed.orgA.id);
    expect(summary.sync_mode).toBe("full");
    expect(summary.drift_stale).toBe(1);
    let obs = await observations(seed.orgA.id);
    expect(obs.find((o) => o.external_ref === "ci-2")?.stale).toBe(true);
    expect(obs.find((o) => o.external_ref === "ci-1")?.stale).toBe(false);
    // Canonical enterprise_entities row for ci-2 still exists — drift never deletes.
    const canonical = await pool.query(
      `SELECT count(*)::int AS n FROM enterprise_entities WHERE organization_id = $1 AND external_ref = 'ci-2'`,
      [seed.orgA.id]
    );
    expect(canonical.rows[0].n).toBe(1);

    // ci-2 comes back in a later full sync → reappearance.
    await pool.query(
      `UPDATE enterprise_connectors SET sync_cursor = NULL WHERE organization_id = $1 AND connector_id = 'servicenow_cmdb'`,
      [seed.orgA.id]
    );
    await enqueue(seed.orgA.id);
    await runSync(
      cmdbHttp([
        { sys_id: "ci-1", name: "App One", sys_updated_on: "2026-07-01 08:00:00", sys_class_name: "cmdb_ci_appl" },
        { sys_id: "ci-2", name: "Host Two", sys_updated_on: "2026-07-02 09:00:00", sys_class_name: "cmdb_ci_server" },
        { sys_id: "ci-3", name: "Host Three", sys_updated_on: "2026-07-04 10:00:00", sys_class_name: "cmdb_ci_server" }
      ])
    );
    summary = await lastSummary(seed.orgA.id);
    expect(summary.drift_reappeared).toBe(1);
    obs = await observations(seed.orgA.id);
    expect(obs.every((o) => !o.stale)).toBe(true);
  });

  it("observations enforce RLS between orgs", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgB.id]);
      const r = await client.query(`SELECT count(*)::int AS n FROM connector_asset_observations`);
      expect(r.rows[0].n).toBe(0); // orgA's observations invisible to orgB
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });
});
