/**
 * connectorHealthHandler.test.ts — ERIP E2c: handler-level unit test for GET
 * /api/connectors/health (health store mocked). Proves the tenant guard, that
 * unconfigured registry connectors are surfaced, and the rollup/by-band shape.
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
vi.mock("../lib/connectorHealthStore.js", () => ({ gatherConnectorHealth: vi.fn() }));

import { gatherConnectorHealth } from "../lib/connectorHealthStore.js";
import type { ConnectorHealthRaw } from "../lib/connectorHealthStore.js";
import { getConnectorHealth } from "../routes/connectors.js";

const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const gather = gatherConnectorHealth as unknown as ReturnType<typeof vi.fn>;

function mockRes(): Response & { _status?: number; _json?: unknown } {
  const res = {
    _status: 0, _json: undefined,
    status(c: number) { (this as { _status: number })._status = c; return this; },
    json(b: unknown) { (this as { _json: unknown })._json = b; return this; }
  };
  return res as unknown as Response & { _status?: number; _json?: unknown };
}
function req(org: string | null = ORG_A): Request {
  return { organizationContext: org ? { organizationId: org } : undefined } as unknown as Request;
}
function raw(over: Partial<ConnectorHealthRaw>): ConnectorHealthRaw {
  return {
    connector_id: "servicenow_cmdb", enabled: true, last_sync_status: "succeeded", last_sync_at: null,
    consecutive_failures: 0, sync_interval_minutes: null, next_sync_at: null, stale_observations: 0,
    writeback_pending: 0, writeback_conflict: 0, writeback_failed: 0, open_dead_letters: 0, ...over
  };
}

beforeEach(() => gather.mockReset());

describe("getConnectorHealth", () => {
  it("403 without org context", async () => {
    const res = mockRes();
    await getConnectorHealth(req(null), res);
    expect(res._status).toBe(403);
  });

  it("surfaces configured + unconfigured connectors with an org rollup", async () => {
    gather.mockResolvedValueOnce(new Map([
      ["servicenow_cmdb", raw({ open_dead_letters: 2, last_sync_at: "2026-01-01T00:00:00Z" })]
    ]));
    const res = mockRes();
    await getConnectorHealth(req(), res);
    expect(res._status).toBe(200);
    const body = res._json as {
      overall_band: string;
      configured_count: number;
      by_band: Record<string, number>;
      connectors: Array<{ connector_id: string; band: string; signals: { open_dead_letters: number } }>;
    };
    // The one configured connector has open dead-letters → failing → rollup failing.
    expect(body.overall_band).toBe("failing");
    expect(body.configured_count).toBe(1);
    const sn = body.connectors.find((c) => c.connector_id === "servicenow_cmdb")!;
    expect(sn.band).toBe("failing");
    expect(sn.signals.open_dead_letters).toBe(2);
    // Every OTHER registry connector is reported unconfigured (not in the rollup).
    expect(body.connectors.length).toBeGreaterThan(1);
    expect(body.by_band.unconfigured).toBeGreaterThanOrEqual(1);
  });
});
