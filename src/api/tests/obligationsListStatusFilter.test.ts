import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const ORG = "11111111-1111-4111-8111-111111111111";

const h = vi.hoisted(() => ({
  state: {
    calls: [] as Array<{ sql: string; params: unknown[] }>,
  },
}));

vi.mock("../infra/postgres.js", () => ({
  pg: {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      h.state.calls.push({ sql, params });
      return { rows: [], rowCount: 0 };
    }),
    connect: vi.fn(),
  },
  withTenant: vi.fn(async (_org: string, cb: () => Promise<unknown>) => cb()),
  pgElevated: { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) },
}));
vi.mock("../lib/auditLog.js", () => ({ writeAuditEvent: vi.fn() }));
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
import obligationsRouter from "../routes/obligations.js";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", obligationsRouter);
  return app;
}

beforeEach(() => {
  h.state.calls = [];
});

describe("GET /api/obligations — status filter contract", () => {
  it("defaults to active when no status is given (unchanged contract)", async () => {
    const res = await request(makeApp()).get("/api/obligations");
    expect(res.status).toBe(200);
    expect(res.body.statusFilter).toBe("active");
    const call = h.state.calls[0]!;
    expect(call.sql).toMatch(/status = \$2/);
    expect(call.params[1]).toBe("active");
  });

  it("status=all returns every lifecycle state (no status predicate)", async () => {
    const res = await request(makeApp()).get("/api/obligations?status=all");
    expect(res.status).toBe(200);
    expect(res.body.statusFilter).toBe("all");
    const call = h.state.calls[0]!;
    expect(call.sql).not.toMatch(/status =/);
    // Only org + limit bound.
    expect(call.params).toEqual([ORG, 25]);
  });

  it("overdue=true adds the Metric Contract predicate to the active view", async () => {
    const res = await request(makeApp()).get("/api/obligations?overdue=true");
    expect(res.status).toBe(200);
    const call = h.state.calls[0]!;
    // Default status=active bound + the overdue predicate appended.
    expect(call.params[1]).toBe("active");
    expect(call.sql).toContain(
      "status = 'active' AND due_date IS NOT NULL AND due_date < CURRENT_DATE"
    );
  });

  it("still filters explicit lifecycle states and rejects unknown ones", async () => {
    await request(makeApp()).get("/api/obligations?status=waived");
    expect(h.state.calls[0]!.params[1]).toBe("waived");

    const bad = await request(makeApp()).get("/api/obligations?status=completed");
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe("invalid_status_filter");
    expect(bad.body.allowed).toEqual(["active", "waived", "not_applicable", "all"]);
  });
});

describe("GET /api/obligations — register search (q)", () => {
  it("q adds the escaped three-field ILIKE predicate", async () => {
    const res = await request(makeApp()).get("/api/obligations?q=GDPR%20Art");
    expect(res.status).toBe(200);
    const call = h.state.calls[0]!;
    expect(call.sql).toContain("title ILIKE");
    expect(call.sql).toContain("source_regulation, '') ILIKE");
    expect(call.sql).toContain("description, '') ILIKE");
    // Bound once, escaped, wildcard-wrapped.
    expect(call.params).toContain("%GDPR Art%");
  });

  it("escapes LIKE metacharacters in the bound pattern", async () => {
    await request(makeApp()).get("/api/obligations?q=" + encodeURIComponent("50%_off"));
    expect(h.state.calls[0]!.params).toContain("%50\\%\\_off%");
  });

  it("enforces the platform 2–120 bounds with 400 invalid_search", async () => {
    expect((await request(makeApp()).get("/api/obligations?q=x")).status).toBe(400);
    expect(
      (await request(makeApp()).get("/api/obligations?q=" + "x".repeat(121))).status
    ).toBe(400);
    expect(h.state.calls).toHaveLength(0);
  });
});
