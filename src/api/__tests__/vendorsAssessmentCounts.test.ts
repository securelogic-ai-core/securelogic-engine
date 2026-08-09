/**
 * vendorsAssessmentCounts.test.ts — GET /api/vendors answers
 * "has this vendor ever been assessed?" in SQL, over the whole table.
 *
 * The app used to answer it by fetching the ORG's assessments with limit:100
 * and checking whether the vendor appeared in that page. That is an org-wide
 * cap answering a per-vendor question: past 100 assessments an assessed vendor
 * dropped out of the page and /vendors/risk rendered it "Never assessed", drew
 * it a red border, and pushed it into Requires Attention. Absence from a capped
 * page is not absence from the table.
 *
 * PRODUCT RULING these tests hold the line on: "assessed" means AT LEAST ONE
 * ROW in vendor_assessments for that vendor in that org. Un-capping the number
 * must not redefine the metric — in particular `last_reviewed_at` (a different,
 * effectively unmaintained field, already used by the ?reviewed=never filter)
 * must NOT appear anywhere in this predicate.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "99999999-9999-4999-8999-999999999999";

const h = vi.hoisted(() => ({
  calls: [] as Array<{ sql: string; params: unknown[] }>,
  aggregateRow: {
    total: "0",
    critical: "0",
    high: "0",
    medium: "0",
    low: "0",
    uncategorized: "0",
    never_assessed: "0"
  } as Record<string, string>,
  listRows: [] as unknown[]
}));

vi.mock("../infra/postgres.js", () => ({
  pg: {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      h.calls.push({ sql, params });
      if (sql.includes("asset_search_index_v") || sql.includes("FROM asset_registry_v")) {
        return { rows: [], rowCount: 0 };
      }
      // The aggregate query is the one that COUNTs without an ORDER BY.
      if (/FROM vendors/.test(sql) && /AS never_assessed/.test(sql)) {
        return { rows: [h.aggregateRow], rowCount: 1 };
      }
      if (/FROM vendors/.test(sql)) {
        return { rows: h.listRows, rowCount: h.listRows.length };
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

/** The SELECT that returns the rows (has an ORDER BY / LIMIT). */
const listQuery = () =>
  h.calls.find((c) => /FROM vendors/.test(c.sql) && /ORDER BY/.test(c.sql))!;
/** The SELECT that returns the aggregates. */
const aggQuery = () =>
  h.calls.find((c) => /FROM vendors/.test(c.sql) && /AS never_assessed/.test(c.sql))!;

beforeEach(() => {
  h.calls = [];
  h.listRows = [];
  h.aggregateRow = {
    total: "0", critical: "0", high: "0", medium: "0", low: "0",
    uncategorized: "0", never_assessed: "0"
  };
});

describe("GET /api/vendors — per-vendor assessment state comes from the database", () => {
  it("selects an exact assessment_count per vendor, scoped to the vendor AND the org", async () => {
    await request(makeApp()).get("/api/vendors");

    const sql = listQuery().sql;
    expect(sql).toMatch(/AS assessment_count/);
    // Correlated to the vendor row, not to a fetched page of assessments.
    expect(sql).toMatch(/va\.vendor_id = vendors\.id/);
    // Tenant isolation is IN the predicate, not merely in the outer WHERE.
    expect(sql).toMatch(/va\.organization_id = vendors\.organization_id/);
    expect(sql).toMatch(/FROM vendor_assessments va/);
  });

  it("counts ANY assessment row — no status, type, or recency qualifier is added", async () => {
    await request(makeApp()).get("/api/vendors");

    // Isolate the assessment subqueries and prove nothing narrows them. The app
    // definition being preserved counts every row GET /api/vendor-assessments
    // would have returned, and that route applies no such filter either.
    const sql = listQuery().sql;
    const assessmentClause = sql.slice(sql.indexOf("FROM vendor_assessments va"));
    expect(assessmentClause).not.toMatch(/va\.status/);
    expect(assessmentClause).not.toMatch(/va\.assessment_type/);
    expect(assessmentClause).not.toMatch(/va\.overall_severity/);
  });

  it("NEVER substitutes last_reviewed_at for the assessment predicate", async () => {
    await request(makeApp()).get("/api/vendors");

    // The ruling: reviewed=never (last_reviewed_at IS NULL) is a DIFFERENT
    // metric. Without ?reviewed it must not appear on either query.
    expect(listQuery().sql).not.toContain("last_reviewed_at IS NULL");
    expect(aggQuery().sql).not.toContain("last_reviewed_at IS NULL");
  });

  it("returns the latest assessment date, ordered the way the capped lookup was", async () => {
    await request(makeApp()).get("/api/vendors");

    const sql = listQuery().sql;
    expect(sql).toMatch(/AS latest_assessment_at/);
    // created_at DESC, id DESC reproduces "first match in the assessments list"
    // exactly, so un-capping the date does not change which row it names.
    expect(sql).toMatch(/ORDER BY va\.created_at DESC, va\.id DESC/);
    expect(sql).toMatch(/va\.performed_at/);
  });

  it("passes the per-vendor counts straight through to the caller", async () => {
    h.listRows = [
      { id: "v-1", created_at: "2026-01-01", assessment_count: 7, latest_assessment_at: "2026-05-01" },
      { id: "v-2", created_at: "2026-01-02", assessment_count: 0, latest_assessment_at: null }
    ];

    const res = await request(makeApp()).get("/api/vendors");
    expect(res.status).toBe(200);
    expect(res.body.vendors[0]).toMatchObject({ assessment_count: 7, latest_assessment_at: "2026-05-01" });
    expect(res.body.vendors[1]).toMatchObject({ assessment_count: 0, latest_assessment_at: null });
  });
});

describe("GET /api/vendors — never_assessed_count is exact over the whole population", () => {
  it("counts vendors with NO assessment row, using the same predicate as the rows", async () => {
    await request(makeApp()).get("/api/vendors");

    const sql = aggQuery().sql;
    expect(sql).toMatch(/COUNT\(\*\) FILTER \(\s*WHERE NOT EXISTS/);
    expect(sql).toMatch(/FROM vendor_assessments va/);
    expect(sql).toMatch(/va\.vendor_id = vendors\.id/);
    expect(sql).toMatch(/va\.organization_id = vendors\.organization_id/);
  });

  it("is computed over the filter set WITHOUT the cursor or the limit", async () => {
    await request(makeApp()).get(
      "/api/vendors?limit=25&before_created_at=2026-01-01T00:00:00Z&before_id=" +
        "33333333-3333-4333-8333-333333333333"
    );

    // The list pages; the aggregate must not. Paging is what made every one of
    // these numbers wrong in the first place.
    expect(listQuery().sql).toMatch(/\(created_at, id\) </);
    expect(listQuery().sql).toMatch(/LIMIT \$/);
    expect(aggQuery().sql).not.toMatch(/\(created_at, id\) </);
    expect(aggQuery().sql).not.toMatch(/LIMIT \$/);
  });

  it("pagination does not change the aggregate — same value on page 1 and page 2", async () => {
    h.aggregateRow.never_assessed = "137";
    h.aggregateRow.total = "340";

    const first = await request(makeApp()).get("/api/vendors?limit=100");
    h.calls = [];
    const second = await request(makeApp()).get(
      "/api/vendors?limit=100&before_created_at=2026-01-01T00:00:00Z&before_id=" +
        "33333333-3333-4333-8333-333333333333"
    );

    expect(first.body.never_assessed_count).toBe(137);
    expect(second.body.never_assessed_count).toBe(137);
    expect(first.body.total).toBe(340);
    expect(second.body.total).toBe(340);
  });

  it("stays org-scoped: the org predicate is the FIRST bound parameter on both queries", async () => {
    await request(makeApp()).get("/api/vendors");

    expect(listQuery().params[0]).toBe(ORG);
    expect(aggQuery().params[0]).toBe(ORG);
    expect(listQuery().sql).toContain("organization_id = $1");
    expect(aggQuery().sql).toContain("organization_id = $1");
    // And nothing leaks another tenant's id into either.
    expect(JSON.stringify(h.calls)).not.toContain(OTHER_ORG);
  });

  it("composes with the status and criticality filters — the tile matches its own filter set", async () => {
    await request(makeApp()).get("/api/vendors?status=archived&criticality=critical");

    const sql = aggQuery().sql;
    expect(sql).toContain("status = $2");
    expect(sql).toContain("criticality = $3");
    expect(aggQuery().params.slice(0, 3)).toEqual([ORG, "archived", "critical"]);
    expect(sql).toMatch(/WHERE NOT EXISTS/);
  });

  it("parses the aggregate as a number, not the string COUNT(*) returns", async () => {
    h.aggregateRow.never_assessed = "42";

    const res = await request(makeApp()).get("/api/vendors");
    expect(res.body.never_assessed_count).toBe(42);
    expect(typeof res.body.never_assessed_count).toBe("number");
  });

  it("a search that matches nothing returns a real zero, not an absent key", async () => {
    const res = await request(makeApp()).get("/api/vendors?q=nomatch");

    expect(res.status).toBe(200);
    // `undefined` reaches an honest caller as "unknown" and renders as a dash.
    // An empty search result is not unknown — it is zero, and must be shaped
    // exactly like a non-zero answer.
    expect(res.body).toHaveProperty("never_assessed_count", 0);
    expect(res.body.total).toBe(0);
  });
});
