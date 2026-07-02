/**
 * riskEvidenceRoute.test.ts — Risk lifecycle (Epic R4) risk-scoped evidence.
 *
 * Covers the flag-gated GET/POST/DELETE /api/risks/:id/evidence routes plus the
 * evidence_required lifecycle gate (advance_to_treatment) now that has_evidence
 * is sourced from risk-level evidence. Mirrors riskLifecycleRoute.test.ts's
 * hoisted-pg-mock harness.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";

const ORG = "11111111-1111-4111-8111-111111111111";
const RISK = "22222222-2222-4222-8222-222222222222";
const EVID = "33333333-3333-4333-8333-333333333333";

const h = vi.hoisted(() => ({
  state: {
    calls: [] as { sql: string; params: unknown[] }[],
    riskRow: null as Record<string, unknown> | null,
    gateRow: {
      treatment_count: 1,
      has_evidence: false,
      approval_granted: false,
      proposer_user_id: null as string | null,
      approval_threshold_score: null as number | null,
      require_evidence_gate: false,
    },
    evidenceRows: [] as unknown[],
    detachRowCount: 1,
    actorRole: null as string | null,
  },
}));

function resolve(sql: string, params: unknown[]): { rows: unknown[]; rowCount: number } {
  const s = h.state;
  s.calls.push({ sql, params });
  if (/INSERT INTO evidence/.test(sql)) {
    return { rows: [{ id: EVID, title: (params[2] as string) ?? "t", evidence_type: params[4] }], rowCount: 1 };
  }
  if (/UPDATE evidence\s+SET detached_at/.test(sql)) {
    return s.detachRowCount > 0 ? { rows: [{ id: EVID }], rowCount: 1 } : { rows: [], rowCount: 0 };
  }
  // loadGateRow selects treatment_count AND references `FROM evidence` in the
  // has_evidence subquery — match the gate query BEFORE the plain evidence list.
  if (/treatment_count/.test(sql)) return { rows: [s.gateRow], rowCount: 1 };
  if (/FROM evidence/.test(sql)) {
    return { rows: s.evidenceRows, rowCount: s.evidenceRows.length };
  }
  if (/INSERT INTO risk_lifecycle_events/.test(sql)) {
    return { rows: [{ id: "evt-1", created_at: "2026-07-02T00:00:00.000Z" }], rowCount: 1 };
  }
  if (/UPDATE risks SET/.test(sql)) return { rows: [], rowCount: 1 };
  if (/SELECT 1\s+FROM risks/.test(sql)) {
    return s.riskRow ? { rows: [{ "?column?": 1 }], rowCount: 1 } : { rows: [], rowCount: 0 };
  }
  if (/FROM risks WHERE id/.test(sql)) {
    return s.riskRow ? { rows: [s.riskRow], rowCount: 1 } : { rows: [], rowCount: 0 };
  }
  return { rows: [], rowCount: 0 };
}

vi.mock("../infra/postgres.js", () => ({
  pg: { query: vi.fn(async (sql: string, params: unknown[]) => resolve(sql, params ?? [])), connect: vi.fn() },
  withTenant: vi.fn(async (_org: string, cb: () => Promise<unknown>) => cb()),
  pgElevated: { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) },
}));
vi.mock("../middleware/requireApiKey.js", () => ({
  requireApiKey: (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    req.userId = "user-1";
    req.apiKey = { id: "key-1" };
    if (h.state.actorRole) req.userRole = h.state.actorRole;
    next();
  },
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

import riskLifecycleRouter from "../routes/riskLifecycle.js";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", riskLifecycleRouter);
  return app;
}

const ORIGINAL_ENV = { ...process.env };
beforeEach(() => {
  process.env["SECURELOGIC_RISK_LIFECYCLE_ENABLED"] = "true";
  h.state.calls = [];
  h.state.riskRow = { id: RISK, title: "Vendor outage risk", lifecycle_state: "scoping", owner_user_id: "o1", residual_rating: "High", residual_score: 60 };
  h.state.gateRow = {
    treatment_count: 1,
    has_evidence: false,
    approval_granted: false,
    proposer_user_id: null,
    approval_threshold_score: null,
    require_evidence_gate: false,
  };
  h.state.evidenceRows = [];
  h.state.detachRowCount = 1;
  h.state.actorRole = null;
});
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

const anyCall = (re: RegExp) => h.state.calls.some((c) => re.test(c.sql));
const callFor = (re: RegExp) => h.state.calls.find((c) => re.test(c.sql));

describe("flag gating — risk evidence routes 404 when flag off", () => {
  it("404s GET/POST/DELETE evidence when the flag is off", async () => {
    delete process.env["SECURELOGIC_RISK_LIFECYCLE_ENABLED"];
    const app = makeApp();
    expect((await request(app).get(`/api/risks/${RISK}/evidence`)).status).toBe(404);
    expect((await request(app).post(`/api/risks/${RISK}/evidence`).send({ title: "x", evidence_type: "document" })).status).toBe(404);
    expect((await request(app).delete(`/api/risks/${RISK}/evidence/${EVID}`)).status).toBe(404);
  });
});

describe("POST /api/risks/:id/evidence — attach", () => {
  it("attaches evidence with source_type='risk' and org scope, returns 201", async () => {
    const res = await request(makeApp())
      .post(`/api/risks/${RISK}/evidence`)
      .set("X-Api-Key", "k")
      .send({ title: "SOC 2 report", evidence_type: "document" });
    expect(res.status).toBe(201);
    expect(res.body.evidence.id).toBe(EVID);
    const ins = callFor(/INSERT INTO evidence/);
    expect(ins).toBeTruthy();
    // source_type literal 'risk' in SQL; org + risk id are the first two params.
    expect(ins!.sql).toMatch(/'risk'/);
    expect(ins!.params[0]).toBe(ORG);
    expect(ins!.params[1]).toBe(RISK);
  });

  it("rejects a missing title with 400 (shared metadata validator)", async () => {
    const res = await request(makeApp())
      .post(`/api/risks/${RISK}/evidence`)
      .set("X-Api-Key", "k")
      .send({ evidence_type: "document" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("title_required");
    expect(anyCall(/INSERT INTO evidence/)).toBe(false);
  });

  it("404s when the risk does not exist in the org", async () => {
    h.state.riskRow = null;
    const res = await request(makeApp())
      .post(`/api/risks/${RISK}/evidence`)
      .set("X-Api-Key", "k")
      .send({ title: "x", evidence_type: "document" });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("risk_not_found");
  });

  it("blocks a viewer from attaching (requireNotViewer)", async () => {
    h.state.actorRole = "viewer";
    const res = await request(makeApp())
      .post(`/api/risks/${RISK}/evidence`)
      .set("X-Api-Key", "k")
      .send({ title: "x", evidence_type: "document" });
    expect(res.status).toBe(403);
    expect(anyCall(/INSERT INTO evidence/)).toBe(false);
  });
});

describe("GET /api/risks/:id/evidence — list", () => {
  it("lists live risk evidence, filtering source_type='risk' and detached_at IS NULL", async () => {
    h.state.evidenceRows = [{ id: EVID, title: "SOC 2", evidence_type: "document" }];
    const res = await request(makeApp()).get(`/api/risks/${RISK}/evidence`).set("X-Api-Key", "k");
    expect(res.status).toBe(200);
    expect(res.body.evidence).toHaveLength(1);
    const list = callFor(/FROM evidence/);
    expect(list!.sql).toMatch(/source_type = 'risk'/);
    expect(list!.sql).toMatch(/detached_at IS NULL/);
    expect(list!.params).toContain(ORG);
    expect(list!.params).toContain(RISK);
  });
});

describe("DELETE /api/risks/:id/evidence/:evidenceId — soft detach", () => {
  it("soft-detaches (UPDATE detached_at), org+risk+source scoped, returns 200", async () => {
    const res = await request(makeApp()).delete(`/api/risks/${RISK}/evidence/${EVID}`).set("X-Api-Key", "k");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: EVID, detached: true });
    const upd = callFor(/UPDATE evidence\s+SET detached_at/);
    expect(upd!.sql).toMatch(/source_type = 'risk'/);
    expect(upd!.sql).toMatch(/detached_at IS NULL/);
    expect(upd!.params).toEqual([ORG, EVID, RISK]);
  });

  it("404s when nothing live matches (already detached / not risk evidence)", async () => {
    h.state.detachRowCount = 0;
    const res = await request(makeApp()).delete(`/api/risks/${RISK}/evidence/${EVID}`).set("X-Api-Key", "k");
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("evidence_not_found");
  });

  it("blocks a viewer from detaching (requireNotViewer)", async () => {
    h.state.actorRole = "viewer";
    const res = await request(makeApp()).delete(`/api/risks/${RISK}/evidence/${EVID}`).set("X-Api-Key", "k");
    expect(res.status).toBe(403);
    expect(anyCall(/UPDATE evidence/)).toBe(false);
  });
});

describe("evidence_required gate — advance_to_treatment", () => {
  it("409s with evidence_required when the gate is enforced and no risk evidence exists", async () => {
    h.state.riskRow = { id: RISK, title: "t", lifecycle_state: "scoping", owner_user_id: "o1", residual_rating: "High", residual_score: 60 };
    h.state.gateRow = { ...h.state.gateRow, require_evidence_gate: true, has_evidence: false };
    const res = await request(makeApp())
      .post(`/api/risks/${RISK}/lifecycle/transitions`)
      .set("X-Api-Key", "k")
      .send({ transition: "advance_to_treatment", comment: "go" });
    expect(res.status).toBe(409);
    expect(res.body.reason).toBe("evidence_required");
    expect(anyCall(/UPDATE risks SET/)).toBe(false);
  });

  it("allows advance_to_treatment once risk evidence exists (gate satisfied)", async () => {
    h.state.riskRow = { id: RISK, title: "t", lifecycle_state: "scoping", owner_user_id: "o1", residual_rating: "High", residual_score: 60 };
    h.state.gateRow = { ...h.state.gateRow, require_evidence_gate: true, has_evidence: true };
    const res = await request(makeApp())
      .post(`/api/risks/${RISK}/lifecycle/transitions`)
      .set("X-Api-Key", "k")
      .send({ transition: "advance_to_treatment", comment: "go" });
    expect(res.status).toBe(200);
    expect(res.body.lifecycle_state).toBe("treatment_selection");
  });
});
