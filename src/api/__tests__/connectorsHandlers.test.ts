/**
 * connectorsHandlers.test.ts — EAR Phase 3b: handler-level unit tests for the
 * connector config + sync routes (pg mocked, assetsHandlers.test.ts style).
 * Proves the tenant guard, unknown-connector 404s, adapter-driven config
 * validation, the no-secret-echo invariant (responses and audit payloads
 * carry field KEYS only), and the enqueue/dedup semantics of POST sync.
 * Real-Postgres behavior is covered by test/isolation/connectorSync.test.ts.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";

vi.mock("../infra/postgres.js", () => ({
  pg: { query: vi.fn() },
  pgElevated: { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }) },
  withTenant: vi.fn(),
  requireTenantContext: vi.fn()
}));
vi.mock("../lib/auditLog.js", () => ({ writeAuditEvent: vi.fn() }));

import { pg } from "../infra/postgres.js";
import { writeAuditEvent } from "../lib/auditLog.js";
import {
  listOrgConnectors,
  putConnectorConfig,
  deleteConnector,
  triggerConnectorSync
} from "../routes/connectors.js";

const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SECRET = "super-secret-token-value";
const q = pg.query as unknown as ReturnType<typeof vi.fn>;
const audit = writeAuditEvent as unknown as ReturnType<typeof vi.fn>;

function mockRes(): Response & { _status?: number; _json?: unknown } {
  const res = {
    _status: 0,
    _json: undefined,
    status(code: number) { (this as { _status: number })._status = code; return this; },
    json(body: unknown) { (this as { _json: unknown })._json = body; return this; }
  };
  return res as unknown as Response & { _status?: number; _json?: unknown };
}

function reqFor(
  orgId: string | null = ORG_A,
  params: Record<string, string> = {},
  body: unknown = undefined
): Request {
  return {
    organizationContext: orgId ? { organizationId: orgId } : undefined,
    params,
    body,
    ip: "203.0.113.5"
  } as unknown as Request;
}

/** A stored row as the store returns it (config encrypted → passthrough without a key). */
function storedRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    organization_id: ORG_A,
    connector_id: "identity_provider",
    config_encrypted: JSON.stringify({ base_url: "https://corp.okta.com", api_token: SECRET }),
    enabled: true,
    last_sync_at: null,
    last_sync_status: null,
    last_sync_summary: null,
    ...overrides
  };
}

beforeEach(() => {
  q.mockReset();
  audit.mockReset();
});

describe("tenant guard", () => {
  it("every handler 403s without org context and runs no query", async () => {
    for (const handler of [listOrgConnectors, putConnectorConfig, deleteConnector, triggerConnectorSync]) {
      const res = mockRes();
      await handler(reqFor(null, { id: "identity_provider" }), res);
      expect(res._status).toBe(403);
    }
    expect(q).not.toHaveBeenCalled();
  });
});

describe("listOrgConnectors", () => {
  it("returns all nine registry adapters merged with configured state — never secret values", async () => {
    q.mockResolvedValueOnce({ rows: [storedRow()], rowCount: 1 });
    const res = mockRes();
    await listOrgConnectors(reqFor(), res);
    expect(res._status).toBe(200);
    const body = res._json as { connectors: Array<Record<string, unknown>> };
    expect(body.connectors).toHaveLength(9);

    const idp = body.connectors.find((c) => c.connector_id === "identity_provider")!;
    expect(idp).toMatchObject({ configured: true, enabled: true, config_keys: ["api_token", "base_url"] });
    const unconfigured = body.connectors.find((c) => c.connector_id === "wiz")!;
    expect(unconfigured).toMatchObject({ configured: false, enabled: false });

    expect(JSON.stringify(body)).not.toContain(SECRET);
  });
});

describe("putConnectorConfig", () => {
  it("404 on unknown connector", async () => {
    const res = mockRes();
    await putConnectorConfig(reqFor(ORG_A, { id: "nope" }, { config: {} }), res);
    expect(res._status).toBe(404);
    expect(q).not.toHaveBeenCalled();
  });

  it("400 when a required field is missing (adapter validateConfig is the truth)", async () => {
    const res = mockRes();
    await putConnectorConfig(
      reqFor(ORG_A, { id: "identity_provider" }, { config: { base_url: "https://corp.okta.com" } }),
      res
    );
    expect(res._status).toBe(400);
    expect(res._json).toMatchObject({ error: "config_field_missing" });
    expect(q).not.toHaveBeenCalled();
  });

  it("upserts, and neither response nor audit payload echoes secret values", async () => {
    q.mockResolvedValueOnce({ rows: [storedRow()], rowCount: 1 });
    const res = mockRes();
    await putConnectorConfig(
      reqFor(ORG_A, { id: "identity_provider" }, {
        config: { base_url: "https://corp.okta.com", api_token: SECRET },
        enabled: true
      }),
      res
    );
    expect(res._status).toBe(200);
    expect(res._json).toMatchObject({
      connector: { connector_id: "identity_provider", configured: true, config_keys: ["api_token", "base_url"] }
    });
    expect(JSON.stringify(res._json)).not.toContain(SECRET);

    expect(audit).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(audit.mock.calls[0])).not.toContain(SECRET);

    // The upsert received the encrypted (or passthrough) serialized config — org-parameterized.
    expect(q.mock.calls[0]![1]).toEqual([ORG_A, "identity_provider", expect.any(String), true]);
  });
});

describe("triggerConnectorSync", () => {
  it("409 when not configured / disabled", async () => {
    q.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const notConfigured = mockRes();
    await triggerConnectorSync(reqFor(ORG_A, { id: "identity_provider" }), notConfigured);
    expect(notConfigured._status).toBe(409);
    expect(notConfigured._json).toMatchObject({ error: "not_configured" });

    q.mockResolvedValueOnce({ rows: [storedRow({ enabled: false })], rowCount: 1 });
    const disabled = mockRes();
    await triggerConnectorSync(reqFor(ORG_A, { id: "identity_provider" }), disabled);
    expect(disabled._status).toBe(409);
    expect(disabled._json).toMatchObject({ error: "connector_disabled" });
  });

  it("202 with job id on enqueue; 409 when a run is already pending (dedup)", async () => {
    q.mockResolvedValueOnce({ rows: [storedRow()], rowCount: 1 });
    q.mockResolvedValueOnce({ rows: [{ id: "job-1" }], rowCount: 1 });
    const res = mockRes();
    await triggerConnectorSync(reqFor(ORG_A, { id: "identity_provider" }), res);
    expect(res._status).toBe(202);
    expect(res._json).toMatchObject({ job_id: "job-1", connector_id: "identity_provider", status: "queued" });
    // Enqueue is org-parameterized with the connector payload.
    expect(q.mock.calls[1]![1]).toEqual([ORG_A, "connector_sync", JSON.stringify({ connector_id: "identity_provider" })]);

    q.mockResolvedValueOnce({ rows: [storedRow()], rowCount: 1 });
    q.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const dup = mockRes();
    await triggerConnectorSync(reqFor(ORG_A, { id: "identity_provider" }), dup);
    expect(dup._status).toBe(409);
    expect(dup._json).toMatchObject({ error: "sync_already_pending" });
  });
});

describe("deleteConnector", () => {
  it("removes the config row and audits; 404 when nothing to remove", async () => {
    q.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const res = mockRes();
    await deleteConnector(reqFor(ORG_A, { id: "identity_provider" }), res);
    expect(res._status).toBe(200);
    expect(audit).toHaveBeenCalledTimes(1);

    q.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const missing = mockRes();
    await deleteConnector(reqFor(ORG_A, { id: "identity_provider" }), missing);
    expect(missing._status).toBe(404);
  });
});
