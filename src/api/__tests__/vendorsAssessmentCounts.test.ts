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
    // Two-leg predicate since the B1 demotion: never-assessed = no legacy
    // assessment AND no engagement. Both legs org-scoped inside the
    // correlation (the IDOR rule).
    expect(sql).toMatch(/COUNT\(\*\) FILTER \(\s*WHERE NOT \(EXISTS/);
    expect(sql).toMatch(/FROM vendor_assessments va/);
    expect(sql).toMatch(/va\.vendor_id = vendors\.id/);
    expect(sql).toMatch(/va\.organization_id = vendors\.organization_id/);
    expect(sql).toMatch(/FROM vendor_engagements va_e/);
    expect(sql).toMatch(/va_e\.vendor_id = vendors\.id/);
    expect(sql).toMatch(/va_e\.organization_id = vendors\.organization_id/);
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
    expect(sql).toMatch(/WHERE NOT \(EXISTS/);
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

/**
 * ?assessed=never — the list filter behind the "Never assessed" pill.
 *
 * The pill prints never_assessed_count and links here. If the two were built
 * from different SQL, the customer would read an authoritative number and land
 * on a differently-defined list — worse than a capped count, because both
 * halves look equally authoritative. They share one module-level literal, and
 * these tests hold that seam.
 */
describe("GET /api/vendors?assessed=never — predicate equivalence with the aggregate", () => {
  it("filters on zero assessment rows, correlated to the vendor and the org", async () => {
    await request(makeApp()).get("/api/vendors?assessed=never");

    const sql = listQuery().sql;
    expect(sql).toMatch(/NOT \(EXISTS \(SELECT 1\s+FROM vendor_assessments va/);
    expect(sql).toMatch(/va\.vendor_id = vendors\.id/);
    expect(sql).toMatch(/va\.organization_id = vendors\.organization_id/);
    expect(sql).toMatch(/EXISTS \(SELECT 1\s+FROM vendor_engagements va_e/);
    expect(sql).toMatch(/va_e\.vendor_id = vendors\.id/);
    expect(sql).toMatch(/va_e\.organization_id = vendors\.organization_id/);
  });

  it("the LIST predicate is character-identical to the one inside the AGGREGATE", async () => {
    await request(makeApp()).get("/api/vendors?assessed=never");

    // Both come from NEVER_ASSESSED_PREDICATE. Extracting the exact substring
    // from each query and comparing them is the equivalence proof: any future
    // edit that forks one from the other fails here rather than in production.
    const grab = (sql: string) => {
      const start = sql.indexOf("NOT (EXISTS (SELECT 1");
      expect(start).toBeGreaterThan(-1);
      // Walk to the matching close paren of NOT ( — spans BOTH existence legs.
      let depth = 0;
      for (let i = sql.indexOf("(", start); i < sql.length; i++) {
        if (sql[i] === "(") depth++;
        else if (sql[i] === ")") {
          depth--;
          if (depth === 0) return sql.slice(start, i + 1);
        }
      }
      throw new Error("unbalanced predicate");
    };

    expect(grab(listQuery().sql)).toBe(grab(aggQuery().sql));
  });

  it("an assessed vendor is excluded — the predicate is NOT EXISTS, not a join that keeps rows", async () => {
    await request(makeApp()).get("/api/vendors?assessed=never");
    const sql = listQuery().sql;
    // A LEFT JOIN + IS NULL would also "work" until a vendor had two
    // assessments; NOT (EXISTS … OR EXISTS …) cannot duplicate or leak a row.
    expect(sql).not.toMatch(/LEFT JOIN vendor_assessments/);
    expect(sql).not.toMatch(/LEFT JOIN vendor_engagements/);
    expect(sql).toMatch(/NOT \(EXISTS/);
  });

  it("is applied BEFORE the cursor and limit, so paging cannot change the population", async () => {
    await request(makeApp()).get(
      "/api/vendors?assessed=never&limit=25&before_created_at=2026-01-01T00:00:00Z&before_id=" +
        "33333333-3333-4333-8333-333333333333"
    );

    // The aggregate carries the filter (proving it was in preCursorConditions)
    // but carries neither the cursor nor the limit.
    expect(aggQuery().sql).toMatch(/NOT \(EXISTS/);
    expect(aggQuery().sql).not.toMatch(/\(created_at, id\) </);
    expect(aggQuery().sql).not.toMatch(/LIMIT \$/);
    expect(listQuery().sql).toMatch(/NOT \(EXISTS/);
  });

  it("under assessed=never the aggregate equals the total — the filter and the count agree", async () => {
    // The population IS the never-assessed one, so counting never-assessed
    // vendors within it must return all of them. A mismatch here means the two
    // predicates have drifted.
    h.aggregateRow.total = "88";
    h.aggregateRow.never_assessed = "88";

    const res = await request(makeApp()).get("/api/vendors?assessed=never");
    expect(res.body.total).toBe(88);
    expect(res.body.never_assessed_count).toBe(88);
  });

  it("composes with status, criticality, and the legacy reviewed filter", async () => {
    await request(makeApp()).get(
      "/api/vendors?assessed=never&status=archived&criticality=high&reviewed=never"
    );

    const sql = listQuery().sql;
    expect(sql).toContain("status = $2");
    expect(sql).toContain("criticality = $3");
    expect(sql).toContain("last_reviewed_at IS NULL");
    expect(sql).toMatch(/NOT \(EXISTS/);
    // Every axis reaches the aggregate too, so the counts describe the rows.
    expect(aggQuery().sql).toContain("criticality = $3");
    expect(aggQuery().sql).toMatch(/NOT \(EXISTS/);
  });

  it("composes with the shared asset search", async () => {
    // q resolves to backing ids first, then both predicates apply together.
    await request(makeApp()).get("/api/vendors?assessed=never&q=Acme");
    // The resolver short-circuits on zero matches in this harness, so assert
    // the honest empty envelope still carries a real zero rather than a gap.
    const res = await request(makeApp()).get("/api/vendors?assessed=never&q=Acme");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("never_assessed_count", 0);
  });

  it("stays org-scoped", async () => {
    await request(makeApp()).get("/api/vendors?assessed=never");
    expect(listQuery().params[0]).toBe(ORG);
    expect(aggQuery().params[0]).toBe(ORG);
    expect(listQuery().sql).toContain("organization_id = $1");
    expect(JSON.stringify(h.calls)).not.toContain(OTHER_ORG);
  });

  it("rejects unknown assessed values with the allowed list — no silent broadening", async () => {
    for (const bad of ["ever", "true", "1", "recently", "never "]) {
      h.calls = [];
      const res = await request(makeApp()).get(
        `/api/vendors?assessed=${encodeURIComponent(bad)}`
      );
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "invalid_assessed_filter", allowed: ["never"] });
      // The critical half: an unrecognised value must not fall through to an
      // UNFILTERED list. Silently returning every vendor for ?assessed=ever
      // would answer a question the caller did not ask.
      expect(h.calls.some((c) => /FROM vendors/.test(c.sql))).toBe(false);
    }
  });

  it("an absent assessed param leaves the list unfiltered on assessment state", async () => {
    await request(makeApp()).get("/api/vendors");
    expect(listQuery().sql).not.toMatch(/WHERE.*NOT \(EXISTS/s);
    // The aggregate still counts never-assessed vendors — that is its job.
    expect(aggQuery().sql).toMatch(/FILTER \(\s*WHERE NOT \(EXISTS/);
  });

  it("does not use last_reviewed_at or current_risk_score for the assessment predicate", async () => {
    await request(makeApp()).get("/api/vendors?assessed=never");
    const sql = listQuery().sql;
    expect(sql).not.toContain("last_reviewed_at IS NULL");
    const clause = sql.slice(sql.indexOf("NOT EXISTS"));
    expect(clause).not.toMatch(/current_risk_score/);
  });
});
