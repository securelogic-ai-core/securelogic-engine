/**
 * findingsExportRoute.test.ts — EXP-1 regression suite for
 * GET /api/findings/export.csv.
 *
 * Staging defect: the export path was mounted AFTER findingsRouter, so
 * /api/findings/export.csv was captured by GET /findings/:id, which rejected
 * "export.csv" as a non-UUID id — the app proxy then served
 * {"error":"upstream_error"} and the browser saved it as findings.json.
 *
 * Covers: mount order, text/csv content type, .csv filename, header + data
 * rows, tenant scoping in the SQL, filter forwarding, and JSON (non-download)
 * error responses on failure.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
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

import findingsExportRouter from "../routes/findingsExport.js";

function makeApp() {
  const app = express();
  app.use("/api", findingsExportRouter);
  return app;
}

const SAMPLE_ROWS = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    title: 'Finding with "quotes", commas',
    severity: "High",
    priority: "near_term",
    status: "open",
    domain: "Cyber",
    source_type: "control_test",
    description: "desc",
    recommendation: "rec",
    due_date: "2026-08-01T00:00:00.000Z",
    created_at: "2026-07-01T00:00:00.000Z",
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    title: "Second finding",
    severity: "Low",
    priority: null,
    status: "closed",
    domain: null,
    source_type: "manual",
    description: null,
    recommendation: null,
    due_date: null,
    created_at: "2026-06-15T00:00:00.000Z",
  },
];

beforeEach(() => {
  queryMock.mockReset();
});

describe("route mount order (EXP-1 root cause)", () => {
  it("findingsExportRouter mounts before findingsRouter so /findings/export.csv is not captured by /findings/:id", () => {
    const source = readFileSync(resolve(__dirname, "../routes/index.ts"), "utf8");
    const exportMount = source.indexOf('router.use("/api", findingsExportRouter);');
    const findingsMount = source.indexOf('router.use("/api", findingsRouter);');
    expect(exportMount).toBeGreaterThan(-1);
    expect(findingsMount).toBeGreaterThan(-1);
    expect(exportMount).toBeLessThan(findingsMount);
  });
});

describe("GET /api/findings/export.csv", () => {
  it("returns text/csv with a .csv attachment filename, stable headers, and data rows", async () => {
    queryMock.mockResolvedValueOnce({ rows: SAMPLE_ROWS, rowCount: SAMPLE_ROWS.length });

    const res = await request(makeApp()).get("/api/findings/export.csv");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.headers["content-disposition"]).toMatch(/attachment; filename="findings-\d{4}-\d{2}-\d{2}\.csv"/);

    const lines = res.text.trim().split("\r\n");
    expect(lines[0]).toBe(
      '"ID","Title","Severity","Priority","Status","Domain","Source Type","Description","Recommendation","Due Date","Created At"'
    );
    expect(lines).toHaveLength(1 + SAMPLE_ROWS.length);
    // RFC 4180 quote escaping survives round-trip.
    expect(lines[1]).toContain('"Finding with ""quotes"", commas"');
    expect(lines[2]).toContain('"Second finding"');
  });

  it("scopes the query to the requesting organization (tenant isolation)", async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await request(makeApp()).get("/api/findings/export.csv");

    expect(queryMock).toHaveBeenCalledTimes(1);
    const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("f.organization_id = $1");
    expect(params[0]).toBe(ORG_ID);
  });

  it("forwards valid filters into the WHERE clause as bound params", async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const res = await request(makeApp()).get(
      "/api/findings/export.csv?status=open&severity=High"
    );

    expect(res.status).toBe(200);
    const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("f.status = $2");
    expect(sql).toContain("f.severity = $3");
    expect(params).toEqual([ORG_ID, "open", "High"]);
  });

  it("rejects invalid filter values with 400 JSON (never a file)", async () => {
    const res = await request(makeApp()).get(
      "/api/findings/export.csv?severity=Catastrophic"
    );

    expect(res.status).toBe(400);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(res.headers["content-disposition"]).toBeUndefined();
    expect(res.body).toEqual({ error: "invalid_severity_filter" });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("returns 500 JSON with no attachment headers when the query fails", async () => {
    queryMock.mockRejectedValueOnce(new Error("db down"));

    const res = await request(makeApp()).get("/api/findings/export.csv");

    expect(res.status).toBe(500);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(res.headers["content-disposition"]).toBeUndefined();
    expect(res.body).toEqual({ error: "findings_export_failed" });
  });
});
