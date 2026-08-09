/**
 * askVendorAssessedSemantics.test.ts — POST /api/ask answers "assessed" with
 * the ratified definition, and stops handing the model a field nothing writes.
 *
 * Two defects lived in one block of ask.ts:
 *
 *   1. `assessed_count` counted `current_risk_score !== null` — a SCORE, not an
 *      assessment. GET /api/vendors/:id/risk-score computes and persists a
 *      score on demand, so a vendor nobody had ever assessed acquired one and
 *      began counting as assessed. Meanwhile a genuinely assessed vendor whose
 *      score had never been computed counted as UNassessed. Both directions
 *      wrong, and the model reported the result as assessment coverage.
 *
 *   2. `last_reviewed_at` was selected and passed to the model as
 *      `last_reviewed`. Per the 2026-08-09 ruling nothing in the product writes
 *      that column, so it was NULL for effectively every vendor and the model
 *      was free to narrate "never reviewed" across the entire register.
 *
 * (2) is the more dangerous of the two and the reason this route needed its own
 * increment: every other consumer renders the field through code you can grep
 * and assert on. Here an LLM turns it into prose, phrased differently each
 * time, so there is no string to search for and no rendering test that fails.
 * The only durable fix is to stop putting the value in the context at all —
 * which is what these tests hold.
 *
 * The model may summarize verified product facts. It must not be handed an
 * unmaintained field or a proxy metric to make a confident claim from.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "99999999-9999-4999-8999-999999999999";

type VendorRow = {
  id: string;
  name: string;
  criticality: string | null;
  current_risk_score: number | null;
  assessment_count: number;
  latest_assessment_at: string | null;
};

const h = vi.hoisted(() => ({
  calls: [] as Array<{ sql: string; params: unknown[] }>,
  vendorRows: [] as unknown[],
  /** Whatever the model was actually shown. */
  userMessage: "" as string,
}));

vi.mock("../infra/postgres.js", () => ({
  pg: {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      h.calls.push({ sql, params });
      // The vendor LIST query — the one carrying assessment state.
      if (/FROM vendors/.test(sql) && /assessment_count/.test(sql)) {
        return { rows: h.vendorRows, rowCount: h.vendorRows.length };
      }
      if (/FROM vendors/.test(sql) && /COUNT\(\*\) AS total/.test(sql)) {
        return { rows: [{ total: String(h.vendorRows.length) }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }),
    connect: vi.fn(),
  },
  withTenant: vi.fn(async (_org: string, cb: () => Promise<unknown>) => cb()),
  pgElevated: { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) },
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = {
      create: vi.fn(async (opts: { messages: Array<{ content: string }> }) => {
        h.userMessage = opts.messages[0]?.content ?? "";
        return { content: [{ type: "text", text: "answer" }] };
      }),
    };
  },
}));
vi.mock("../infra/providerQuotaAlert.js", () => ({
  instrumentAnthropicClient: (c: unknown) => c,
}));
vi.mock("../middleware/requireApiKey.js", () => ({
  requireApiKey: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../middleware/attachOrganizationContext.js", () => ({
  attachOrganizationContext: (req: { organizationContext?: unknown }, _res: unknown, next: () => void) => {
    req.organizationContext = { organizationId: ORG };
    next();
  },
}));
vi.mock("../middleware/requireEntitlement.js", () => ({
  requireEntitlement: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import askRouter from "../routes/ask.js";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", askRouter);
  return app;
}

const ask = () =>
  request(makeApp()).post("/api/ask").send({ question: "Which vendors are unassessed?" });

/** The vendor block of the JSON context the model was shown. */
function vendorContext(): {
  total: number;
  assessed_count: number;
  never_assessed_count: number;
  list: Array<Record<string, unknown>>;
} {
  const start = h.userMessage.indexOf("{");
  const end = h.userMessage.lastIndexOf("}");
  const parsed = JSON.parse(h.userMessage.slice(start, end + 1));
  return parsed.vendors;
}

const vendor = (over: Partial<VendorRow> = {}): VendorRow => ({
  id: "v-1",
  name: "Acme Cloud",
  criticality: "high",
  current_risk_score: null,
  assessment_count: 0,
  latest_assessment_at: null,
  ...over,
});

const vendorListQuery = () =>
  h.calls.find((c) => /FROM vendors/.test(c.sql) && /assessment_count/.test(c.sql))!;

beforeEach(() => {
  vi.clearAllMocks();
  h.calls = [];
  h.vendorRows = [];
  h.userMessage = "";
  process.env.ANTHROPIC_API_KEY = "test-key";
});

// ─────────────────────────────────────────────────────────────

describe("POST /api/ask — assessed_count uses assessment EXISTENCE", () => {
  it("counts a vendor with an assessment row but NO risk score as assessed", async () => {
    // The old predicate called this vendor unassessed. It has been assessed;
    // nobody has run the score pipeline over it yet. A customer asking "how
    // many vendors have we assessed?" was told a number that undercounted
    // their actual completed work.
    h.vendorRows = [vendor({ assessment_count: 2, current_risk_score: null })];

    await ask();

    expect(vendorContext().assessed_count).toBe(1);
    expect(vendorContext().never_assessed_count).toBe(0);
  });

  it("does NOT count a vendor with a risk score but no assessment row", async () => {
    // The inverse, and the one that overstated coverage: GET
    // /api/vendors/:id/risk-score persists a score on demand, so merely
    // viewing a vendor could make it look assessed.
    h.vendorRows = [vendor({ assessment_count: 0, current_risk_score: 72 })];

    await ask();

    expect(vendorContext().assessed_count).toBe(0);
    expect(vendorContext().never_assessed_count).toBe(1);
  });

  it("splits a mixed register on the assessment axis, not the score axis", async () => {
    h.vendorRows = [
      vendor({ id: "a", assessment_count: 1, current_risk_score: null }),   // assessed
      vendor({ id: "b", assessment_count: 3, current_risk_score: 40 }),     // assessed
      vendor({ id: "c", assessment_count: 0, current_risk_score: 90 }),     // NOT
      vendor({ id: "d", assessment_count: 0, current_risk_score: null }),   // NOT
    ];

    await ask();

    // Scoring the old way gives 2 (b, c) — a different set of the same size,
    // which is how this survived: the number looked plausible.
    expect(vendorContext().assessed_count).toBe(2);
    expect(vendorContext().never_assessed_count).toBe(2);
  });

  it("derives assessment state in SQL, from the ratified predicate", async () => {
    await ask();

    const sql = vendorListQuery().sql;
    expect(sql).toMatch(/FROM vendor_assessments va/);
    expect(sql).toMatch(/va\.vendor_id = vendors\.id/);
    // Tenant scoping inside the correlation, not just on the outer query.
    expect(sql).toMatch(/va\.organization_id = vendors\.organization_id/);
    // No status/type/recency qualifier — the ratified definition implies none.
    const scope = sql.slice(sql.indexOf("FROM vendor_assessments va"));
    expect(scope).not.toMatch(/va\.status/);
    expect(scope).not.toMatch(/va\.assessment_type/);
  });

  it("never uses current_risk_score as the assessment predicate", async () => {
    h.vendorRows = [vendor({ assessment_count: 0, current_risk_score: 99 })];
    await ask();

    // The score is still SELECTed — it is a real, maintained field — but it
    // must not be what decides assessed/unassessed.
    expect(vendorListQuery().sql).toContain("current_risk_score");
    expect(vendorContext().assessed_count).toBe(0);
  });
});

describe("POST /api/ask — last_reviewed_at reaches neither the query nor the model", () => {
  it("is not selected at all", async () => {
    await ask();
    expect(vendorListQuery().sql).not.toContain("last_reviewed_at");
  });

  it("is absent from the context the model is shown", async () => {
    h.vendorRows = [vendor({ assessment_count: 1, latest_assessment_at: "2026-05-01" })];
    await ask();

    // The whole prompt, not just the vendor block: the field must not survive
    // anywhere the model can read it.
    expect(h.userMessage).not.toContain("last_reviewed");
    expect(h.userMessage).not.toContain("last_reviewed_at");
  });

  it("gives the model no 'reviewed' vocabulary to build an unsupported claim from", async () => {
    h.vendorRows = [
      vendor({ id: "a", assessment_count: 0 }),
      vendor({ id: "b", assessment_count: 5, latest_assessment_at: "2026-05-01" }),
    ];
    await ask();

    const keys = Object.keys(vendorContext().list[0]!);
    expect(keys).not.toContain("last_reviewed");
    expect(keys.some((k) => /review/i.test(k))).toBe(false);
  });

  it("replaces it with a supported field: the date of a real assessment row", async () => {
    h.vendorRows = [
      vendor({ assessment_count: 4, latest_assessment_at: "2026-05-01T00:00:00.000Z" }),
    ];
    await ask();

    const [row] = vendorContext().list;
    expect(row).toMatchObject({
      assessments: 4,
      last_assessed: "2026-05-01T00:00:00.000Z",
    });
    // performed_at of a genuine vendor_assessments row, ordered the way every
    // other surface orders it.
    expect(vendorListQuery().sql).toMatch(/va\.performed_at/);
    expect(vendorListQuery().sql).toMatch(/ORDER BY va\.created_at DESC, va\.id DESC/);
  });

  it("an unassessed vendor carries an honest null date, not a fabricated one", async () => {
    h.vendorRows = [vendor({ assessment_count: 0, latest_assessment_at: null })];
    await ask();

    expect(vendorContext().list[0]).toMatchObject({
      assessments: 0,
      last_assessed: null,
    });
  });
});

describe("POST /api/ask — tenant isolation", () => {
  it("scopes the vendor read to the caller's org and no other", async () => {
    await ask();

    expect(vendorListQuery().params[0]).toBe(ORG);
    expect(vendorListQuery().sql).toContain("organization_id = $1");
    expect(JSON.stringify(h.calls)).not.toContain(OTHER_ORG);
  });

  it("keeps the org predicate on the assessment subquery, not just the outer query", async () => {
    await ask();
    // A correlated subquery without its own org predicate could count another
    // tenant's assessment rows against this tenant's vendor.
    expect(vendorListQuery().sql).toMatch(/va\.organization_id = vendors\.organization_id/);
  });
});

describe("POST /api/ask — unrelated behaviour is unchanged", () => {
  it("still reads the same vendor population (status <> 'inactive'), unchanged", async () => {
    await ask();
    // Deliberately NOT redefined by this increment: correcting the assessment
    // predicate must not quietly change WHICH vendors are in scope.
    expect(vendorListQuery().sql).toContain("status != 'inactive'");
  });

  it("still orders by criticality then risk score", async () => {
    await ask();
    expect(vendorListQuery().sql).toMatch(/WHEN 'critical' THEN 1/);
    expect(vendorListQuery().sql).toMatch(/current_risk_score DESC NULLS LAST/);
  });

  it("still reports vendor totals and the criticality split", async () => {
    h.vendorRows = [
      vendor({ id: "a", criticality: "critical" }),
      vendor({ id: "b", criticality: "high" }),
      vendor({ id: "c", criticality: "low" }),
    ];
    await ask();

    const v = vendorContext();
    expect(v.total).toBe(3);
    expect(v).toMatchObject({ critical_count: 1, high_count: 1 });
  });

  it("still returns an answer and the customer-visible context_used block", async () => {
    h.vendorRows = [vendor()];
    const res = await ask();

    expect(res.status).toBe(200);
    expect(res.body.answer).toBe("answer");
    expect(res.body.context_used).toMatchObject({ vendors_count: 1 });
    expect(res.body.question).toBe("Which vendors are unassessed?");
  });

  it("still keeps the risk score in the context — a maintained field is not collateral", async () => {
    h.vendorRows = [vendor({ current_risk_score: 61, assessment_count: 1 })];
    await ask();
    expect(vendorContext().list[0]).toMatchObject({ risk_score: 61 });
  });
});
