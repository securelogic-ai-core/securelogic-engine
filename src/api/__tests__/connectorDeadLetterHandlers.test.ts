/**
 * connectorDeadLetterHandlers.test.ts — ERIP E2b: handler-level unit tests for
 * the dead-letter recovery routes (store mocked). Proves the tenant guard,
 * status filter validation, id validation, the redrive success/error mapping,
 * and ignore. Real-Postgres behavior is in test/isolation/connectorDeadLetter.test.ts.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";

vi.mock("../infra/postgres.js", () => ({
  pg: { query: vi.fn() },
  pgElevated: { query: vi.fn() },
  withTenant: vi.fn(),
  requireTenantContext: vi.fn()
}));
vi.mock("../lib/auditLog.js", () => ({ writeAuditEvent: vi.fn() }));
vi.mock("../lib/connectorDeadLetterStore.js", () => ({
  listDeadLetters: vi.fn(),
  redriveDeadLetter: vi.fn(),
  ignoreDeadLetter: vi.fn()
}));

import { listDeadLetters, redriveDeadLetter, ignoreDeadLetter } from "../lib/connectorDeadLetterStore.js";
import { writeAuditEvent } from "../lib/auditLog.js";
import {
  listConnectorDeadLetters,
  redriveConnectorDeadLetter,
  ignoreConnectorDeadLetter
} from "../routes/connectors.js";

const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DL_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const list = listDeadLetters as unknown as ReturnType<typeof vi.fn>;
const redrive = redriveDeadLetter as unknown as ReturnType<typeof vi.fn>;
const ignore = ignoreDeadLetter as unknown as ReturnType<typeof vi.fn>;
const audit = writeAuditEvent as unknown as ReturnType<typeof vi.fn>;

function mockRes(): Response & { _status?: number; _json?: unknown } {
  const res = {
    _status: 0, _json: undefined,
    status(c: number) { (this as { _status: number })._status = c; return this; },
    json(b: unknown) { (this as { _json: unknown })._json = b; return this; }
  };
  return res as unknown as Response & { _status?: number; _json?: unknown };
}
function req(opts: { org?: string | null; params?: Record<string, string>; query?: Record<string, unknown> } = {}): Request {
  return {
    organizationContext: opts.org === null ? undefined : { organizationId: opts.org ?? ORG_A },
    params: opts.params ?? {},
    query: opts.query ?? {},
    ip: "203.0.113.5",
    userId: "u1"
  } as unknown as Request;
}

beforeEach(() => {
  list.mockReset();
  redrive.mockReset();
  ignore.mockReset();
  audit.mockReset();
});

describe("listConnectorDeadLetters", () => {
  it("403 without org context", async () => {
    const res = mockRes();
    await listConnectorDeadLetters(req({ org: null }), res);
    expect(res._status).toBe(403);
  });

  it("400 on an invalid status filter", async () => {
    const res = mockRes();
    await listConnectorDeadLetters(req({ query: { status: "bogus" } }), res);
    expect(res._status).toBe(400);
    expect(list).not.toHaveBeenCalled();
  });

  it("returns a projected list", async () => {
    list.mockResolvedValueOnce([
      { id: DL_ID, source: "connector_writeback", connector_id: "servicenow_cmdb", external_ref: "a1", field: "owned_by", attempts: 5, error: "boom", payload: { field: "owned_by" }, status: "open", created_at: "t", resolved_at: null }
    ]);
    const res = mockRes();
    await listConnectorDeadLetters(req({ query: { status: "open" } }), res);
    expect(res._status).toBe(200);
    const body = res._json as { dead_letters: Array<Record<string, unknown>> };
    expect(body.dead_letters[0]).toMatchObject({ id: DL_ID, source: "connector_writeback", status: "open" });
    expect(body.dead_letters[0]).not.toHaveProperty("payload"); // payload not echoed
    expect(list).toHaveBeenCalledWith(ORG_A, { status: "open" });
  });
});

describe("redriveConnectorDeadLetter", () => {
  it("400 on a non-uuid id", async () => {
    const res = mockRes();
    await redriveConnectorDeadLetter(req({ params: { id: "nope" } }), res);
    expect(res._status).toBe(400);
  });

  it("404 when the dead-letter is gone", async () => {
    redrive.mockResolvedValueOnce({ ok: false, error: "not_found" });
    const res = mockRes();
    await redriveConnectorDeadLetter(req({ params: { id: DL_ID } }), res);
    expect(res._status).toBe(404);
  });

  it("409 when already resolved concurrently", async () => {
    redrive.mockResolvedValueOnce({ ok: false, error: "already_resolved" });
    const res = mockRes();
    await redriveConnectorDeadLetter(req({ params: { id: DL_ID } }), res);
    expect(res._status).toBe(409);
  });

  it("202 + audit on success", async () => {
    redrive.mockResolvedValueOnce({ ok: true, action: "sync_enqueued", detail: { job_id: "j1", deduped: false } });
    const res = mockRes();
    await redriveConnectorDeadLetter(req({ params: { id: DL_ID } }), res);
    expect(res._status).toBe(202);
    expect(res._json).toMatchObject({ redriven: true, action: "sync_enqueued", job_id: "j1" });
    expect(redrive).toHaveBeenCalledWith(ORG_A, DL_ID, "u1");
    expect(audit).toHaveBeenCalledTimes(1);
  });
});

describe("ignoreConnectorDeadLetter", () => {
  it("404 when not open", async () => {
    ignore.mockResolvedValueOnce(false);
    const res = mockRes();
    await ignoreConnectorDeadLetter(req({ params: { id: DL_ID } }), res);
    expect(res._status).toBe(404);
  });

  it("200 + audit when dismissed", async () => {
    ignore.mockResolvedValueOnce(true);
    const res = mockRes();
    await ignoreConnectorDeadLetter(req({ params: { id: DL_ID } }), res);
    expect(res._status).toBe(200);
    expect(res._json).toEqual({ ignored: true });
    expect(audit).toHaveBeenCalledTimes(1);
  });
});
