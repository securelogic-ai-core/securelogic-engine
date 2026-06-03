/**
 * risksSerializationOrder.test.ts — A04-G1 PR γ.1 §4.2 unit guards.
 *
 * The wrap routes GET /risks/summary (was a 6-query Promise.all) and
 * GET /risks/:id/history (was two eager `pg.query(...)` promises awaited via
 * Promise.all) onto the SINGLE per-request tenant client, which node-postgres
 * cannot drive with concurrent in-flight queries. γ.1 §2.1 serialized both into
 * sequential awaits. These tests PIN that serialization so a future refactor
 * back to Promise.all (or to eager promise variables) is caught in CI rather
 * than re-introducing the single-client concurrency hazard (which warns under
 * pg 8.x and THROWS under pg@9).
 *
 * Mechanism: mock the postgres infra so `pg.query` records call order and the
 * number of concurrently in-flight queries, and `withTenant` runs the handler
 * inline (so the REAL asTenant + deferredResponse path executes without a DB).
 * Each mocked query yields a macrotask before resolving, so a hypothetical
 * Promise.all would overlap and push maxConcurrent above 1 — the discriminating
 * signal. The auth/entitlement middleware is bypassed and an org context is
 * injected so the wrapped handler runs.
 *
 * These are STRUCTURAL assertions (call ordering + concurrency) and a response-
 * shape equivalence check — NOT latency assertions (design §4.2).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const ORG = "11111111-1111-4111-8111-111111111111";
const RISK = "22222222-2222-4222-8222-222222222222";

// Shared, hoisted tracking state (vi.mock factories are hoisted above imports,
// so the state they reference must be created via vi.hoisted, not a plain let).
const h = vi.hoisted(() => ({
  state: {
    inFlight: 0,
    maxConcurrent: 0,
    order: [] as string[],
    resolver: (_sql: string) => ({ rows: [] as unknown[], rowCount: 0 }),
  },
}));

vi.mock("../infra/postgres.js", () => ({
  pg: {
    query: vi.fn(async (sql: string) => {
      const s = h.state;
      s.inFlight += 1;
      s.maxConcurrent = Math.max(s.maxConcurrent, s.inFlight);
      s.order.push(sql);
      // Yield a macrotask: if the route ran these concurrently (Promise.all or
      // eager promises) two would be in flight here and maxConcurrent would rise.
      await new Promise((r) => setTimeout(r, 5));
      const result = s.resolver(sql);
      s.inFlight -= 1;
      return result;
    }),
    connect: vi.fn(),
  },
  // Pass-through tenant scope: run the handler inline so the real asTenant +
  // deferredResponse commit-before-respond path executes with no database.
  withTenant: vi.fn(async (_org: string, cb: () => Promise<unknown>) => cb()),
  pgElevated: { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) },
}));

vi.mock("../middleware/requireApiKey.js", () => ({
  requireApiKey: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../middleware/attachOrganizationContext.js", () => ({
  attachOrganizationContext: (
    req: { organizationContext?: unknown },
    _res: unknown,
    next: () => void,
  ) => {
    req.organizationContext = { organizationId: ORG };
    next();
  },
}));
vi.mock("../middleware/requireEntitlement.js", () => ({
  requireEntitlement:
    () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

// Import AFTER the mocks are registered.
import risksRouter from "../routes/risks.js";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", risksRouter);
  return app;
}

beforeEach(() => {
  h.state.inFlight = 0;
  h.state.maxConcurrent = 0;
  h.state.order = [];
});

// ---------------------------------------------------------------------------
// summary
// ---------------------------------------------------------------------------

function summaryResolver(sql: string): { rows: unknown[]; rowCount: number } {
  if (/GROUP BY status/.test(sql)) {
    return { rows: [{ status: "open", count: "3" }, { status: "closed", count: "1" }], rowCount: 2 };
  }
  if (/GROUP BY risk_rating/.test(sql)) {
    return { rows: [{ risk_rating: "High", count: "2" }], rowCount: 1 };
  }
  if (/GROUP BY domain/.test(sql)) {
    return { rows: [{ domain: "Vendor Risk", count: "4" }], rowCount: 1 };
  }
  if (/GROUP BY inherent_rating/.test(sql)) {
    return { rows: [{ inherent_rating: "High", count: "2" }], rowCount: 1 };
  }
  if (/GROUP BY residual_rating/.test(sql)) {
    return { rows: [{ residual_rating: "Critical", count: "1" }], rowCount: 1 };
  }
  if (/next_review_due < CURRENT_DATE/.test(sql)) {
    return { rows: [{ count: "5" }], rowCount: 1 };
  }
  return { rows: [], rowCount: 0 };
}

describe("GET /api/risks/summary — serialization order guard (§4.2)", () => {
  it("issues all six aggregates sequentially — one query in flight at a time", async () => {
    h.state.resolver = summaryResolver;
    const res = await request(makeApp()).get("/api/risks/summary").set("X-Api-Key", "k");

    expect(res.status).toBe(200);
    expect(h.state.order.length).toBe(6);
    // The property that removes the DeprecationWarning / pg@9 throw: never more
    // than one in-flight query on the single tenant client. A Promise.all would
    // make this 6.
    expect(h.state.maxConcurrent).toBe(1);
    // Exact documented order (status, rating, domain, inherent, residual, overdue).
    expect(h.state.order[0]).toMatch(/GROUP BY status/);
    expect(h.state.order[1]).toMatch(/GROUP BY risk_rating/);
    expect(h.state.order[2]).toMatch(/GROUP BY domain/);
    expect(h.state.order[3]).toMatch(/GROUP BY inherent_rating/);
    expect(h.state.order[4]).toMatch(/GROUP BY residual_rating/);
    expect(h.state.order[5]).toMatch(/next_review_due < CURRENT_DATE/);
  });

  it("binds the six results to the correct summary fields (response shape pinned)", async () => {
    h.state.resolver = summaryResolver;
    const res = await request(makeApp()).get("/api/risks/summary").set("X-Api-Key", "k");

    // Equivalence guard: a binding swap or query-text drift during a future
    // refactor would change this body.
    expect(res.body).toEqual({
      total: 4,
      open_critical_count: 1,
      by_status: { open: 3, accepted: 0, mitigated: 0, closed: 1, transferred: 0 },
      by_risk_rating: { Critical: 0, High: 2, Moderate: 0, Low: 0 },
      by_inherent_rating: { Critical: 0, High: 2, Moderate: 0, Low: 0 },
      by_residual_rating: { Critical: 1, High: 0, Moderate: 0, Low: 0 },
      by_domain: { "Vendor Risk": 4 },
      overdue_review_count: 5,
    });
  });
});

// ---------------------------------------------------------------------------
// history
// ---------------------------------------------------------------------------

function historyResolver(sql: string): { rows: unknown[]; rowCount: number } {
  if (/SELECT 1 FROM risks/.test(sql)) {
    return { rows: [{ "?column?": 1 }], rowCount: 1 }; // ownership pre-check
  }
  if (/COUNT\(\*\)::text AS total/.test(sql)) {
    return { rows: [{ total: "7" }], rowCount: 1 }; // count query
  }
  if (/FROM security_audit_log/.test(sql)) {
    return { rows: [{ id: "e1", event_type: "risk.created" }], rowCount: 1 }; // events query
  }
  return { rows: [], rowCount: 0 };
}

describe("GET /api/risks/:id/history — serialization order guard (§4.2)", () => {
  it("settles the events query before the count query — neither is an eager promise", async () => {
    h.state.resolver = historyResolver;
    const res = await request(makeApp())
      .get(`/api/risks/${RISK}/history`)
      .set("X-Api-Key", "k");

    expect(res.status).toBe(200);
    // ownership SELECT 1, then events, then count = 3 queries, never overlapping.
    // Eager `eventsPromise`/`countPromise` would put events+count in flight
    // together → maxConcurrent 2. This pins the §2.1(ii) eager-promise removal.
    expect(h.state.order.length).toBe(3);
    expect(h.state.maxConcurrent).toBe(1);
    expect(h.state.order[0]).toMatch(/SELECT 1 FROM risks/);
    expect(h.state.order[1]).toMatch(/LIMIT \$3 OFFSET \$4/); // events query
    expect(h.state.order[2]).toMatch(/COUNT\(\*\)::text AS total/); // count query
  });

  it("binds events/count to the response shape (equivalence guard)", async () => {
    h.state.resolver = historyResolver;
    const res = await request(makeApp())
      .get(`/api/risks/${RISK}/history`)
      .set("X-Api-Key", "k");

    expect(res.body).toEqual({
      events: [{ id: "e1", event_type: "risk.created" }],
      total_count: 7,
      limit: 20,
      offset: 0,
    });
  });
});
