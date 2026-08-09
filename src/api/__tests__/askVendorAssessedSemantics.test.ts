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
  status: "active" | "archived";
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
      // The mock HONOURS the status predicate rather than trusting a string
      // assertion. If the filter is ever weakened, archived rows flow straight
      // through and the exclusion tests fail on the customer-visible VALUES —
      // which is the failure that actually matters.
      const rows = (h.vendorRows as VendorRow[]).filter((r) =>
        /status = 'active'/.test(sql) ? r.status === "active" : true
      );
      // The vendor LIST query — the one carrying assessment state.
      if (/FROM vendors/.test(sql) && /assessment_count/.test(sql)) {
        return { rows, rowCount: rows.length };
      }
      if (/FROM vendors/.test(sql) && /COUNT\(\*\) AS total/.test(sql)) {
        return { rows: [{ total: String(rows.length) }], rowCount: 1 };
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
// Ask is rate limited to 20 questions/minute per org, and this suite makes more
// calls than that. Stubbed so the limiter cannot decide the result of a
// semantics test: without it the suite passes only while it stays under 20
// cases, which is an accident waiting to be inherited by the next author.
vi.mock("express-rate-limit", () => ({
  default: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  ipKeyGenerator: (ip: string) => ip,
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
  active_total: number;
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
  status: "active",
  criticality: "high",
  current_risk_score: null,
  assessment_count: 0,
  latest_assessment_at: null,
  ...over,
});

const vendorListQuery = () =>
  h.calls.find((c) => /FROM vendors/.test(c.sql) && /assessment_count/.test(c.sql))!;
const vendorCountQuery = () =>
  h.calls.find((c) => /FROM vendors/.test(c.sql) && /COUNT\(\*\) AS total/.test(c.sql))!;

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

/**
 * The population itself.
 *
 * ask.ts filtered `status != 'inactive'` — a no-op, because vendors.status is
 * NOT NULL with CHECK (status IN ('active','archived')). The predicate was an
 * idiom borrowed from the USERS table, where member removal really does set
 * status = 'inactive'. On vendors it excluded nothing, so every Ask metric
 * silently included the archived half of the register while the code called it
 * "Active vendor count".
 *
 * The sharpest harm is not the arithmetic: archived vendors were NAMED to the
 * model in `list`, and the system prompt authorises it to use names present in
 * the org context. Ask could introduce a decommissioned third party as live
 * risk.
 */
describe("POST /api/ask — the vendor population is ACTIVE vendors only", () => {
  const mixed = () => [
    vendor({ id: "a", name: "Live Critical", status: "active",   criticality: "critical", assessment_count: 1 }),
    vendor({ id: "b", name: "Live High",     status: "active",   criticality: "high",     assessment_count: 0 }),
    vendor({ id: "c", name: "Retired Corp",  status: "archived", criticality: "critical", assessment_count: 1 }),
    vendor({ id: "d", name: "Sunset Ltd",    status: "archived", criticality: "high",     assessment_count: 0 }),
  ];

  it("excludes archived vendors from every metric", async () => {
    h.vendorRows = mixed();
    await ask();

    const v = vendorContext();
    // Including archived gives 4 / 2 / 2 / 2 / 2 — every number doubled.
    expect(v.active_total).toBe(2);
    expect(v).toMatchObject({
      critical_count: 1,
      high_count: 1,
      assessed_count: 1,
      never_assessed_count: 1,
    });
  });

  it("keeps active vendors included", async () => {
    h.vendorRows = mixed();
    await ask();

    const names = vendorContext().list.map((r) => r.name);
    expect(names).toContain("Live Critical");
    expect(names).toContain("Live High");
    expect(names).toHaveLength(2);
  });

  it("never names an archived vendor to the model", async () => {
    // The whole prompt, not just the vendor block: a decommissioned third
    // party must not appear anywhere the model can read and repeat it.
    h.vendorRows = mixed();
    await ask();

    expect(h.userMessage).not.toContain("Retired Corp");
    expect(h.userMessage).not.toContain("Sunset Ltd");
    expect(h.userMessage).toContain("Live Critical");
  });

  it("an all-archived org reports genuine zeros, not the archived population", async () => {
    h.vendorRows = [
      vendor({ id: "x", name: "Gone One", status: "archived", criticality: "critical", assessment_count: 2 }),
      vendor({ id: "y", name: "Gone Two", status: "archived", criticality: "high",     assessment_count: 0 }),
    ];
    const res = await ask();

    const v = vendorContext();
    expect(v.active_total).toBe(0);
    expect(v).toMatchObject({
      critical_count: 0, high_count: 0, assessed_count: 0, never_assessed_count: 0,
    });
    expect(v.list).toHaveLength(0);
    // A real zero, served normally — not an error and not a stale total.
    expect(res.status).toBe(200);
    expect(res.body.context_used.vendors_count).toBe(0);
  });

  it("applies the active predicate to BOTH vendor queries", async () => {
    await ask();
    for (const q of [vendorListQuery(), vendorCountQuery()]) {
      expect(q.sql).toContain("status = 'active'");
      expect(q.sql).not.toContain("'inactive'");
    }
  });

  it("keeps the count query and the list query on the SAME population", async () => {
    // The total and the breakdown must not be able to disagree.
    h.vendorRows = mixed();
    await ask();

    const v = vendorContext();
    expect(v.active_total).toBe(v.list.length);
    expect(v.assessed_count + v.never_assessed_count).toBe(v.active_total);
  });

  it("context_used.vendors_count follows the same active population", async () => {
    h.vendorRows = mixed();
    const res = await ask();
    // The key name is unchanged (typed public API field); its VALUE is the
    // correction.
    expect(res.body.context_used.vendors_count).toBe(2);
  });

  it("stays index-friendly: an equality predicate on (organization_id, status)", async () => {
    await ask();
    // idx_vendors_org_status is (organization_id, status). An equality match on
    // the second column uses it; the old negation could not.
    expect(vendorCountQuery().sql).toMatch(/organization_id = \$1\s+AND status = 'active'/);
    expect(vendorListQuery().sql).toMatch(/organization_id = \$1\s+AND status = 'active'/);
  });

  it("introduces no new row bound — the list stays unbounded as before", async () => {
    // The prompt-serialization concern is RECORDED, not addressed here. Pinned
    // so that adding a LIMIT later is a deliberate, visible change.
    await ask();
    expect(vendorListQuery().sql).not.toMatch(/LIMIT \$/);
  });
});

describe("POST /api/ask — active_total naming is used consistently", () => {
  it("the vendor block exposes active_total and no bare `total`", async () => {
    h.vendorRows = [vendor()];
    await ask();

    const keys = Object.keys(vendorContext() as Record<string, unknown>);
    expect(keys).toContain("active_total");
    // A key called `total` beside an active-only number would just relocate the
    // falsehood: the model would report it as the whole register.
    expect(keys).not.toContain("total");
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
  it("reads the ACTIVE vendor population on both queries", async () => {
    await ask();
    for (const q of [vendorListQuery(), vendorCountQuery()]) {
      expect(q.sql).toContain("status = 'active'");
      // The old predicate was a no-op borrowed from the users table.
      expect(q.sql).not.toContain("'inactive'");
    }
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
    expect(v.active_total).toBe(3);
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
