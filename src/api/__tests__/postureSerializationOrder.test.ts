/**
 * postureSerializationOrder.test.ts — A04-G1 PR γ.2 §4.2 unit guards.
 *
 * The wrap routes GET /posture/compliance-summary (was a 2-query Promise.all of
 * obligations + obligation_assessments) onto the SINGLE per-request tenant
 * client, which node-postgres cannot drive with concurrent in-flight queries.
 * γ.2 §2.1 serialized it into two sequential awaits. These tests PIN that
 * serialization so a future refactor back to Promise.all (or to eager promise
 * variables) is caught in CI rather than re-introducing the single-client
 * concurrency hazard (which warns under pg 8.x and THROWS under pg@9).
 *
 * Mechanism: identical to risksSerializationOrder.test.ts. Mock the postgres
 * infra so `pg.query` records call order and the number of concurrently
 * in-flight queries, and `withTenant` runs the handler inline (so the REAL
 * asTenant + deferredResponse path executes without a DB). Each mocked query
 * yields a macrotask before resolving, so a hypothetical Promise.all would
 * overlap and push maxConcurrent above 1 — the discriminating signal. The
 * auth/entitlement middleware is bypassed and an org context is injected so the
 * wrapped handler runs.
 *
 * These are STRUCTURAL assertions (call ordering + concurrency) and a response-
 * shape equivalence check — NOT latency assertions (design §4.2).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const ORG = "11111111-1111-4111-8111-111111111111";

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
import postureRouter from "../routes/posture.js";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", postureRouter);
  return app;
}

beforeEach(() => {
  h.state.inFlight = 0;
  h.state.maxConcurrent = 0;
  h.state.order = [];
});

// ---------------------------------------------------------------------------
// compliance-summary
// ---------------------------------------------------------------------------

function complianceResolver(sql: string): { rows: unknown[]; rowCount: number } {
  // obligation_assessments must be matched first — "FROM obligations" is NOT a
  // substring of "FROM obligation_assessments", but check the longer name first
  // for clarity.
  if (/FROM obligation_assessments/.test(sql)) {
    return {
      rows: [
        { status: "compliant", count: "2" },
        { status: "non_compliant", count: "1" },
      ],
      rowCount: 2,
    };
  }
  if (/FROM obligations/.test(sql)) {
    return {
      rows: [
        { status: "active", count: "3" },
        { status: "waived", count: "1" },
      ],
      rowCount: 2,
    };
  }
  return { rows: [], rowCount: 0 };
}

describe("GET /api/posture/compliance-summary — serialization order guard (§4.2)", () => {
  it("issues obligations then obligation_assessments sequentially — one query in flight at a time", async () => {
    h.state.resolver = complianceResolver;
    const res = await request(makeApp())
      .get("/api/posture/compliance-summary")
      .set("X-Api-Key", "k");

    expect(res.status).toBe(200);
    expect(h.state.order.length).toBe(2);
    // The property that removes the DeprecationWarning / pg@9 throw: never more
    // than one in-flight query on the single tenant client. A Promise.all would
    // make this 2.
    expect(h.state.maxConcurrent).toBe(1);
    // Exact documented order (obligations, then obligation_assessments).
    expect(h.state.order[0]).toMatch(/FROM obligations/);
    expect(h.state.order[0]).not.toMatch(/FROM obligation_assessments/);
    expect(h.state.order[1]).toMatch(/FROM obligation_assessments/);
  });

  it("binds the two results to the correct summary fields (response shape pinned)", async () => {
    h.state.resolver = complianceResolver;
    const res = await request(makeApp())
      .get("/api/posture/compliance-summary")
      .set("X-Api-Key", "k");

    // Equivalence guard: a binding swap or query-text drift during a future
    // refactor would change this body.
    expect(res.body).toEqual({
      obligations: {
        total: 4,
        by_status: { active: 3, waived: 1, not_applicable: 0 },
      },
      assessments: {
        total: 3,
        by_status: {
          not_started: 0,
          in_progress: 0,
          compliant: 2,
          non_compliant: 1,
          partially_compliant: 0,
        },
      },
      open_compliance_concerns: 1,
    });
  });
});
