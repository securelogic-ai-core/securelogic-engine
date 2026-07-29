/**
 * vendorsSearchFilter.test.ts — GET /api/vendors?q= rides the SHARED
 * asset-search capability (assetSearchResolver → asset_search_index_v),
 * narrowed to vendor-typed assets and applied by backing id. Proves:
 *   * the resolver runs org-scoped with the escaped pattern before the list;
 *   * the list SQL filters `id = ANY(...)` with the resolved BACKING ids;
 *   * zero matches short-circuit to an honest empty envelope (no list query);
 *   * the platform 2–120 bounds → 400 invalid_search;
 *   * q composes with the status/criticality filters.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const ORG = "11111111-1111-4111-8111-111111111111";
const VENDOR_ID = "22222222-2222-4222-8222-222222222222";

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

import vendorsRouter from "../routes/vendors.js";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", vendorsRouter);
  return app;
}

const vendorMatch = {
  asset_id: VENDOR_ID,
  asset_type: "vendor",
  backing_kind: "vendors",
  backing_id: VENDOR_ID,
  term_kind: "alias"
};

beforeEach(() => {
  h.calls = [];
  h.searchRows = [];
});

describe("GET /api/vendors?q= — the shared asset search", () => {
  it("resolves the term first (org-scoped, type-narrowed), then filters the list by backing id", async () => {
    h.searchRows = [vendorMatch];

    const res = await request(makeApp()).get("/api/vendors?q=SrchSuite").set("X-Api-Key", "k");
    expect(res.status).toBe(200);

    const resolver = h.calls.find((c) => c.sql.includes("asset_search_index_v"));
    expect(resolver).toBeDefined();
    expect(resolver!.params[0]).toBe(ORG);
    expect(resolver!.params[1]).toBe("%SrchSuite%");
    expect(resolver!.params[2]).toEqual(["vendor"]); // narrowed BEFORE the cap

    const list = h.calls.find((c) => /FROM vendors/.test(c.sql) && /ORDER BY/.test(c.sql));
    expect(list).toBeDefined();
    expect(list!.sql).toMatch(/id = ANY\(\$\d+::uuid\[\]\)/);
    expect(list!.params).toContainEqual([VENDOR_ID]);
  });

  it("zero matches → honest empty envelope, and the list query never runs", async () => {
    h.searchRows = [];

    const res = await request(makeApp()).get("/api/vendors?q=nomatch").set("X-Api-Key", "k");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ count: 0, vendors: [], nextCursor: null });
    expect(h.calls.some((c) => /FROM vendors/.test(c.sql))).toBe(false);
  });

  it("keeps the platform 2–120 bounds: 400 invalid_search outside them", async () => {
    for (const bad of ["a", "a".repeat(121)]) {
      const res = await request(makeApp()).get(`/api/vendors?q=${encodeURIComponent(bad)}`).set("X-Api-Key", "k");
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: "invalid_search" });
    }
    expect(h.calls).toHaveLength(0);
  });

  it("blank q is a no-op — the list runs unfiltered, no resolver query", async () => {
    const res = await request(makeApp()).get("/api/vendors?q=%20%20").set("X-Api-Key", "k");
    expect(res.status).toBe(200);
    expect(h.calls.some((c) => c.sql.includes("asset_search_index_v"))).toBe(false);
    expect(h.calls.some((c) => /FROM vendors/.test(c.sql))).toBe(true);
  });

  it("q composes with status and criticality — all three predicates on the list query", async () => {
    h.searchRows = [vendorMatch];

    const res = await request(makeApp())
      .get("/api/vendors?q=SrchSuite&status=active&criticality=high")
      .set("X-Api-Key", "k");
    expect(res.status).toBe(200);

    const list = h.calls.find((c) => /FROM vendors/.test(c.sql) && /ORDER BY/.test(c.sql));
    expect(list!.sql).toContain("status = $2");
    expect(list!.sql).toContain("criticality = $3");
    expect(list!.sql).toMatch(/id = ANY\(\$4::uuid\[\]\)/);
    expect(list!.params.slice(0, 4)).toEqual([ORG, "active", "high", [VENDOR_ID]]);
  });
});

describe("GET /api/vendors?reviewed= — never-reviewed filter", () => {
  beforeEach(() => {
    h.calls = [];
    h.searchRows = [];
  });

  it("reviewed=never adds the last_reviewed_at IS NULL predicate", async () => {
    const res = await request(makeApp()).get("/api/vendors?reviewed=never");
    expect(res.status).toBe(200);
    const list = h.calls.find((c) => /FROM vendors/.test(c.sql));
    expect(list).toBeDefined();
    expect(list!.sql).toContain("last_reviewed_at IS NULL");
  });

  it("composes with status and criticality", async () => {
    await request(makeApp()).get(
      "/api/vendors?reviewed=never&criticality=critical&status=active"
    );
    const list = h.calls.find((c) => /FROM vendors/.test(c.sql))!;
    expect(list.sql).toContain("last_reviewed_at IS NULL");
    expect(list.params).toContain("critical");
    expect(list.params).toContain("active");
  });

  it("rejects unknown reviewed values with the allowed list", async () => {
    const res = await request(makeApp()).get("/api/vendors?reviewed=recently");
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "invalid_reviewed_filter", allowed: ["never"] });
    expect(h.calls.some((c) => /FROM vendors/.test(c.sql))).toBe(false);
  });

  it("absent reviewed param leaves the list unfiltered on review recency", async () => {
    await request(makeApp()).get("/api/vendors");
    const list = h.calls.find((c) => /FROM vendors/.test(c.sql))!;
    expect(list.sql).not.toContain("last_reviewed_at IS NULL");
  });
});
