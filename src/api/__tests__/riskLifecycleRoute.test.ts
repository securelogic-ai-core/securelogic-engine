import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";

const ORG = "11111111-1111-4111-8111-111111111111";
const RISK = "22222222-2222-4222-8222-222222222222";

// Hoisted mutable state the postgres mock reads from.
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
    events: [] as unknown[],
  },
}));

function resolve(sql: string): { rows: unknown[]; rowCount: number } {
  const s = h.state;
  s.order.push(sql);
  if (/INSERT INTO risk_lifecycle_events/.test(sql)) {
    return { rows: [{ id: "evt-1", created_at: "2026-07-02T00:00:00.000Z" }], rowCount: 1 };
  }
  if (/UPDATE risks SET/.test(sql)) return { rows: [], rowCount: 1 };
  if (/treatment_count/.test(sql)) return { rows: [s.gateRow], rowCount: 1 };
  if (/FROM risk_lifecycle_events/.test(sql)) return { rows: s.events, rowCount: s.events.length };
  if (/SELECT 1\s+FROM risks/.test(sql)) {
    return s.riskRow ? { rows: [{ "?column?": 1 }], rowCount: 1 } : { rows: [], rowCount: 0 };
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
    // Simulate an authenticated user session (JWT bridge) by default.
    req.userId = "user-1";
    req.apiKey = { id: "key-1" };
    next();
  },
}));
vi.mock("../middleware/attachOrganizationContext.js", () => ({
  attachOrganizationContext: (
    req: { organizationContext?: unknown },
    _res: unknown,
    next: () => void
  ) => {
    req.organizationContext = { organizationId: ORG };
    next();
  },
}));
vi.mock("../middleware/requireEntitlement.js", () => ({
  requireEntitlement: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

// Import AFTER mocks.
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
  h.state.order = [];
  h.state.riskRow = null;
  h.state.gateRow = {
    treatment_count: 1,
    has_evidence: true,
    approval_granted: false,
    proposer_user_id: null,
    approval_threshold_score: null,
    require_evidence_gate: false,
  };
  h.state.events = [];
});
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

const wrote = (re: RegExp) => h.state.order.some((s) => re.test(s));

describe("feature flag gating", () => {
  it("404s every route when the flag is off (before auth)", async () => {
    delete process.env["SECURELOGIC_RISK_LIFECYCLE_ENABLED"];
    const app = makeApp();
    const post = await request(app)
      .post(`/api/risks/${RISK}/lifecycle/transitions`)
      .send({ transition: "begin_assessment", comment: "x" });
    expect(post.status).toBe(404);
    expect(post.body).toEqual({ error: "not_found" });
    const get = await request(app).get(`/api/risks/${RISK}/lifecycle`);
    expect(get.status).toBe(404);
  });
});

describe("POST transition — happy path", () => {
  it("begin_assessment moves draft→scoping and writes the event in-handler", async () => {
    h.state.riskRow = {
      lifecycle_state: null,
      owner_user_id: "owner-1",
      residual_rating: "High",
      residual_score: 60,
    };
    const res = await request(makeApp())
      .post(`/api/risks/${RISK}/lifecycle/transitions`)
      .set("X-Api-Key", "k")
      .send({ transition: "begin_assessment", comment: "starting" });
    expect(res.status).toBe(200);
    expect(res.body.lifecycle_state).toBe("scoping");
    expect(res.body.event).toMatchObject({
      from_state: "draft",
      to_state: "scoping",
      transition: "begin_assessment",
      id: "evt-1",
    });
    // Same handler issued BOTH the state UPDATE and the event INSERT.
    expect(wrote(/UPDATE risks SET/)).toBe(true);
    expect(wrote(/INSERT INTO risk_lifecycle_events/)).toBe(true);
  });

  it("close writes legacy status='closed' too", async () => {
    h.state.riskRow = {
      lifecycle_state: "residual_review",
      owner_user_id: "owner-1",
      residual_rating: "High",
      residual_score: 60,
    };
    const res = await request(makeApp())
      .post(`/api/risks/${RISK}/lifecycle/transitions`)
      .send({ transition: "close", comment: "done" });
    expect(res.status).toBe(200);
    expect(res.body.lifecycle_state).toBe("closed");
    expect(wrote(/UPDATE risks SET lifecycle_state = \$1, status = \$2/)).toBe(true);
  });
});

describe("POST transition — gate & validation failures", () => {
  it("409 gate_not_satisfied owner_required when advancing with no owner", async () => {
    h.state.riskRow = {
      lifecycle_state: "scoping",
      owner_user_id: null,
      residual_rating: "High",
      residual_score: 60,
    };
    const res = await request(makeApp())
      .post(`/api/risks/${RISK}/lifecycle/transitions`)
      .send({ transition: "advance_to_treatment", comment: "go" });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "gate_not_satisfied", reason: "owner_required" });
    // No state change or event on a rejected transition.
    expect(wrote(/UPDATE risks SET/)).toBe(false);
    expect(wrote(/INSERT INTO risk_lifecycle_events/)).toBe(false);
  });

  it("422 invalid_transition for a legal transition from the wrong state", async () => {
    h.state.riskRow = { lifecycle_state: "draft", owner_user_id: "o", residual_rating: "High", residual_score: 50 };
    const res = await request(makeApp())
      .post(`/api/risks/${RISK}/lifecycle/transitions`)
      .send({ transition: "close", comment: "x" });
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ error: "invalid_transition", from: "draft" });
  });

  it("409 terminal_state from a terminal state", async () => {
    h.state.riskRow = { lifecycle_state: "closed", owner_user_id: "o", residual_rating: "High", residual_score: 50 };
    const res = await request(makeApp())
      .post(`/api/risks/${RISK}/lifecycle/transitions`)
      .send({ transition: "begin_assessment", comment: "x" });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: "terminal_state", from: "closed" });
  });

  it("409 state_conflict when expected_from_state does not match", async () => {
    h.state.riskRow = { lifecycle_state: "scoping", owner_user_id: "o", residual_rating: "High", residual_score: 50 };
    const res = await request(makeApp())
      .post(`/api/risks/${RISK}/lifecycle/transitions`)
      .send({ transition: "advance_to_treatment", comment: "x", expected_from_state: "draft" });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: "state_conflict", expected: "draft", actual: "scoping" });
  });

  it("400 comment_required when comment is missing", async () => {
    h.state.riskRow = { lifecycle_state: null, owner_user_id: "o", residual_rating: "High", residual_score: 50 };
    const res = await request(makeApp())
      .post(`/api/risks/${RISK}/lifecycle/transitions`)
      .send({ transition: "begin_assessment" });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "comment_required" });
  });

  it("400 invalid_transition_name for an unknown transition", async () => {
    const res = await request(makeApp())
      .post(`/api/risks/${RISK}/lifecycle/transitions`)
      .send({ transition: "teleport", comment: "x" });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "invalid_transition_name" });
  });

  it("400 risk_id_must_be_uuid for a non-uuid id", async () => {
    const res = await request(makeApp())
      .post(`/api/risks/not-a-uuid/lifecycle/transitions`)
      .send({ transition: "begin_assessment", comment: "x" });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "risk_id_must_be_uuid" });
  });

  it("404 risk_not_found when the risk is absent", async () => {
    h.state.riskRow = null;
    const res = await request(makeApp())
      .post(`/api/risks/${RISK}/lifecycle/transitions`)
      .send({ transition: "begin_assessment", comment: "x" });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "risk_not_found" });
  });
});

describe("POST transition — approval transitions are refused (routed to the approvals endpoint)", () => {
  it.each(["submit_for_approval", "approve", "reject"])(
    "409 use_approvals_endpoint for %s — the generic endpoint cannot bypass canApprove/SoD",
    async (transition) => {
      // A stale approved approval would otherwise satisfy the state machine's
      // approval_required gate; the guard refuses before any lookup/mutation.
      h.state.gateRow.approval_granted = true;
      h.state.riskRow = {
        lifecycle_state: "pending_approval",
        owner_user_id: "o",
        residual_rating: "High",
        residual_score: 60,
      };
      const res = await request(makeApp())
        .post(`/api/risks/${RISK}/lifecycle/transitions`)
        .send({ transition, comment: "x" });
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ error: "use_approvals_endpoint", transition });
      // No state change and no event — authority never crossed.
      expect(wrote(/UPDATE risks SET/)).toBe(false);
      expect(wrote(/INSERT INTO risk_lifecycle_events/)).toBe(false);
    }
  );

  it("does not advertise approval-managed transitions in GET allowed_transitions", async () => {
    h.state.gateRow.treatment_count = 1;
    h.state.riskRow = {
      lifecycle_state: "treatment_selection",
      owner_user_id: "owner-1",
      residual_rating: "High",
      residual_score: 60,
    };
    const res = await request(makeApp()).get(`/api/risks/${RISK}/lifecycle`);
    expect(res.status).toBe(200);
    expect(res.body.allowed_transitions).not.toContain("submit_for_approval");
    expect(res.body.allowed_transitions).not.toContain("approve");
    expect(res.body.allowed_transitions).not.toContain("reject");
  });
});

describe("GET /lifecycle", () => {
  it("returns state, gates and allowed transitions", async () => {
    h.state.riskRow = {
      lifecycle_state: "scoping",
      owner_user_id: "owner-1",
      residual_rating: "High",
      residual_score: 60,
    };
    const res = await request(makeApp()).get(`/api/risks/${RISK}/lifecycle`);
    expect(res.status).toBe(200);
    expect(res.body.lifecycle_state).toBe("scoping");
    expect(res.body.gates).toMatchObject({ owner: true, score: true });
    // From scoping the only allowed transition is advance_to_treatment (gates met);
    // rescore targets scoping and is therefore not offered from scoping itself.
    expect(res.body.allowed_transitions).toEqual(["advance_to_treatment"]);
  });
});

describe("GET /lifecycle/events", () => {
  it("returns the event stream", async () => {
    h.state.riskRow = { lifecycle_state: "scoping", owner_user_id: "o", residual_rating: "High", residual_score: 50 };
    h.state.events = [
      { id: "evt-1", from_state: "draft", to_state: "scoping", transition: "begin_assessment", created_at: "2026-07-02T00:00:00.000Z" },
    ];
    const res = await request(makeApp()).get(`/api/risks/${RISK}/lifecycle/events`);
    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(1);
    expect(res.body.events[0].transition).toBe("begin_assessment");
  });

  it("400 invalid_limit for an out-of-range limit", async () => {
    h.state.riskRow = { lifecycle_state: "scoping", owner_user_id: "o", residual_rating: "High", residual_score: 50 };
    const res = await request(makeApp()).get(`/api/risks/${RISK}/lifecycle/events?limit=999`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_limit");
  });
});
