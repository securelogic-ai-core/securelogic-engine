/**
 * auditLogExportRoute.test.ts — regression suite for
 * GET /api/audit-log/export.csv after its migration to the shared
 * csvExport serializer (the last export route with a local escaping copy).
 *
 * Covers: text/csv content type, .csv filename, unchanged column names,
 * RFC 4180 quoting, full-ISO timestamps, metadata-as-JSON round-trip,
 * tenant scoping in the SQL, filter forwarding, and JSON (non-download)
 * error responses on failure.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const ORG_ID = "aaaaaaaa-1111-4222-8333-bbbbbbbbbbbb";

const queryMock = vi.fn();

vi.mock("../infra/postgres.js", () => ({
  pg: { query: (...args: unknown[]) => queryMock(...args) },
  // M-1 PR-2: transparent passthrough — the wrap/withTenant scope is proven
  // over a real DB in test/isolation; unit tests exercise the handler body.
  withTenant: (_orgId: unknown, fn: () => unknown) => fn(),
}));
vi.mock("../infra/logger.js", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
vi.mock("../lib/auditLog.js", () => ({
  writeAuditEvent: vi.fn(),
}));
vi.mock("../middleware/requireApiKey.js", () => ({
  requireApiKey: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../middleware/attachOrganizationContext.js", () => ({
  attachOrganizationContext: (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    req.organizationContext = { organizationId: ORG_ID };
    next();
  },
}));
vi.mock("../middleware/requireEntitlement.js", () => ({
  requireEntitlement: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../middleware/requireRole.js", () => ({
  requireAdminRole: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import auditLogRouter from "../routes/auditLog.js";

function makeApp() {
  const app = express();
  app.use("/api", auditLogRouter);
  return app;
}

const SAMPLE_ROWS = [
  {
    created_at: new Date("2026-07-01T12:34:56.000Z"),
    event_type: "data.exported",
    actor_email: "admin@example.com",
    actor_name: 'Ada "The Auditor" Lovelace',
    resource_type: "finding",
    resource_id: "11111111-1111-4111-8111-111111111111",
    ip_address: "203.0.113.7",
    metadata: { format: "csv", note: 'has "quotes", commas' },
  },
  {
    created_at: new Date("2026-06-15T08:00:00.000Z"),
    event_type: "user.login",
    actor_email: null,
    actor_name: null,
    resource_type: null,
    resource_id: null,
    ip_address: null,
    metadata: null,
  },
];

beforeEach(() => {
  queryMock.mockReset();
});

describe("GET /api/audit-log/export.csv", () => {
  it("returns text/csv with a .csv attachment filename and unchanged column names", async () => {
    queryMock.mockResolvedValueOnce({ rows: SAMPLE_ROWS, rowCount: SAMPLE_ROWS.length });

    const res = await request(makeApp()).get("/api/audit-log/export.csv");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.headers["content-disposition"]).toMatch(/attachment; filename="audit-log-\d{4}-\d{2}-\d{2}\.csv"/);

    const lines = res.text.trim().split("\r\n");
    // Column names are the route's pre-migration contract.
    expect(lines[0]).toBe(
      '"timestamp","event_type","actor_email","actor_name","resource_type","resource_id","ip_address","metadata"'
    );
    expect(lines).toHaveLength(1 + SAMPLE_ROWS.length);
  });

  it("serializes timestamps as full ISO and metadata as JSON with RFC 4180 escaping", async () => {
    queryMock.mockResolvedValueOnce({ rows: SAMPLE_ROWS, rowCount: SAMPLE_ROWS.length });

    const res = await request(makeApp()).get("/api/audit-log/export.csv");
    const lines = res.text.trim().split("\r\n");

    // Full ISO timestamp — audit precision, not date-only.
    expect(lines[1].startsWith('"2026-07-01T12:34:56.000Z"')).toBe(true);
    // Quotes in a name are doubled, not dropped.
    expect(lines[1]).toContain('"Ada ""The Auditor"" Lovelace"');
    // Metadata cell round-trips as JSON once unquoted.
    const metadataCell = lines[1].slice(lines[1].indexOf('"{'));
    const unescaped = metadataCell.slice(1, -1).replace(/""/g, '"');
    expect(JSON.parse(unescaped)).toEqual({ format: "csv", note: 'has "quotes", commas' });
    // Null cells are empty quoted cells, not the string "null".
    expect(lines[2]).toBe('"2026-06-15T08:00:00.000Z","user.login","","","","","",""');
  });

  it("scopes the query to the requesting organization (tenant isolation)", async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await request(makeApp()).get("/api/audit-log/export.csv");

    expect(queryMock).toHaveBeenCalledTimes(1);
    const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("sal.organization_id = $1");
    expect(params[0]).toBe(ORG_ID);
  });

  it("forwards valid filters into the WHERE clause as bound params", async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const res = await request(makeApp()).get(
      "/api/audit-log/export.csv?event_type=user.login&date_from=2026-01-01"
    );

    expect(res.status).toBe(200);
    const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("sal.event_type = $2");
    expect(sql).toContain("sal.created_at >= $3::timestamptz");
    expect(params.slice(0, 3)).toEqual([ORG_ID, "user.login", "2026-01-01"]);
  });

  it("ignores malformed filter values instead of binding them", async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await request(makeApp()).get(
      "/api/audit-log/export.csv?user_id=not-a-uuid&date_to=yesterday"
    );

    const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sql).not.toContain("sal.actor_user_id = $");
    expect(params).toEqual([ORG_ID, 10000]);
  });

  it("returns 500 JSON with no attachment headers when the query fails", async () => {
    queryMock.mockRejectedValueOnce(new Error("db down"));

    const res = await request(makeApp()).get("/api/audit-log/export.csv");

    expect(res.status).toBe(500);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(res.headers["content-disposition"]).toBeUndefined();
    expect(res.body).toEqual({ error: "audit_log_export_failed" });
  });
});
