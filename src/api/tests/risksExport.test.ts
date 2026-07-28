import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const ORG = "11111111-1111-4111-8111-111111111111";

const h = vi.hoisted(() => ({
  state: {
    rows: [] as Array<Record<string, unknown>>,
    calls: [] as Array<{ sql: string; params: unknown[] }>,
  },
}));

const audited = vi.hoisted(() => ({ events: [] as Array<Record<string, unknown>> }));

vi.mock("../infra/postgres.js", () => ({
  pg: {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      h.state.calls.push({ sql, params });
      return { rows: h.state.rows, rowCount: h.state.rows.length };
    }),
    connect: vi.fn(),
  },
  withTenant: vi.fn(async (_org: string, cb: () => Promise<unknown>) => cb()),
  pgElevated: { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) },
}));
vi.mock("../lib/auditLog.js", () => ({
  writeAuditEvent: vi.fn((event: Record<string, unknown>) => {
    audited.events.push(event);
  }),
}));
vi.mock("../middleware/requireApiKey.js", () => ({
  requireApiKey: (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    req.userId = "user-1";
    req.apiKey = { id: "key-1" };
    next();
  },
}));
vi.mock("../middleware/attachOrganizationContext.js", () => ({
  attachOrganizationContext: (
    req: { organizationContext?: unknown },
    _res: unknown,
    next: () => void
  ) => {
    req.organizationContext = { organizationId: ORG, entitlementLevel: "premium" };
    next();
  },
}));
vi.mock("../middleware/requireEntitlement.js", () => ({
  requireEntitlement: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

// Import AFTER mocks.
import risksExportRouter from "../routes/risksExport.js";

function makeApp() {
  const app = express();
  app.use("/api", risksExportRouter);
  return app;
}

const ROW = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  title: 'Vendor "Acme", single point of failure',
  domain: "Vendor Risk",
  likelihood: "likely",
  impact: "High",
  inherent_rating: "High",
  residual_rating: "Moderate",
  risk_rating: "Moderate",
  status: "open",
  treatment: "mitigate",
  owner: "Jamie",
  due_date: "2026-09-30T00:00:00.000Z",
  source_type: "finding_promotion",
  created_at: "2026-07-01T10:00:00.000Z",
  updated_at: "2026-07-20T10:00:00.000Z",
};

beforeEach(() => {
  h.state.rows = [];
  h.state.calls = [];
  audited.events = [];
});

describe("GET /api/risks/export.csv", () => {
  it("streams an RFC-4180 CSV with the register columns, org-scoped and capped", async () => {
    h.state.rows = [ROW];
    const res = await request(makeApp()).get("/api/risks/export.csv");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.headers["content-disposition"]).toMatch(/risk-register-\d{4}-\d{2}-\d{2}\.csv/);

    const call = h.state.calls[0]!;
    expect(call.params).toEqual([ORG]);
    expect(call.sql).toMatch(/organization_id = \$1/);
    expect(call.sql).toMatch(/LIMIT 10000/);

    const lines = res.text.split("\r\n").filter((l) => l.length > 0);
    expect(lines[0]).toBe(
      '"ID","Title","Domain","Likelihood","Impact","Inherent Rating","Residual Rating","Risk Rating","Status","Treatment","Owner","Due Date","Source Type","Created At","Updated At"'
    );
    // Inner quotes doubled per RFC 4180; dates truncated to YYYY-MM-DD.
    expect(lines[1]).toContain('"Vendor ""Acme"", single point of failure"');
    expect(lines[1]).toContain('"2026-09-30"');
    expect(lines[1]).toContain('"2026-07-01"');
  });

  it("applies allowlisted filters as bound params and honors active=true", async () => {
    await request(makeApp()).get(
      "/api/risks/export.csv?status=open&risk_rating=High&domain=Vendor%20Risk&active=true"
    );
    const call = h.state.calls[0]!;
    expect(call.params).toEqual([ORG, "open", "High", "Vendor Risk"]);
    expect(call.sql).toMatch(/r\.status NOT IN/);
  });

  it("rejects unknown status and rating values with the export vocabulary", async () => {
    const badStatus = await request(makeApp()).get("/api/risks/export.csv?status=nope");
    expect(badStatus.status).toBe(400);
    expect(badStatus.body).toEqual({ error: "invalid_status_filter" });

    const badRating = await request(makeApp()).get("/api/risks/export.csv?risk_rating=Extreme");
    expect(badRating.status).toBe(400);
    expect(badRating.body).toEqual({ error: "invalid_risk_rating_filter" });
    expect(h.state.calls).toHaveLength(0);
  });

  it("writes a data.exported audit event with the record count", async () => {
    h.state.rows = [ROW];
    await request(makeApp()).get("/api/risks/export.csv");

    expect(audited.events).toHaveLength(1);
    const evt = audited.events[0]!;
    expect(evt.eventType).toBe("data.exported");
    expect(evt.resourceType).toBe("risk");
    expect(evt.payload).toEqual({ format: "csv", record_count: 1, entity: "risks" });
  });

  it("exports an empty register as a header-only CSV", async () => {
    const res = await request(makeApp()).get("/api/risks/export.csv");
    expect(res.status).toBe(200);
    const lines = res.text.split("\r\n").filter((l) => l.length > 0);
    expect(lines).toHaveLength(1);
    expect(audited.events[0]!.payload).toMatchObject({ record_count: 0 });
  });
});
