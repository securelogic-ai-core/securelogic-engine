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
import aiSystemsExportRouter from "../routes/aiSystemsExport.js";

function makeApp() {
  const app = express();
  app.use("/api", aiSystemsExportRouter);
  return app;
}

beforeEach(() => {
  h.state.rows = [];
  h.state.calls = [];
  audited.events = [];
});

describe("GET /api/ai-systems/export.csv", () => {
  it("streams the inventory with owner email joined org-scoped", async () => {
    h.state.rows = [{
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      name: 'Support bot "Athena"',
      use_case: "Customer support triage",
      model_type: "LLM",
      data_classification: "confidential",
      deployment_status: "production",
      criticality: "high",
      risk_classification: "limited",
      owner_email: "ml-lead@example.com",
      created_at: "2026-05-01T10:00:00.000Z",
      updated_at: "2026-07-01T10:00:00.000Z",
    }];
    const res = await request(makeApp()).get("/api/ai-systems/export.csv");

    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toMatch(/ai-systems-\d{4}-\d{2}-\d{2}\.csv/);

    const call = h.state.calls[0]!;
    expect(call.params).toEqual([ORG]);
    expect(call.sql).toMatch(/a\.organization_id = \$1/);
    expect(call.sql).toMatch(/u\.organization_id = a\.organization_id/);
    expect(call.sql).toMatch(/LIMIT 10000/);

    const lines = res.text.split("\r\n").filter((l) => l.length > 0);
    expect(lines[0]).toBe(
      '"ID","Name","Use Case","Model Type","Data Classification","Deployment Status","Criticality","Risk Classification","Owner","Created At","Updated At"'
    );
    expect(lines[1]).toContain('"Support bot ""Athena"""');
    expect(lines[1]).toContain('"ml-lead@example.com"');
  });

  it("rejects unknown criticality; passes deployment_status/risk_classification through", async () => {
    expect(
      (await request(makeApp()).get("/api/ai-systems/export.csv?criticality=extreme")).status
    ).toBe(400);
    expect(h.state.calls).toHaveLength(0);

    await request(makeApp()).get(
      "/api/ai-systems/export.csv?criticality=high&deployment_status=pilot&risk_classification=high-risk"
    );
    expect(h.state.calls[0]!.params).toEqual([ORG, "high", "pilot", "high-risk"]);
  });

  it("writes a data.exported audit event with the ai_system entity", async () => {
    await request(makeApp()).get("/api/ai-systems/export.csv");
    expect(audited.events[0]).toMatchObject({
      eventType: "data.exported",
      resourceType: "ai_system",
      payload: { format: "csv", record_count: 0, entity: "ai_systems" },
    });
  });
});
