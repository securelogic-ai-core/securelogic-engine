/**
 * auditLogResourceFilterRoute.test.ts — resource drill-down filters on the
 * audit log (resource_type + resource_id on GET /api/audit-log and its CSV
 * export). Closes the recorded gap from the per-object history work: the
 * schema has carried a (resource_type, resource_id) index since 20260505,
 * and docs/risk-register-state-verification.md assumed the filter existed,
 * but neither endpoint ever accepted the parameters.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const ORG_ID      = "aaaaaaaa-1111-4222-8333-bbbbbbbbbbbb";
const RESOURCE_ID = "11111111-2222-4333-8444-555555555555";

const queryMock = vi.fn();

vi.mock("../infra/postgres.js", () => ({
  pg: { query: (...args: unknown[]) => queryMock(...args) },
  withTenant: vi.fn(),
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

beforeEach(() => {
  queryMock.mockReset();
  queryMock.mockResolvedValue({ rows: [{ total: "0" }], rowCount: 1 });
});

describe("GET /api/audit-log — resource filters", () => {
  it("binds resource_type and resource_id after the org param", async () => {
    const res = await request(makeApp()).get(
      `/api/audit-log?resource_type=vendor&resource_id=${RESOURCE_ID}`
    );

    expect(res.status).toBe(200);
    // List handler issues rows + count queries; both share the WHERE.
    const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("sal.organization_id = $1");
    expect(sql).toContain("sal.resource_type = $2");
    expect(sql).toContain("sal.resource_id = $3::uuid");
    expect(params.slice(0, 3)).toEqual([ORG_ID, "vendor", RESOURCE_ID]);

    const [countSql, countParams] = queryMock.mock.calls[1] as [string, unknown[]];
    expect(countSql).toContain("sal.resource_id = $3::uuid");
    expect(countParams).toEqual([ORG_ID, "vendor", RESOURCE_ID]);
  });

  it("composes with the existing filters in declaration order", async () => {
    await request(makeApp()).get(
      `/api/audit-log?event_type=vendor.updated&resource_type=vendor&resource_id=${RESOURCE_ID}&date_from=2026-01-01`
    );

    const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("sal.event_type = $2");
    expect(sql).toContain("sal.resource_type = $3");
    expect(sql).toContain("sal.resource_id = $4::uuid");
    expect(sql).toContain("sal.created_at >= $5::timestamptz");
    expect(params.slice(0, 5)).toEqual([
      ORG_ID, "vendor.updated", "vendor", RESOURCE_ID, "2026-01-01",
    ]);
  });

  it("ignores a non-uuid resource_id and a blank resource_type", async () => {
    await request(makeApp()).get(
      "/api/audit-log?resource_type=%20%20&resource_id=not-a-uuid"
    );

    const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sql).not.toContain("sal.resource_type = $");
    expect(sql).not.toContain("sal.resource_id = $");
    expect(params.slice(0, 1)).toEqual([ORG_ID]);
  });
});

describe("GET /api/audit-log/export.csv — resource filters", () => {
  it("forwards resource filters into the export WHERE clause", async () => {
    queryMock.mockReset();
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const res = await request(makeApp()).get(
      `/api/audit-log/export.csv?resource_type=ai_system&resource_id=${RESOURCE_ID}`
    );

    expect(res.status).toBe(200);
    const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("sal.organization_id = $1");
    expect(sql).toContain("sal.resource_type = $2");
    expect(sql).toContain("sal.resource_id = $3::uuid");
    // Trailing param stays the CSV row cap.
    expect(params).toEqual([ORG_ID, "ai_system", RESOURCE_ID, 10000]);
  });

  it("ignores a malformed resource_id on export", async () => {
    queryMock.mockReset();
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await request(makeApp()).get(
      "/api/audit-log/export.csv?resource_id=DROP%20TABLE"
    );

    const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sql).not.toContain("sal.resource_id = $");
    expect(params).toEqual([ORG_ID, 10000]);
  });
});
