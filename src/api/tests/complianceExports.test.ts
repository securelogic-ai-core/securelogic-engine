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
vi.mock("../lib/corePlatformCapability.js", () => ({
  requirePremiumOrCorePlatform: (_req: unknown, _res: unknown, next: () => void) =>
    next(),
}));

// Import AFTER mocks.
import obligationsExportRouter from "../routes/obligationsExport.js";
import controlsExportRouter from "../routes/controlsExport.js";

function makeApp() {
  const app = express();
  app.use("/api", obligationsExportRouter);
  app.use("/api", controlsExportRouter);
  return app;
}

beforeEach(() => {
  h.state.rows = [];
  h.state.calls = [];
  audited.events = [];
});

describe("GET /api/obligations/export.csv", () => {
  it("streams the register with owner email joined org-scoped", async () => {
    h.state.rows = [{
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      title: 'Art. 32 "Security of processing"',
      source_regulation: "GDPR",
      jurisdiction: "EU",
      domain: "Privacy",
      status: "active",
      priority: "near_term",
      due_date: "2026-12-31T00:00:00.000Z",
      owner_email: "dpo@example.com",
      description: "TOMs required",
      notes: null,
      created_at: "2026-07-01T10:00:00.000Z",
      updated_at: "2026-07-15T10:00:00.000Z",
    }];
    const res = await request(makeApp()).get("/api/obligations/export.csv");

    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toMatch(/obligations-\d{4}-\d{2}-\d{2}\.csv/);

    const call = h.state.calls[0]!;
    expect(call.params).toEqual([ORG]);
    expect(call.sql).toMatch(/o\.organization_id = \$1/);
    // Owner join must be org-bound on BOTH keys — a bare id join could pull a
    // same-id user row cross-tenant if ids ever collide.
    expect(call.sql).toMatch(/u\.organization_id = o\.organization_id/);
    expect(call.sql).toMatch(/LIMIT 10000/);

    const lines = res.text.split("\r\n").filter((l) => l.length > 0);
    expect(lines[0]).toBe(
      '"ID","Title","Source Regulation","Jurisdiction","Domain","Status","Priority","Due Date","Owner","Description","Notes","Created At","Updated At"'
    );
    expect(lines[1]).toContain('"Art. 32 ""Security of processing"""');
    expect(lines[1]).toContain('"dpo@example.com"');
    expect(lines[1]).toContain('"2026-12-31"');
  });

  it("rejects unknown status/priority; passes domain through as a bound param", async () => {
    expect((await request(makeApp()).get("/api/obligations/export.csv?status=open")).status).toBe(400);
    expect((await request(makeApp()).get("/api/obligations/export.csv?priority=urgent")).status).toBe(400);
    expect(h.state.calls).toHaveLength(0);

    await request(makeApp()).get(
      "/api/obligations/export.csv?status=active&priority=planned&domain=Privacy"
    );
    expect(h.state.calls[0]!.params).toEqual([ORG, "active", "planned", "Privacy"]);
  });

  it("writes a data.exported audit event", async () => {
    await request(makeApp()).get("/api/obligations/export.csv");
    expect(audited.events[0]).toMatchObject({
      eventType: "data.exported",
      resourceType: "obligation",
      payload: { format: "csv", record_count: 0, entity: "obligations" },
    });
  });
});

describe("GET /api/controls/export.csv", () => {
  it("streams the control matrix columns", async () => {
    h.state.rows = [{
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      name: "MFA for privileged access",
      control_type: "preventive",
      status: "active",
      domain: "Access Management",
      control_family: "IAM",
      maturity_level: "defined",
      implementation_status: "implemented",
      owner_email: "ciso@example.com",
      description: null,
      created_at: "2026-06-01T10:00:00.000Z",
      updated_at: "2026-07-01T10:00:00.000Z",
    }];
    const res = await request(makeApp()).get("/api/controls/export.csv");

    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toMatch(/controls-\d{4}-\d{2}-\d{2}\.csv/);

    const lines = res.text.split("\r\n").filter((l) => l.length > 0);
    expect(lines[0]).toBe(
      '"ID","Name","Type","Status","Domain","Family","Maturity","Implementation","Owner","Description","Created At","Updated At"'
    );
    expect(lines[1]).toContain('"MFA for privileged access"');
    expect(lines[1]).toContain('"implemented"');
  });

  it("binds status and domain as pass-through params (no CHECK vocabulary on controls)", async () => {
    await request(makeApp()).get(
      "/api/controls/export.csv?status=retired&domain=Access%20Management"
    );
    const call = h.state.calls[0]!;
    expect(call.params).toEqual([ORG, "retired", "Access Management"]);
    expect(call.sql).toMatch(/c\.organization_id = \$1/);
    expect(call.sql).toMatch(/u\.organization_id = c\.organization_id/);
  });

  it("writes a data.exported audit event with the control entity", async () => {
    await request(makeApp()).get("/api/controls/export.csv");
    expect(audited.events[0]).toMatchObject({
      eventType: "data.exported",
      resourceType: "control",
      payload: { format: "csv", record_count: 0, entity: "controls" },
    });
  });
});
