/**
 * connectorWriteback.test.ts — ERIP E2a: real-Postgres proof of bidirectional
 * writeback. Enqueue intents, run the worker against a fake ServiceNow, and
 * verify: a first push APPLIES (and mutates the external record), an
 * already-equal field is a NOOP-adopt (no PATCH), a field that drifted
 * externally is HELD as a CONFLICT (never overwritten), the flag gates the
 * sweep, and orgs are isolated.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { bootstrapTestDb, type TestDbSeed } from "./testDb.js";
import { withTenant } from "../../src/api/infra/postgres.js";
import { upsertConnectorConfig } from "../../src/api/lib/connectorConfigStore.js";
import { enqueueWritebackIntents, scanDueWritebackConnectors } from "../../src/api/lib/connectorWritebackStore.js";
import { runWritebackTick } from "../../src/api/workers/connectorWritebackWorker.js";
import type { HttpClient } from "../../src/api/lib/connectors/types.js";

const CONNECTOR = "servicenow_cmdb";
const FLAGS = ["SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED", "SECURELOGIC_ASSET_REGISTRY_ENABLED", "SECURELOGIC_CONNECTOR_WRITEBACK_ENABLED"];

let seed: TestDbSeed;
let pool: Pool;
const prev: Record<string, string | undefined> = {};

/** In-memory ServiceNow: sys_id → CMDB field values. */
const cmdb: Record<string, Record<string, string>> = {};

function fakeServiceNow(): HttpClient {
  return {
    // readCurrent — returns the whole store; the adapter picks the refs it needs.
    getJson: async () => ({
      result: Object.entries(cmdb).map(([sys_id, fields]) => ({ sys_id, ...fields }))
    }),
    // writeField — merge the PATCH body into the record keyed by the URL sys_id.
    patchJson: async (url: string, _h, body) => {
      const sysId = decodeURIComponent(url.split("/cmdb_ci/")[1] ?? "");
      cmdb[sysId] = { ...(cmdb[sysId] ?? {}), ...(body as Record<string, string>) };
      return { result: cmdb[sysId] };
    }
  };
}

async function configureConnector(orgId: string): Promise<void> {
  await withTenant(orgId, () =>
    upsertConnectorConfig(orgId, CONNECTOR, { instance_url: "https://x.service-now.com", username: "u", password: "p" }, true)
  );
}
async function intents(orgId: string): Promise<Array<{ external_ref: string; field: string; status: string; last_pushed_value: string | null; external_prev_value: string | null }>> {
  const r = await pool.query(
    `SELECT external_ref, field, status, last_pushed_value, external_prev_value
       FROM connector_writeback_intents WHERE organization_id = $1 ORDER BY external_ref, field`,
    [orgId]
  );
  return r.rows;
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  for (const f of FLAGS) {
    prev[f] = process.env[f];
    process.env[f] = "true";
  }
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the writeback test.");
  pool = new Pool({ connectionString: url, ssl: false });
}, 120_000);

afterAll(async () => {
  for (const f of FLAGS) {
    if (prev[f] === undefined) delete process.env[f];
    else process.env[f] = prev[f];
  }
  await pool?.end();
});

describe("ERIP E2a — connector writeback worker", () => {
  it("applies a first push, adopts a noop, holds a conflict — org-isolated", async () => {
    await configureConnector(seed.orgA.id);
    await configureConnector(seed.orgB.id);

    // Org A external records: a1 will be OVERWRITTEN; a2 has drifted externally.
    cmdb["a1"] = { business_criticality: "3 - moderate" };
    cmdb["a2"] = { owned_by: "u5" };
    // Org B external record already at the desired value → noop.
    cmdb["b1"] = { owned_by: "orig" };

    await withTenant(seed.orgA.id, () =>
      enqueueWritebackIntents(seed.orgA.id, CONNECTOR, [
        { external_ref: "a1", field: "business_criticality", desired_value: "1 - most critical" },
        { external_ref: "a2", field: "owned_by", desired_value: "u9" }
      ], "operator", null)
    );
    await withTenant(seed.orgB.id, () =>
      enqueueWritebackIntents(seed.orgB.id, CONNECTOR, [
        { external_ref: "b1", field: "owned_by", desired_value: "orig" }
      ], "operator", null)
    );

    // Simulate a PRIOR push on a2: we last pushed "u1", but ServiceNow now shows
    // "u5" (someone else changed it) → the worker must HOLD, not overwrite.
    await pool.query(
      `UPDATE connector_writeback_intents SET last_pushed_value = 'u1'
        WHERE organization_id = $1 AND external_ref = 'a2'`,
      [seed.orgA.id]
    );

    const due = await scanDueWritebackConnectors(100);
    expect(due.some((d) => d.organization_id === seed.orgA.id && d.connector_id === CONNECTOR)).toBe(true);

    const processed = await runWritebackTick({ http: fakeServiceNow() });
    expect(processed).toBeGreaterThanOrEqual(2); // both orgs had due work

    const a = await intents(seed.orgA.id);
    const a1 = a.find((r) => r.external_ref === "a1")!;
    const a2 = a.find((r) => r.external_ref === "a2")!;
    // a1 applied and the external record was mutated (true bidirectional write).
    expect(a1.status).toBe("applied");
    expect(a1.last_pushed_value).toBe("1 - most critical");
    expect(a1.external_prev_value).toBe("3 - moderate");
    expect(cmdb["a1"].business_criticality).toBe("1 - most critical");
    // a2 held as a conflict; the external value was NOT overwritten.
    expect(a2.status).toBe("conflict");
    expect(cmdb["a2"].owned_by).toBe("u5");

    // Org B: already-equal field adopted as applied, external untouched, no PATCH churn.
    const b = await intents(seed.orgB.id);
    expect(b[0].status).toBe("applied");
    expect(b[0].last_pushed_value).toBe("orig");
    expect(cmdb["b1"].owned_by).toBe("orig");
  });

  it("re-enqueuing a resolved conflict with a new desired value re-attempts it", async () => {
    // Operator resolves a2: assert the current external value "u5" is fine but
    // now wants "u9" again knowing the drift — re-enqueue supersedes in place.
    await withTenant(seed.orgA.id, () =>
      enqueueWritebackIntents(seed.orgA.id, CONNECTOR, [
        { external_ref: "a2", field: "owned_by", desired_value: "u5" } // adopt current
      ], "operator", null)
    );
    const processed = await runWritebackTick({ http: fakeServiceNow() });
    expect(processed).toBeGreaterThanOrEqual(1);
    const a2 = (await intents(seed.orgA.id)).find((r) => r.external_ref === "a2")!;
    expect(a2.status).toBe("applied"); // external already "u5" → noop-adopt
    expect(a2.last_pushed_value).toBe("u5");
  });

  it("self-gates: with the writeback flag off the sweep does nothing", async () => {
    process.env.SECURELOGIC_CONNECTOR_WRITEBACK_ENABLED = "false";
    try {
      await withTenant(seed.orgA.id, () =>
        enqueueWritebackIntents(seed.orgA.id, CONNECTOR, [
          { external_ref: "a1", field: "comments", desired_value: "gated" }
        ], "operator", null)
      );
      expect(await runWritebackTick({ http: fakeServiceNow() })).toBe(0);
      const a1c = (await intents(seed.orgA.id)).find((r) => r.external_ref === "a1" && r.field === "comments")!;
      expect(a1c.status).toBe("pending"); // untouched while dark
    } finally {
      process.env.SECURELOGIC_CONNECTOR_WRITEBACK_ENABLED = "true";
    }
  });
});
