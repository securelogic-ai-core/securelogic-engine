/**
 * connectorHealth.test.ts — ERIP E2c: real-Postgres proof that GET
 * /api/connectors/health aggregates sync/drift/dead-letter signals into the
 * right band, escalating healthy → degraded → failing as issues accrue, and is
 * org-scoped.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { bootstrapTestDb, type TestDbSeed } from "./testDb.js";
import { withTenant } from "../../src/api/infra/postgres.js";
import { upsertConnectorConfig } from "../../src/api/lib/connectorConfigStore.js";
import { captureDeadLetter } from "../../src/api/lib/connectorDeadLetterStore.js";
import { getConnectorHealth } from "../../src/api/routes/connectors.js";
import type { Request, Response } from "express";

const CONNECTOR = "servicenow_cmdb";
let seed: TestDbSeed;
let pool: Pool;

function mockRes(): Response & { _status?: number; _json?: unknown } {
  const res = {
    _status: 0, _json: undefined,
    status(c: number) { (this as { _status: number })._status = c; return this; },
    json(b: unknown) { (this as { _json: unknown })._json = b; return this; }
  };
  return res as unknown as Response & { _status?: number; _json?: unknown };
}
const reqFor = (orgId: string): Request => ({ organizationContext: { organizationId: orgId } }) as unknown as Request;

interface HealthBody {
  overall_band: string;
  configured_count: number;
  connectors: Array<{ connector_id: string; band: string; reasons: string[] }>;
}
async function health(orgId: string): Promise<HealthBody> {
  const res = mockRes();
  await withTenant(orgId, () => getConnectorHealth(reqFor(orgId), res));
  expect(res._status).toBe(200);
  return res._json as HealthBody;
}
function bandOf(body: HealthBody, id = CONNECTOR): { band: string; reasons: string[] } {
  const c = body.connectors.find((x) => x.connector_id === id)!;
  return { band: c.band, reasons: c.reasons };
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the health test.");
  pool = new Pool({ connectionString: url, ssl: false });
}, 120_000);

afterAll(async () => {
  await pool?.end();
});

describe("ERIP E2c — connector health monitoring", () => {
  it("escalates healthy → degraded → failing as signals accrue, org-scoped", async () => {
    // Configure + a clean successful sync → healthy.
    await withTenant(seed.orgA.id, () =>
      upsertConnectorConfig(seed.orgA.id, CONNECTOR, { instance_url: "https://x.service-now.com", username: "u", password: "p" }, true)
    );
    await pool.query(
      `UPDATE enterprise_connectors SET last_sync_at = now(), last_sync_status = 'succeeded', consecutive_failures = 0
        WHERE organization_id = $1 AND connector_id = $2`,
      [seed.orgA.id, CONNECTOR]
    );
    expect(bandOf(await health(seed.orgA.id)).band).toBe("healthy");

    // A stale (drifted) observation → degraded.
    await pool.query(
      `INSERT INTO connector_asset_observations (organization_id, connector_id, external_ref, lane, entity_type, name, stale)
       VALUES ($1, $2, 'drifted-1', 'import', 'application', 'Drifted App', true)`,
      [seed.orgA.id, CONNECTOR]
    );
    const degraded = bandOf(await health(seed.orgA.id));
    expect(degraded.band).toBe("degraded");
    expect(degraded.reasons).toContain("drift_stale_assets");

    // An open dead-letter → failing (worst wins).
    await withTenant(seed.orgA.id, () =>
      captureDeadLetter(seed.orgA.id, { source: "connector_sync", connectorId: CONNECTOR, refId: null, attempts: 3, error: "boom", payload: {} })
    );
    const failingBody = await health(seed.orgA.id);
    const failing = bandOf(failingBody);
    expect(failing.band).toBe("failing");
    expect(failing.reasons).toEqual(expect.arrayContaining(["dead_letters_open", "drift_stale_assets"]));
    expect(failingBody.overall_band).toBe("failing");

    // Org B configured nothing → servicenow reports unconfigured, org healthy.
    const bBody = await health(seed.orgB.id);
    expect(bandOf(bBody).band).toBe("unconfigured");
    expect(bBody.configured_count).toBe(0);
    expect(bBody.overall_band).toBe("healthy");
  });

  it("reports a disabled connector as disabled", async () => {
    await withTenant(seed.orgB.id, () =>
      upsertConnectorConfig(seed.orgB.id, CONNECTOR, { instance_url: "https://y.service-now.com", username: "u", password: "p" }, false)
    );
    expect(bandOf(await health(seed.orgB.id)).band).toBe("disabled");
  });
});
