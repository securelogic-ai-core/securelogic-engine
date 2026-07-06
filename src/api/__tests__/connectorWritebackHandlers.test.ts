/**
 * connectorWritebackHandlers.test.ts — ERIP E2a: handler-level unit tests for
 * the writeback enqueue/list routes (pg + store mocked). Proves the dark-flag
 * 404, writeback-capability gate, field whitelist enforcement, validation, the
 * not-configured 409, and the success/audit path. Real-Postgres behavior is in
 * test/isolation/connectorWriteback.test.ts.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";

let flagOn = true;
vi.mock("../lib/connectorWritebackFlag.js", () => ({
  connectorWritebackEnabled: () => flagOn
}));
vi.mock("../infra/postgres.js", () => ({
  pg: { query: vi.fn() },
  pgElevated: { query: vi.fn() },
  withTenant: vi.fn(),
  requireTenantContext: vi.fn()
}));
vi.mock("../lib/auditLog.js", () => ({ writeAuditEvent: vi.fn() }));
vi.mock("../lib/connectorWritebackStore.js", () => ({
  enqueueWritebackIntents: vi.fn(),
  listWritebackIntents: vi.fn(),
  writebackStatusCounts: vi.fn()
}));

import { pg } from "../infra/postgres.js";
import { writeAuditEvent } from "../lib/auditLog.js";
import {
  enqueueWritebackIntents,
  listWritebackIntents,
  writebackStatusCounts
} from "../lib/connectorWritebackStore.js";
import { enqueueConnectorWriteback, listConnectorWriteback } from "../routes/connectors.js";

const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const q = pg.query as unknown as ReturnType<typeof vi.fn>;
const enqueue = enqueueWritebackIntents as unknown as ReturnType<typeof vi.fn>;
const list = listWritebackIntents as unknown as ReturnType<typeof vi.fn>;
const counts = writebackStatusCounts as unknown as ReturnType<typeof vi.fn>;
const audit = writeAuditEvent as unknown as ReturnType<typeof vi.fn>;

function mockRes(): Response & { _status?: number; _json?: unknown } {
  const res = {
    _status: 0, _json: undefined,
    status(c: number) { (this as { _status: number })._status = c; return this; },
    json(b: unknown) { (this as { _json: unknown })._json = b; return this; }
  };
  return res as unknown as Response & { _status?: number; _json?: unknown };
}
function req(params: Record<string, string>, body: unknown, orgId: string | null = ORG_A): Request {
  return { organizationContext: orgId ? { organizationId: orgId } : undefined, params, body, ip: "203.0.113.5", userId: "u1" } as unknown as Request;
}

beforeEach(() => {
  flagOn = true;
  q.mockReset();
  enqueue.mockReset();
  list.mockReset();
  counts.mockReset();
  audit.mockReset();
});

describe("enqueueConnectorWriteback", () => {
  it("404s while the writeback flag is dark", async () => {
    flagOn = false;
    const res = mockRes();
    await enqueueConnectorWriteback(req({ id: "servicenow_cmdb" }, { intents: [] }), res);
    expect(res._status).toBe(404);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("400 writeback_not_supported for a read-only connector", async () => {
    const res = mockRes();
    await enqueueConnectorWriteback(req({ id: "wiz" }, { intents: [{ external_ref: "a", field: "x", desired_value: "y" }] }), res);
    expect(res._status).toBe(400);
    expect((res._json as { error: string }).error).toBe("writeback_not_supported");
  });

  it("400 field_not_writable for a field outside the adapter whitelist", async () => {
    const res = mockRes();
    await enqueueConnectorWriteback(
      req({ id: "servicenow_cmdb" }, { intents: [{ external_ref: "a1", field: "sys_id", desired_value: "x" }] }),
      res
    );
    expect(res._status).toBe(400);
    expect((res._json as { error: string }).error).toBe("field_not_writable");
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("400 when intents missing/empty", async () => {
    const res = mockRes();
    await enqueueConnectorWriteback(req({ id: "servicenow_cmdb" }, { intents: [] }), res);
    expect(res._status).toBe(400);
    expect((res._json as { error: string }).error).toBe("intents_required");
  });

  it("409 not_configured when the connector has no config row", async () => {
    q.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // getConnectorRow
    const res = mockRes();
    await enqueueConnectorWriteback(
      req({ id: "servicenow_cmdb" }, { intents: [{ external_ref: "a1", field: "owned_by", desired_value: "u9" }] }),
      res
    );
    expect(res._status).toBe(409);
    expect((res._json as { error: string }).error).toBe("not_configured");
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("202 enqueues valid intents and audits (fields only)", async () => {
    q.mockResolvedValueOnce({ rows: [{ id: "cfg-1" }], rowCount: 1 }); // getConnectorRow
    enqueue.mockResolvedValueOnce(2);
    const res = mockRes();
    await enqueueConnectorWriteback(
      req({ id: "servicenow_cmdb" }, {
        intents: [
          { external_ref: "a1", field: "owned_by", desired_value: "u9" },
          { external_ref: "a2", field: "business_criticality", desired_value: "1 - most critical" }
        ]
      }),
      res
    );
    expect(res._status).toBe(202);
    expect(res._json).toEqual({ connector_id: "servicenow_cmdb", enqueued: 2 });
    expect(enqueue).toHaveBeenCalledWith(
      ORG_A, "servicenow_cmdb",
      [
        { external_ref: "a1", field: "owned_by", desired_value: "u9" },
        { external_ref: "a2", field: "business_criticality", desired_value: "1 - most critical" }
      ],
      "operator", "u1"
    );
    const payload = audit.mock.calls[0][0].payload as { fields: string[]; intent_count: number };
    expect(payload.fields).toEqual(["business_criticality", "owned_by"]);
    expect(payload.intent_count).toBe(2);
  });
});

describe("listConnectorWriteback", () => {
  it("404s while dark", async () => {
    flagOn = false;
    const res = mockRes();
    await listConnectorWriteback(req({ id: "servicenow_cmdb" }, undefined), res);
    expect(res._status).toBe(404);
  });

  it("returns counts, fields, and a redacted intent list", async () => {
    counts.mockResolvedValueOnce({ pending: 1, applied: 3, conflict: 1, failed: 0 });
    list.mockResolvedValueOnce([
      { external_ref: "a1", field: "owned_by", desired_value: "u9", status: "conflict", attempts: 1, last_pushed_value: "u1", external_prev_value: "u5", detail: "drift", applied_at: null, updated_at: "t" }
    ]);
    const res = mockRes();
    await listConnectorWriteback(req({ id: "servicenow_cmdb" }, undefined), res);
    expect(res._status).toBe(200);
    const body = res._json as { writeback_fields: string[]; status_counts: Record<string, number>; intents: unknown[] };
    expect(body.writeback_fields).toContain("owned_by");
    expect(body.status_counts.applied).toBe(3);
    expect(body.intents).toHaveLength(1);
  });
});
