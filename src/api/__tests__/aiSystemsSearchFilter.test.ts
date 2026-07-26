/**
 * aiSystemsSearchFilter.test.ts — GET /api/ai-systems?q= rides the SHARED
 * asset-search capability (assetSearchResolver → asset_search_index_v),
 * narrowed to ai_system-typed assets and applied by backing id. Mirrors
 * vendorsSearchFilter.test.ts — the two federated lists must behave
 * identically (cross-page consistency).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const ORG = "11111111-1111-4111-8111-111111111111";
const SYSTEM_ID = "33333333-3333-4333-8333-333333333333";

const h = vi.hoisted(() => ({
  calls: [] as Array<{ sql: string; params: unknown[] }>,
  searchRows: [] as unknown[]
}));

vi.mock("../infra/postgres.js", () => ({
  pg: {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      h.calls.push({ sql, params });
      if (sql.includes("asset_search_index_v") || sql.includes("FROM asset_registry_v")) {
        return { rows: h.searchRows, rowCount: h.searchRows.length };
      }
      return { rows: [], rowCount: 0 };
    }),
    connect: vi.fn()
  },
  withTenant: vi.fn(async (_org: string, cb: () => Promise<unknown>) => cb()),
  pgElevated: { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) }
}));
vi.mock("../middleware/requireApiKey.js", () => ({
  requireApiKey: (_req: unknown, _res: unknown, next: () => void) => next()
}));
vi.mock("../middleware/attachOrganizationContext.js", () => ({
  attachOrganizationContext: (req: { organizationContext?: unknown }, _res: unknown, next: () => void) => {
    req.organizationContext = { organizationId: ORG };
    next();
  }
}));
vi.mock("../middleware/requireEntitlement.js", () => ({
  requireEntitlement: () => (_req: unknown, _res: unknown, next: () => void) => next()
}));
vi.mock("../lib/corePlatformCapability.js", () => ({
  requirePremiumOrCorePlatform: (_req: unknown, _res: unknown, next: () => void) => next()
}));
vi.mock("../middleware/requireAuth.js", () => ({
  requireAuth: (_req: unknown, _res: unknown, next: () => void) => next()
}));
vi.mock("../middleware/requireRole.js", () => ({
  requireAdminRole: (_req: unknown, _res: unknown, next: () => void) => next()
}));

import aiSystemsRouter from "../routes/aiSystems.js";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", aiSystemsRouter);
  return app;
}

const systemMatch = {
  asset_id: SYSTEM_ID,
  asset_type: "ai_system",
  backing_kind: "ai_systems",
  backing_id: SYSTEM_ID,
  term_kind: "name"
};

beforeEach(() => {
  h.calls = [];
  h.searchRows = [];
});

describe("GET /api/ai-systems?q= — the shared asset search", () => {
  it("resolves the term first (org-scoped, type-narrowed), then filters the list by backing id", async () => {
    h.searchRows = [systemMatch];

    const res = await request(makeApp()).get("/api/ai-systems?q=fraud").set("X-Api-Key", "k");
    expect(res.status).toBe(200);

    const resolver = h.calls.find((c) => c.sql.includes("asset_search_index_v"));
    expect(resolver).toBeDefined();
    expect(resolver!.params[0]).toBe(ORG);
    expect(resolver!.params[1]).toBe("%fraud%");
    expect(resolver!.params[2]).toEqual(["ai_system"]);

    const list = h.calls.find((c) => /FROM ai_systems/.test(c.sql) && /ORDER BY/.test(c.sql));
    expect(list).toBeDefined();
    expect(list!.sql).toMatch(/id = ANY\(\$\d+::uuid\[\]\)/);
    expect(list!.params).toContainEqual([SYSTEM_ID]);
  });

  it("zero matches → honest empty envelope, and the list query never runs", async () => {
    h.searchRows = [];

    const res = await request(makeApp()).get("/api/ai-systems?q=nomatch").set("X-Api-Key", "k");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ count: 0, ai_systems: [], nextCursor: null });
    expect(h.calls.some((c) => /FROM ai_systems/.test(c.sql))).toBe(false);
  });

  it("keeps the platform 2–120 bounds: 400 invalid_search outside them", async () => {
    for (const bad of ["a", "a".repeat(121)]) {
      const res = await request(makeApp()).get(`/api/ai-systems?q=${encodeURIComponent(bad)}`).set("X-Api-Key", "k");
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: "invalid_search" });
    }
    expect(h.calls).toHaveLength(0);
  });

  it("q composes with the criticality filter", async () => {
    h.searchRows = [systemMatch];

    const res = await request(makeApp())
      .get("/api/ai-systems?q=fraud&criticality=critical")
      .set("X-Api-Key", "k");
    expect(res.status).toBe(200);

    const list = h.calls.find((c) => /FROM ai_systems/.test(c.sql) && /ORDER BY/.test(c.sql));
    expect(list!.sql).toContain("criticality = $2");
    expect(list!.sql).toMatch(/id = ANY\(\$3::uuid\[\]\)/);
    expect(list!.params.slice(0, 3)).toEqual([ORG, "critical", [SYSTEM_ID]]);
  });
});
