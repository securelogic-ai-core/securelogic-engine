/**
 * risksArchivedFilter.test.ts — Risk lifecycle (Epic R4, §4.6) archived view.
 *
 * The archived filter lives on the CORE GET /api/risks route (not a flag-gated
 * lifecycle route), so its default archived-exclusion must be applied ONLY when
 * the risk-lifecycle flag is on — flag-off the list SQL must be byte-for-byte
 * unchanged (no lifecycle_state predicate at all).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";

const ORG = "11111111-1111-4111-8111-111111111111";

const h = vi.hoisted(() => ({ order: [] as string[] }));

vi.mock("../infra/postgres.js", () => ({
  pg: {
    query: vi.fn(async (sql: string) => {
      h.order.push(sql);
      return { rows: [], rowCount: 0 };
    }),
    connect: vi.fn(),
  },
  withTenant: vi.fn(async (_org: string, cb: () => Promise<unknown>) => cb()),
  pgElevated: { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) },
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

import risksRouter from "../routes/risks.js";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", risksRouter);
  return app;
}

const ORIGINAL_ENV = { ...process.env };
beforeEach(() => {
  h.order = [];
});
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

const listSql = () => h.order.filter((s) => /FROM risks/.test(s) && /ORDER BY/.test(s));

describe("archived filter (flag on)", () => {
  beforeEach(() => {
    process.env["SECURELOGIC_RISK_LIFECYCLE_ENABLED"] = "true";
  });

  it("excludes archived by default (keeps NULL/never-in-lifecycle rows)", async () => {
    const res = await request(makeApp()).get("/api/risks").set("X-Api-Key", "k");
    expect(res.status).toBe(200);
    const sql = listSql();
    expect(sql.length).toBeGreaterThan(0);
    expect(sql.some((s) => /lifecycle_state IS DISTINCT FROM 'archived'/.test(s))).toBe(true);
    expect(sql.some((s) => /lifecycle_state = 'archived'/.test(s))).toBe(false);
  });

  it("returns ONLY archived when ?archived=true", async () => {
    const res = await request(makeApp()).get("/api/risks?archived=true").set("X-Api-Key", "k");
    expect(res.status).toBe(200);
    const sql = listSql();
    expect(sql.some((s) => /lifecycle_state = 'archived'/.test(s))).toBe(true);
    expect(sql.some((s) => /IS DISTINCT FROM 'archived'/.test(s))).toBe(false);
  });
});

describe("archived filter (flag off) — byte-for-byte unchanged", () => {
  it("adds NO lifecycle_state predicate when the flag is off", async () => {
    delete process.env["SECURELOGIC_RISK_LIFECYCLE_ENABLED"];
    const res = await request(makeApp()).get("/api/risks").set("X-Api-Key", "k");
    expect(res.status).toBe(200);
    expect(h.order.some((s) => /lifecycle_state/.test(s))).toBe(false);
  });

  it("ignores ?archived=true when the flag is off (no predicate leak)", async () => {
    delete process.env["SECURELOGIC_RISK_LIFECYCLE_ENABLED"];
    const res = await request(makeApp()).get("/api/risks?archived=true").set("X-Api-Key", "k");
    expect(res.status).toBe(200);
    expect(h.order.some((s) => /lifecycle_state/.test(s))).toBe(false);
  });
});
