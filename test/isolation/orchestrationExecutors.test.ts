/**
 * orchestrationExecutors.test.ts — ERIP E6a: real-Postgres proof of the
 * integration config store (encrypt-at-rest passthrough + RLS) and the executor
 * dispatch that loads/decrypts that config and runs the real (fake-HTTP)
 * outbound call. Proves the config + executor path end-to-end without the
 * network; the approve→dispatch wiring is covered for the internal
 * evidence_request executor through the route.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { bootstrapTestDb, type TestDbSeed } from "./testDb.js";
import { withTenant } from "../../src/api/infra/postgres.js";
import { upsertIntegrationConfig, redactIntegrationRow, getIntegrationRow } from "../../src/api/lib/orchestrationIntegrationStore.js";
import { dispatchExecutor } from "../../src/api/lib/orchestrationExecutors.js";
import { createProposal, approveProposal } from "../../src/api/routes/orchestration.js";
import type { HttpClient } from "../../src/api/lib/connectors/types.js";
import type { Request, Response } from "express";

const FLAG = "SECURELOGIC_AUTONOMOUS_OPERATIONS_ENABLED";

let seed: TestDbSeed;
let pool: Pool;
let prevFlag: string | undefined;

function mockRes(): Response & { _status?: number; _json?: unknown } {
  const res = {
    _status: 0, _json: undefined,
    status(c: number) { (this as { _status: number })._status = c; return this; },
    json(b: unknown) { (this as { _json: unknown })._json = b; return this; }
  };
  return res as unknown as Response & { _status?: number; _json?: unknown };
}
function req(orgId: string, opts: { userId?: string; params?: Record<string, string>; body?: unknown } = {}): Request {
  return { organizationContext: { organizationId: orgId }, userId: opts.userId, params: opts.params ?? {}, body: opts.body, ip: "203.0.113.9" } as unknown as Request;
}
async function seedUser(orgId: string, email: string): Promise<string> {
  const r = await pool.query(`INSERT INTO users (organization_id, email, name, password_hash) VALUES ($1, $2, $2, 'x') RETURNING id`, [orgId, email]);
  return r.rows[0].id as string;
}

const fakeHttp: HttpClient = {
  async getJson() { throw new Error("unexpected"); },
  async postJson(url) {
    if (url.includes("/api/now/table/incident")) return { result: { sys_id: "sn-iso-1", number: "INC777" } };
    return {};
  }
};

beforeAll(async () => {
  seed = await bootstrapTestDb();
  prevFlag = process.env[FLAG];
  process.env[FLAG] = "true";
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL not set for orchestration executors test.");
  pool = new Pool({ connectionString: url, ssl: false });
}, 120_000);

afterAll(async () => {
  if (prevFlag === undefined) delete process.env[FLAG];
  else process.env[FLAG] = prevFlag;
  await pool?.end();
});

describe("ERIP E6a — integration config + real executor dispatch", () => {
  it("stores encrypted config, redacts keys-only, and RLS-isolates", async () => {
    await withTenant(seed.orgA.id, async () => {
      const row = await upsertIntegrationConfig(seed.orgA.id, "servicenow", {
        instance_url: "https://corp.service-now.com", username: "u", password: "s3cret"
      }, true);
      const redacted = redactIntegrationRow(row);
      expect(redacted).toMatchObject({ integration_id: "servicenow", configured: true, config_keys: ["instance_url", "password", "username"], enabled: true });
      expect(JSON.stringify(redacted)).not.toContain("s3cret");
    });

    // Org B cannot read org A's integration row under RLS.
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgB.id]);
      const r = await client.query(`SELECT count(*)::int AS n FROM orchestration_integrations`);
      expect(r.rows[0].n).toBe(0);
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });

  it("dispatch loads the org's config and runs the real (fake-HTTP) ServiceNow executor", async () => {
    const r = await withTenant(seed.orgA.id, () =>
      dispatchExecutor(seed.orgA.id, "servicenow_incident", { title: "Isolated breach", urgency: "1" }, { http: fakeHttp })
    );
    expect(r).toMatchObject({ ok: true, result: { sys_id: "sn-iso-1", number: "INC777" } });
  });

  it("dispatch fails typed when the integration is unconfigured", async () => {
    const r = await withTenant(seed.orgB.id, () =>
      dispatchExecutor(seed.orgB.id, "servicenow_incident", { title: "x" }, { http: fakeHttp })
    );
    expect(r).toMatchObject({ ok: false, error: "servicenow_not_configured" });
  });

  it("approve→dispatch wiring: an approved evidence_request executes an internal action", async () => {
    const proposer = await seedUser(seed.orgA.id, `evp-${Date.now()}@corp.com`);
    const approver = await seedUser(seed.orgA.id, `eva-${Date.now()}@corp.com`);

    const createRes = mockRes();
    await withTenant(seed.orgA.id, () =>
      createProposal(req(seed.orgA.id, { userId: proposer, body: { proposal_type: "evidence_request", title: "SOC 2 Type II report", payload: { title: "SOC 2 Type II report" } } }), createRes)
    );
    expect(createRes._status).toBe(201);
    const id = (createRes._json as { proposal: { id: string } }).proposal.id;

    const approveRes = mockRes();
    await withTenant(seed.orgA.id, () => approveProposal(req(seed.orgA.id, { userId: approver, params: { id } }), approveRes));
    expect(approveRes._status).toBe(200);
    const approved = (approveRes._json as { proposal: { status: string; execution_result: { action_id: string } } }).proposal;
    expect(approved.status).toBe("executed");

    const action = await pool.query(`SELECT action_type, title FROM actions WHERE id = $1`, [approved.execution_result.action_id]);
    expect(action.rows[0]).toMatchObject({ action_type: "orchestration:evidence_request", title: "Evidence: SOC 2 Type II report" });
  });

  it("getIntegrationRow returns the stored row for the org", async () => {
    const row = await withTenant(seed.orgA.id, () => getIntegrationRow(seed.orgA.id, "servicenow"));
    expect(row?.integration_id).toBe("servicenow");
    expect(row?.enabled).toBe(true);
  });
});
