/**
 * connectorDeadLetter.test.ts — ERIP E2b: real-Postgres proof of dead-letter
 * capture + recovery. A writeback push that exhausts its retry budget is
 * captured as an OPEN dead-letter by the worker; re-driving it flips the intent
 * back to pending and marks the event redriven. A sync dead-letter re-drives to
 * a fresh connector_sync job. Org-isolated.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { bootstrapTestDb, type TestDbSeed } from "./testDb.js";
import { withTenant } from "../../src/api/infra/postgres.js";
import { upsertConnectorConfig } from "../../src/api/lib/connectorConfigStore.js";
import { enqueueWritebackIntents } from "../../src/api/lib/connectorWritebackStore.js";
import { runWritebackTick } from "../../src/api/workers/connectorWritebackWorker.js";
import {
  captureDeadLetter,
  listDeadLetters,
  redriveDeadLetter,
  ignoreDeadLetter
} from "../../src/api/lib/connectorDeadLetterStore.js";
import type { HttpClient } from "../../src/api/lib/connectors/types.js";

const CONNECTOR = "servicenow_cmdb";
const FLAGS = ["SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED", "SECURELOGIC_ASSET_REGISTRY_ENABLED", "SECURELOGIC_CONNECTOR_WRITEBACK_ENABLED"];

let seed: TestDbSeed;
let pool: Pool;
const prev: Record<string, string | undefined> = {};

/** A ServiceNow whose reads succeed (drift) but whose PATCH always fails. */
function failingServiceNow(): HttpClient {
  return {
    getJson: async () => ({ result: [{ sys_id: "dl1", owned_by: "external-value" }] }),
    patchJson: async () => {
      throw new Error("503 from service-now");
    }
  };
}

async function configure(orgId: string): Promise<void> {
  await withTenant(orgId, () =>
    upsertConnectorConfig(orgId, CONNECTOR, { instance_url: "https://x.service-now.com", username: "u", password: "p" }, true)
  );
}
async function deadLetters(orgId: string) {
  return withTenant(orgId, () => listDeadLetters(orgId, {}));
}
async function intentStatus(orgId: string, ref: string): Promise<string | undefined> {
  const r = await pool.query(
    `SELECT status FROM connector_writeback_intents WHERE organization_id = $1 AND external_ref = $2`,
    [orgId, ref]
  );
  return r.rows[0]?.status;
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  for (const f of FLAGS) {
    prev[f] = process.env[f];
    process.env[f] = "true";
  }
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the dead-letter test.");
  pool = new Pool({ connectionString: url, ssl: false });
}, 120_000);

afterAll(async () => {
  for (const f of FLAGS) {
    if (prev[f] === undefined) delete process.env[f];
    else process.env[f] = prev[f];
  }
  await pool?.end();
});

describe("ERIP E2b — dead-letter capture + recovery", () => {
  it("captures a terminally-failed writeback and re-drives it back to pending", async () => {
    await configure(seed.orgA.id);
    await withTenant(seed.orgA.id, () =>
      enqueueWritebackIntents(seed.orgA.id, CONNECTOR, [{ external_ref: "dl1", field: "owned_by", desired_value: "desired" }], "operator", null)
    );
    // Jump to the last attempt so ONE failing tick reaches the retry budget.
    await pool.query(
      `UPDATE connector_writeback_intents SET attempts = max_attempts - 1
        WHERE organization_id = $1 AND external_ref = 'dl1'`,
      [seed.orgA.id]
    );

    await runWritebackTick({ http: failingServiceNow() });

    expect(await intentStatus(seed.orgA.id, "dl1")).toBe("failed");
    const dls = await deadLetters(seed.orgA.id);
    const dl = dls.find((d) => d.source === "connector_writeback" && d.external_ref === "dl1");
    expect(dl).toBeDefined();
    expect(dl!.status).toBe("open");
    expect(dl!.field).toBe("owned_by");
    expect(dl!.error).toContain("503");

    // Re-drive → the intent goes back to pending, the event is redriven.
    const result = await withTenant(seed.orgA.id, () => redriveDeadLetter(seed.orgA.id, dl!.id, null));
    expect(result).toMatchObject({ ok: true, action: "writeback_requeued" });
    expect(await intentStatus(seed.orgA.id, "dl1")).toBe("pending");
    const after = await deadLetters(seed.orgA.id);
    expect(after.find((d) => d.id === dl!.id)!.status).toBe("redriven");
  });

  it("re-drives a sync dead-letter to a fresh connector_sync job", async () => {
    await withTenant(seed.orgA.id, () =>
      captureDeadLetter(seed.orgA.id, {
        source: "connector_sync",
        connectorId: CONNECTOR,
        refId: null,
        attempts: 3,
        error: "sync blew up",
        payload: { connector_id: CONNECTOR }
      })
    );
    const dl = (await deadLetters(seed.orgA.id)).find((d) => d.source === "connector_sync")!;
    const result = await withTenant(seed.orgA.id, () => redriveDeadLetter(seed.orgA.id, dl.id, null));
    expect(result).toMatchObject({ ok: true, action: "sync_enqueued" });

    const jobs = await pool.query(
      `SELECT status, payload FROM jobs WHERE organization_id = $1 AND job_type = 'connector_sync' AND status = 'queued'`,
      [seed.orgA.id]
    );
    expect(jobs.rows.some((j) => (j.payload as { connector_id?: string }).connector_id === CONNECTOR)).toBe(true);
  });

  it("does not re-drive across orgs, and ignore dismisses", async () => {
    await withTenant(seed.orgB.id, () =>
      captureDeadLetter(seed.orgB.id, { source: "connector_sync", connectorId: CONNECTOR, refId: null, attempts: 1, error: "b-fail", payload: {} })
    );
    const bDl = (await deadLetters(seed.orgB.id))[0];

    // Org A cannot see or re-drive org B's dead-letter.
    const cross = await withTenant(seed.orgA.id, () => redriveDeadLetter(seed.orgA.id, bDl.id, null));
    expect(cross).toEqual({ ok: false, error: "not_found" });
    expect((await deadLetters(seed.orgB.id))[0].status).toBe("open"); // untouched

    // Ignore dismisses within the owning org.
    const ok = await withTenant(seed.orgB.id, () => ignoreDeadLetter(seed.orgB.id, bDl.id, null));
    expect(ok).toBe(true);
    expect((await deadLetters(seed.orgB.id)).find((d) => d.id === bDl.id)!.status).toBe("ignored");
  });
});
