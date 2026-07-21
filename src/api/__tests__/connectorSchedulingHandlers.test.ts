/**
 * connectorSchedulingHandlers.test.ts — ERIP E2.P1: handler-level unit tests
 * for the PUT sync_interval_minutes surface (pg mocked, the
 * connectorsHandlers.test.ts style). Real-Postgres scheduler behavior is
 * covered by test/isolation/connectorScheduling.test.ts.
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
import { putConnectorConfig } from "../routes/connectors.js";

const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
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

function reqFor(body: unknown): Request {
  return {
    organizationContext: { organizationId: ORG_A },
    params: { id: "identity_provider" },
    body,
    ip: "203.0.113.5"
  } as unknown as Request;
}

function storedRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    organization_id: ORG_A,
    connector_id: "identity_provider",
    config_encrypted: JSON.stringify({ base_url: "https://corp.okta.com", api_token: "sekret-value-xyz" }),
    enabled: true,
    last_sync_at: null,
    last_sync_status: null,
    last_sync_summary: null,
    sync_interval_minutes: null,
    next_sync_at: null,
    consecutive_failures: 0,
    ...overrides
  };
}

const VALID_CONFIG = { base_url: "https://corp.okta.com", api_token: "sekret-value-xyz" };

beforeEach(() => {
  q.mockReset();
  audit.mockReset();
});

describe("putConnectorConfig — sync_interval_minutes", () => {
  it("400 on an invalid interval BEFORE any query runs", async () => {
    for (const bad of [14, 0, 60.5, "60", true]) {
      const res = mockRes();
      await putConnectorConfig(reqFor({ config: VALID_CONFIG, sync_interval_minutes: bad }), res);
      expect(res._status).toBe(400);
      expect(res._json).toMatchObject({ error: "sync_interval_invalid" });
    }
    expect(q).not.toHaveBeenCalled();
  });

  it("omitting the field leaves the schedule untouched (single upsert query)", async () => {
    q.mockResolvedValueOnce({ rows: [storedRow()], rowCount: 1 });
    const res = mockRes();
    await putConnectorConfig(reqFor({ config: VALID_CONFIG, enabled: true }), res);
    expect(res._status).toBe(200);
    expect(q).toHaveBeenCalledTimes(1); // upsert only — no schedule UPDATE
  });

  it("a valid interval upserts then updates the schedule, and the response carries it", async () => {
    q.mockResolvedValueOnce({ rows: [storedRow()], rowCount: 1 }); // upsert
    q.mockResolvedValueOnce({ rows: [storedRow({ sync_interval_minutes: 60 })], rowCount: 1 }); // schedule
    const res = mockRes();
    await putConnectorConfig(reqFor({ config: VALID_CONFIG, enabled: true, sync_interval_minutes: 60 }), res);
    expect(res._status).toBe(200);
    expect(q).toHaveBeenCalledTimes(2);
    expect(q.mock.calls[1]![1]).toEqual([ORG_A, "identity_provider", 60]);
    expect(res._json).toMatchObject({ connector: { sync_interval_minutes: 60, consecutive_failures: 0 } });

    // Audit records the schedule but still never echoes config values.
    expect(audit).toHaveBeenCalledTimes(1);
    expect(audit.mock.calls[0]![0].payload).toMatchObject({ sync_interval_minutes: 60 });
    expect(JSON.stringify(audit.mock.calls[0])).not.toContain("sekret-value-xyz");
  });

  it("null clears the schedule (manual-only)", async () => {
    q.mockResolvedValueOnce({ rows: [storedRow({ sync_interval_minutes: 60 })], rowCount: 1 });
    q.mockResolvedValueOnce({ rows: [storedRow({ sync_interval_minutes: null })], rowCount: 1 });
    const res = mockRes();
    await putConnectorConfig(reqFor({ config: VALID_CONFIG, sync_interval_minutes: null }), res);
    expect(res._status).toBe(200);
    expect(q.mock.calls[1]![1]).toEqual([ORG_A, "identity_provider", null]);
    expect(res._json).toMatchObject({ connector: { sync_interval_minutes: null } });
  });
});
