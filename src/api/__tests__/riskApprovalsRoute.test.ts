import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";

const ORG = "11111111-1111-4111-8111-111111111111";
const RISK = "22222222-2222-4222-8222-222222222222";
const APPROVAL = "33333333-3333-4333-8333-333333333333";
const PROPOSER = "44444444-4444-4444-8444-444444444444";
const ADMIN = "55555555-5555-4555-8555-555555555555";

const h = vi.hoisted(() => ({
  state: {
    order: [] as string[],
    riskRow: null as Record<string, unknown> | null,
    gateRow: {
      treatment_count: 1,
      has_evidence: true,
      approval_granted: false,
      proposer_user_id: null as string | null,
      approval_threshold_score: null as number | null,
      require_evidence_gate: false,
    },
    openApprovalCount: 0,
    treatmentExists: true,
    approvalRow: null as Record<string, unknown> | null,
    listRows: [] as unknown[],
    // Inlined literal (== PROPOSER) — vi.hoisted runs before the const decls below.
    actor: { userId: "44444444-4444-4444-8444-444444444444" as string | null, role: "analyst" as string | null },
  },
}));

function resolve(sql: string): { rows: unknown[]; rowCount: number } {
  const s = h.state;
  s.order.push(sql);
  if (/INSERT INTO risk_lifecycle_events/.test(sql)) return { rows: [{ id: "evt-1" }], rowCount: 1 };
  if (/INSERT INTO risk_approvals/.test(sql)) {
    return {
      rows: [{ id: APPROVAL, kind: "treatment_plan", decision: "pending", requested_by_user_id: s.actor.userId, expires_at: null, created_at: "2026-07-02T00:00:00.000Z" }],
      rowCount: 1,
    };
  }
  if (/UPDATE risk_approvals/.test(sql)) return { rows: [], rowCount: 1 };
  if (/UPDATE risks SET/.test(sql)) return { rows: [], rowCount: 1 };
  if (/treatment_count/.test(sql)) return { rows: [s.gateRow], rowCount: 1 };
  if (/FROM risk_treatments WHERE id = \$1/.test(sql)) {
    return s.treatmentExists ? { rows: [{ "?column?": 1 }], rowCount: 1 } : { rows: [], rowCount: 0 };
  }
  if (/FROM risk_approvals a/.test(sql)) return { rows: s.listRows, rowCount: s.listRows.length };
  if (/FROM risk_approvals\s+WHERE id = \$1/.test(sql)) {
    return s.approvalRow ? { rows: [s.approvalRow], rowCount: 1 } : { rows: [], rowCount: 0 };
  }
  if (/FROM risk_approvals/.test(sql) && /decision = 'pending' LIMIT 1/.test(sql)) {
    return s.openApprovalCount > 0 ? { rows: [{ "?column?": 1 }], rowCount: 1 } : { rows: [], rowCount: 0 };
  }
  if (/FROM risks WHERE id/.test(sql)) {
    return s.riskRow ? { rows: [s.riskRow], rowCount: 1 } : { rows: [], rowCount: 0 };
  }
  return { rows: [], rowCount: 0 };
}

vi.mock("../infra/postgres.js", () => ({
  pg: { query: vi.fn(async (sql: string) => resolve(sql)), connect: vi.fn() },
  withTenant: vi.fn(async (_org: string, cb: () => Promise<unknown>) => cb()),
  pgElevated: { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) },
}));
vi.mock("../middleware/requireApiKey.js", () => ({
  requireApiKey: (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    if (h.state.actor.userId) {
      req.userId = h.state.actor.userId;
      req.userRole = h.state.actor.role;
    } else {
      req.apiKey = { id: "key-1" };
    }
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

import riskApprovalsRouter from "../routes/riskApprovals.js";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", riskApprovalsRouter);
  return app;
}

const ORIGINAL_ENV = { ...process.env };
beforeEach(() => {
  process.env["SECURELOGIC_RISK_LIFECYCLE_ENABLED"] = "true";
  h.state.order = [];
  h.state.riskRow = null;
  h.state.gateRow = { treatment_count: 1, has_evidence: true, approval_granted: false, proposer_user_id: null, approval_threshold_score: null, require_evidence_gate: false };
  h.state.openApprovalCount = 0;
  h.state.treatmentExists = true;
  h.state.approvalRow = null;
  h.state.listRows = [];
  h.state.actor = { userId: PROPOSER, role: "analyst" };
});
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

const wrote = (re: RegExp) => h.state.order.some((s) => re.test(s));

describe("feature flag", () => {
  it("404s when the flag is off", async () => {
    delete process.env["SECURELOGIC_RISK_LIFECYCLE_ENABLED"];
    const res = await request(makeApp()).post(`/api/risks/${RISK}/approvals`).send({});
    expect(res.status).toBe(404);
  });
});

describe("POST request approval", () => {
  it("403 approval_requires_user for an API-key-only caller (Q2)", async () => {
    h.state.actor = { userId: null, role: null };
    const res = await request(makeApp()).post(`/api/risks/${RISK}/approvals`).send({});
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "approval_requires_user" });
  });

  it("403 read_only_access for a viewer JWT (requireNotViewer) — no mutation", async () => {
    h.state.actor = { userId: "viewer-1", role: "viewer" };
    h.state.riskRow = { lifecycle_state: "treatment_selection", owner_user_id: "o", residual_rating: "High", residual_score: 60 };
    const res = await request(makeApp()).post(`/api/risks/${RISK}/approvals`).send({});
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: "read_only_access" });
    expect(wrote(/INSERT INTO risk_approvals/)).toBe(false);
  });

  it("happy path: treatment_selection→pending_approval, opens approval + event", async () => {
    h.state.riskRow = { lifecycle_state: "treatment_selection", owner_user_id: "o", residual_rating: "High", residual_score: 60 };
    const res = await request(makeApp())
      .post(`/api/risks/${RISK}/approvals`)
      .send({ kind: "treatment_plan", request_rationale: "please review" });
    expect(res.status).toBe(201);
    expect(res.body.lifecycle_state).toBe("pending_approval");
    expect(res.body.approval.id).toBe(APPROVAL);
    expect(wrote(/INSERT INTO risk_approvals/)).toBe(true);
    expect(wrote(/UPDATE risks SET lifecycle_state = 'pending_approval'/)).toBe(true);
    expect(wrote(/INSERT INTO risk_lifecycle_events/)).toBe(true);
  });

  it("409 approval_already_open when a pending approval exists", async () => {
    h.state.riskRow = { lifecycle_state: "treatment_selection", owner_user_id: "o", residual_rating: "High", residual_score: 60 };
    h.state.openApprovalCount = 1;
    const res = await request(makeApp()).post(`/api/risks/${RISK}/approvals`).send({});
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "approval_already_open" });
    expect(wrote(/INSERT INTO risk_approvals/)).toBe(false);
  });

  it("409 gate_not_satisfied treatment_required when no treatment exists", async () => {
    h.state.riskRow = { lifecycle_state: "treatment_selection", owner_user_id: "o", residual_rating: "High", residual_score: 60 };
    h.state.gateRow.treatment_count = 0;
    const res = await request(makeApp()).post(`/api/risks/${RISK}/approvals`).send({});
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "gate_not_satisfied", reason: "treatment_required" });
  });

  it("422 invalid_transition when the risk is not in treatment_selection", async () => {
    h.state.riskRow = { lifecycle_state: "draft", owner_user_id: "o", residual_rating: "High", residual_score: 60 };
    const res = await request(makeApp()).post(`/api/risks/${RISK}/approvals`).send({});
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ error: "invalid_transition", from: "draft" });
  });

  it("400 invalid_treatment_id when treatment_id is not on the risk", async () => {
    h.state.riskRow = { lifecycle_state: "treatment_selection", owner_user_id: "o", residual_rating: "High", residual_score: 60 };
    h.state.treatmentExists = false;
    const res = await request(makeApp())
      .post(`/api/risks/${RISK}/approvals`)
      .send({ treatment_id: "66666666-6666-4666-8666-666666666666" });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "invalid_treatment_id" });
  });

  it("404 risk_not_found", async () => {
    h.state.riskRow = null;
    const res = await request(makeApp()).post(`/api/risks/${RISK}/approvals`).send({});
    expect(res.status).toBe(404);
  });
});

describe("POST decision", () => {
  const decideBody = { decision: "approved", comment: "ok" };

  it("403 approval_requires_user for API-key-only caller", async () => {
    h.state.actor = { userId: null, role: null };
    const res = await request(makeApp())
      .post(`/api/risks/${RISK}/approvals/${APPROVAL}/decision`)
      .send(decideBody);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "approval_requires_user" });
  });

  it("403 read_only_access for a viewer JWT (requireNotViewer, before canApprove)", async () => {
    h.state.actor = { userId: "viewer-1", role: "viewer" };
    h.state.approvalRow = { id: APPROVAL, decision: "pending", requested_by_user_id: PROPOSER };
    h.state.riskRow = { lifecycle_state: "pending_approval" };
    const res = await request(makeApp())
      .post(`/api/risks/${RISK}/approvals/${APPROVAL}/decision`)
      .send(decideBody);
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: "read_only_access" });
    expect(wrote(/UPDATE risk_approvals/)).toBe(false);
  });

  it("403 approver_role_required for a non-admin JWT user", async () => {
    h.state.actor = { userId: "analyst-1", role: "analyst" };
    const res = await request(makeApp())
      .post(`/api/risks/${RISK}/approvals/${APPROVAL}/decision`)
      .send(decideBody);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "approver_role_required" });
  });

  it("approve: admin ≠ proposer moves pending_approval→mitigation", async () => {
    h.state.actor = { userId: ADMIN, role: "admin" };
    h.state.approvalRow = { id: APPROVAL, decision: "pending", requested_by_user_id: PROPOSER };
    h.state.riskRow = { lifecycle_state: "pending_approval" };
    const res = await request(makeApp())
      .post(`/api/risks/${RISK}/approvals/${APPROVAL}/decision`)
      .send({ decision: "approved", comment: "looks good" });
    expect(res.status).toBe(200);
    expect(res.body.lifecycle_state).toBe("mitigation");
    expect(wrote(/UPDATE risk_approvals/)).toBe(true);
    expect(wrote(/UPDATE risks SET lifecycle_state = \$1/)).toBe(true);
    expect(wrote(/INSERT INTO risk_lifecycle_events/)).toBe(true);
  });

  it("reject: admin ≠ proposer moves pending_approval→treatment_selection", async () => {
    h.state.actor = { userId: ADMIN, role: "admin" };
    h.state.approvalRow = { id: APPROVAL, decision: "pending", requested_by_user_id: PROPOSER };
    h.state.riskRow = { lifecycle_state: "pending_approval" };
    const res = await request(makeApp())
      .post(`/api/risks/${RISK}/approvals/${APPROVAL}/decision`)
      .send({ decision: "rejected", comment: "insufficient" });
    expect(res.status).toBe(200);
    expect(res.body.lifecycle_state).toBe("treatment_selection");
  });

  it("409 sod_violation when the approver is the requester (no mutation)", async () => {
    h.state.actor = { userId: ADMIN, role: "admin" };
    h.state.approvalRow = { id: APPROVAL, decision: "pending", requested_by_user_id: ADMIN };
    h.state.riskRow = { lifecycle_state: "pending_approval" };
    const res = await request(makeApp())
      .post(`/api/risks/${RISK}/approvals/${APPROVAL}/decision`)
      .send(decideBody);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "sod_violation" });
    expect(wrote(/UPDATE risk_approvals/)).toBe(false);
    expect(wrote(/UPDATE risks SET/)).toBe(false);
  });

  it("409 approval_already_decided when not pending", async () => {
    h.state.actor = { userId: ADMIN, role: "admin" };
    h.state.approvalRow = { id: APPROVAL, decision: "approved", requested_by_user_id: PROPOSER };
    const res = await request(makeApp())
      .post(`/api/risks/${RISK}/approvals/${APPROVAL}/decision`)
      .send(decideBody);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: "approval_already_decided" });
    expect(wrote(/UPDATE risk_approvals/)).toBe(false);
  });

  it("404 approval_not_found", async () => {
    h.state.actor = { userId: ADMIN, role: "admin" };
    h.state.approvalRow = null;
    const res = await request(makeApp())
      .post(`/api/risks/${RISK}/approvals/${APPROVAL}/decision`)
      .send(decideBody);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "approval_not_found" });
  });

  it("400 invalid_decision / comment_required", async () => {
    h.state.actor = { userId: ADMIN, role: "admin" };
    const bad = await request(makeApp())
      .post(`/api/risks/${RISK}/approvals/${APPROVAL}/decision`)
      .send({ decision: "maybe", comment: "x" });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe("invalid_decision");
    const noComment = await request(makeApp())
      .post(`/api/risks/${RISK}/approvals/${APPROVAL}/decision`)
      .send({ decision: "approved" });
    expect(noComment.status).toBe(400);
    expect(noComment.body).toEqual({ error: "comment_required" });
  });
});

describe("GET /approvals", () => {
  it("returns pending approvals with is_self_proposed", async () => {
    h.state.actor = { userId: ADMIN, role: "admin" };
    h.state.listRows = [
      { id: APPROVAL, risk_id: RISK, requested_by_user_id: PROPOSER, kind: "treatment_plan", decision: "pending", risk_title: "R", residual_rating: "High" },
      { id: "77777777-7777-4777-8777-777777777777", risk_id: RISK, requested_by_user_id: ADMIN, kind: "treatment_plan", decision: "pending", risk_title: "R2", residual_rating: "Low" },
    ];
    const res = await request(makeApp()).get(`/api/approvals`);
    expect(res.status).toBe(200);
    expect(res.body.approvals).toHaveLength(2);
    expect(res.body.approvals[0].is_self_proposed).toBe(false);
    expect(res.body.approvals[1].is_self_proposed).toBe(true);
  });

  it("400 invalid_status", async () => {
    const res = await request(makeApp()).get(`/api/approvals?status=weird`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_status");
  });
});
