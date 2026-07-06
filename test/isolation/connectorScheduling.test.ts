/**
 * connectorScheduling.test.ts — ERIP E2.P1: real-Postgres behavior of the
 * scheduled connector sync (ERIP-AD-9).
 *
 *   - Due-scan enqueues exactly one deduped job for the org whose connector is
 *     due, advances next_sync_at, and ignores interval-less / other-org rows.
 *   - A pending run dedups a re-scan, but next_sync_at still advances (a stuck
 *     job cannot hot-loop the scheduler).
 *   - Triple fence: with SECURELOGIC_CONNECTOR_SCHEDULED_SYNC_ENABLED off,
 *     runOneTick performs no scheduling even when rows are due.
 *   - Terminal run failure bumps consecutive_failures and pushes next_sync_at
 *     out by the pure backoff; a later success resets the streak to 0.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { bootstrapTestDb, type TestDbSeed } from "./testDb.js";
import { withTenant } from "../../src/api/infra/postgres.js";
import {
  upsertConnectorConfig,
  updateConnectorSchedule
} from "../../src/api/lib/connectorConfigStore.js";
import {
  claimNextJob,
  processClaimedJob,
  runOneTick,
  runScheduleScan
} from "../../src/api/workers/connectorSyncWorker.js";
import type { HttpClient } from "../../src/api/lib/connectors/types.js";

const ECL_FLAG = "SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED";
const EAR_FLAG = "SECURELOGIC_ASSET_REGISTRY_ENABLED";
const SCHED_FLAG = "SECURELOGIC_CONNECTOR_SCHEDULED_SYNC_ENABLED";

let seed: TestDbSeed;
let pool: Pool;
const prev: Record<string, string | undefined> = {};

const defenderHttp: HttpClient = {
  async getJson(url) {
    if (url.includes("/api/machines")) {
      return { value: [{ id: "m-sched-1", computerDnsName: "sched-host.corp", osPlatform: "Windows11" }] };
    }
    throw new Error(`unexpected GET ${url}`);
  },
  async postForm() {
    return { access_token: "fake-token" };
  }
};

async function jobCount(orgId: string): Promise<number> {
  const r = await pool.query(
    `SELECT count(*)::int AS n FROM jobs WHERE organization_id = $1 AND job_type = 'connector_sync'`,
    [orgId]
  );
  return r.rows[0].n as number;
}

async function connectorState(orgId: string): Promise<{
  next_sync_at: Date | null;
  consecutive_failures: number;
  sync_interval_minutes: number | null;
}> {
  const r = await pool.query(
    `SELECT next_sync_at, consecutive_failures, sync_interval_minutes
       FROM enterprise_connectors
      WHERE organization_id = $1 AND connector_id = 'microsoft_defender'`,
    [orgId]
  );
  return r.rows[0];
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  for (const f of [ECL_FLAG, EAR_FLAG, SCHED_FLAG]) {
    prev[f] = process.env[f];
    process.env[f] = "true";
  }
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the connector scheduling test.");
  pool = new Pool({ connectionString: url, ssl: false });
}, 120_000);

afterAll(async () => {
  for (const f of [ECL_FLAG, EAR_FLAG, SCHED_FLAG]) {
    if (prev[f] === undefined) delete process.env[f];
    else process.env[f] = prev[f];
  }
  await pool?.end();
});

describe("ERIP E2.P1 — scheduled connector synchronization", () => {
  it("enqueues one deduped job for the due org only, and advances next_sync_at", async () => {
    // Org A: on a 60-minute schedule (next_sync_at NULL → due immediately).
    await withTenant(seed.orgA.id, async () => {
      await upsertConnectorConfig(seed.orgA.id, "microsoft_defender", {
        tenant_id: "t-1", client_id: "c-1", client_secret: "s3cret"
      }, true);
      const row = await updateConnectorSchedule(seed.orgA.id, "microsoft_defender", 60);
      expect(row?.sync_interval_minutes).toBe(60);
      expect(row?.next_sync_at).toBeNull();
    });
    // Org B: configured + enabled but manual-only (no interval).
    await withTenant(seed.orgB.id, async () => {
      await upsertConnectorConfig(seed.orgB.id, "microsoft_defender", {
        tenant_id: "t-2", client_id: "c-2", client_secret: "s3cret2"
      }, true);
    });

    const enqueued = await runScheduleScan();
    expect(enqueued).toBe(1);
    expect(await jobCount(seed.orgA.id)).toBe(1);
    expect(await jobCount(seed.orgB.id)).toBe(0);

    const after = await connectorState(seed.orgA.id);
    expect(after.next_sync_at).not.toBeNull();
    expect(new Date(after.next_sync_at!).getTime()).toBeGreaterThan(Date.now() + 50 * 60_000);

    // Not due any more → nothing enqueued.
    expect(await runScheduleScan()).toBe(0);

    // Force due again while the first job is still pending: dedup holds, but
    // next_sync_at STILL advances (no hot-loop on a stuck job).
    await pool.query(
      `UPDATE enterprise_connectors SET next_sync_at = now() - interval '1 minute'
        WHERE organization_id = $1 AND connector_id = 'microsoft_defender'`,
      [seed.orgA.id]
    );
    expect(await runScheduleScan()).toBe(0);
    expect(await jobCount(seed.orgA.id)).toBe(1);
    const readvanced = await connectorState(seed.orgA.id);
    expect(new Date(readvanced.next_sync_at!).getTime()).toBeGreaterThan(Date.now());
  });

  it("runOneTick performs no scheduling while the scheduled-sync flag is off (triple fence)", async () => {
    // Drain the pending job first so the fence test starts clean.
    const job = await claimNextJob("sched-test-worker");
    expect(job).not.toBeNull();
    await processClaimedJob(job!, { http: defenderHttp });
    expect((await connectorState(seed.orgA.id)).consecutive_failures).toBe(0);

    await pool.query(
      `UPDATE enterprise_connectors SET next_sync_at = now() - interval '1 minute'
        WHERE organization_id = $1 AND connector_id = 'microsoft_defender'`,
      [seed.orgA.id]
    );
    const before = await jobCount(seed.orgA.id);

    process.env[SCHED_FLAG] = "false";
    try {
      await runOneTick({ http: defenderHttp });
    } finally {
      process.env[SCHED_FLAG] = "true";
    }
    expect(await jobCount(seed.orgA.id)).toBe(before); // no enqueue happened

    // With the flag back on, the same tick schedules AND processes the run.
    const processed = await runOneTick({ http: defenderHttp });
    expect(processed).toBe(1);
    expect(await jobCount(seed.orgA.id)).toBe(before + 1);
  });

  it("terminal failure bumps the streak and backs off; success resets it", async () => {
    // Disable the connector, then hand the worker a job for it: the load step
    // throws NonRetryable (terminal) → streak + backoff bookkeeping.
    await pool.query(
      `UPDATE enterprise_connectors SET enabled = false
        WHERE organization_id = $1 AND connector_id = 'microsoft_defender'`,
      [seed.orgA.id]
    );
    const enq = await pool.query(
      `INSERT INTO jobs (organization_id, job_type, payload)
       VALUES ($1, 'connector_sync', '{"connector_id":"microsoft_defender"}'::jsonb) RETURNING id`,
      [seed.orgA.id]
    );
    expect(enq.rowCount).toBe(1);

    const job = await claimNextJob("sched-test-worker");
    expect(job).not.toBeNull();
    await processClaimedJob(job!, { http: defenderHttp });

    const failed = await connectorState(seed.orgA.id);
    expect(failed.consecutive_failures).toBe(1);
    // Backoff for (interval 60, failures 1) = 120 min.
    expect(new Date(failed.next_sync_at!).getTime()).toBeGreaterThan(Date.now() + 110 * 60_000);

    // Re-enable and run a clean sync: the streak resets.
    await pool.query(
      `UPDATE enterprise_connectors SET enabled = true
        WHERE organization_id = $1 AND connector_id = 'microsoft_defender'`,
      [seed.orgA.id]
    );
    await pool.query(
      `INSERT INTO jobs (organization_id, job_type, payload)
       VALUES ($1, 'connector_sync', '{"connector_id":"microsoft_defender"}'::jsonb)`,
      [seed.orgA.id]
    );
    const retry = await claimNextJob("sched-test-worker");
    expect(retry).not.toBeNull();
    await processClaimedJob(retry!, { http: defenderHttp });
    expect((await connectorState(seed.orgA.id)).consecutive_failures).toBe(0);
  });
});
