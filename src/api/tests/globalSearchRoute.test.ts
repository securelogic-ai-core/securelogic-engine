import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";

const ORG = "11111111-1111-4111-8111-111111111111";

// Hoisted mutable state the postgres mock reads from.
const h = vi.hoisted(() => ({
  state: {
    capabilityOverride: null as boolean | null,
    entitlementLevel: "premium" as string | null,
    queries: [] as string[],
  },
}));

function resolve(sql: string): { rows: unknown[]; rowCount: number } {
  h.state.queries.push(sql);
  if (/enterprise_context_capability FROM organizations/.test(sql)) {
    return {
      rows: [{ enterprise_context_capability: h.state.capabilityOverride }],
      rowCount: 1,
    };
  }
  if (/asset_search_index_v/.test(sql)) {
    return {
      rows: [{ id: "as1", title: "prod-web-01", subtitle: "endpoint" }],
      rowCount: 1,
    };
  }
  if (/FROM vendors/.test(sql)) {
    return { rows: [{ id: "v1", title: "Acme", subtitle: "critical" }], rowCount: 1 };
  }
  return { rows: [], rowCount: 0 };
}

vi.mock("../infra/postgres.js", () => ({
  pg: { query: vi.fn(async (sql: string) => resolve(sql)), connect: vi.fn() },
  withTenant: vi.fn(async (_org: string, cb: () => Promise<unknown>) => cb()),
  pgElevated: { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) },
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
    req.organizationContext = {
      organizationId: ORG,
      entitlementLevel: h.state.entitlementLevel,
    };
    next();
  },
}));
vi.mock("../lib/corePlatformCapability.js", () => ({
  requirePremiumOrCorePlatform: (_req: unknown, _res: unknown, next: () => void) =>
    next(),
}));

// Import AFTER mocks.
import searchRouter from "../routes/search.js";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", searchRouter);
  return app;
}

beforeEach(() => {
  h.state.capabilityOverride = null;
  h.state.entitlementLevel = "premium";
  h.state.queries = [];
});

afterEach(() => {
  delete process.env["SECURELOGIC_ASSET_REGISTRY_ENABLED"];
});

describe("GET /api/search", () => {
  it("rejects a missing or unusable query with 400", async () => {
    const app = makeApp();
    expect((await request(app).get("/api/search")).status).toBe(400);
    const res = await request(app).get("/api/search?q=a");
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "invalid_query" });
  });

  it("returns ranked org-scoped hits without assets while the registry flag is off", async () => {
    const app = makeApp();
    const res = await request(app).get("/api/search?q=acme");
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.hits[0]).toMatchObject({ type: "vendor", id: "v1", href: "/vendors/v1" });
    expect(h.state.queries.some((q) => /asset_search_index_v/.test(q))).toBe(false);
    // Flag off ⇒ no capability probe either.
    expect(
      h.state.queries.some((q) => /enterprise_context_capability/.test(q))
    ).toBe(false);
  });

  it("includes assets when the flag is on and the org holds the capability", async () => {
    process.env["SECURELOGIC_ASSET_REGISTRY_ENABLED"] = "true";
    const app = makeApp();
    const res = await request(app).get("/api/search?q=prod");
    expect(res.status).toBe(200);
    const assetHit = res.body.hits.find((x: { type: string }) => x.type === "asset");
    expect(assetHit).toMatchObject({ id: "as1", href: "/assets/as1" });
  });

  it("keeps assets out when the org lacks the enterprise_context capability", async () => {
    process.env["SECURELOGIC_ASSET_REGISTRY_ENABLED"] = "true";
    h.state.entitlementLevel = "professional"; // Brief tier: no platform default
    const app = makeApp();
    const res = await request(app).get("/api/search?q=prod");
    expect(res.status).toBe(200);
    expect(res.body.hits.some((x: { type: string }) => x.type === "asset")).toBe(false);
  });

  it("an explicit capability deny beats the platform-plan default", async () => {
    process.env["SECURELOGIC_ASSET_REGISTRY_ENABLED"] = "true";
    h.state.capabilityOverride = false;
    const app = makeApp();
    const res = await request(app).get("/api/search?q=prod");
    expect(res.status).toBe(200);
    expect(res.body.hits.some((x: { type: string }) => x.type === "asset")).toBe(false);
  });
});
