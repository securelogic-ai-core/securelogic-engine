import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const ORG = "11111111-1111-4111-8111-111111111111";
const ACTION = "22222222-2222-4222-8222-222222222222";

// Hoisted mutable state the postgres mock reads from.
const h = vi.hoisted(() => ({
  state: {
    // Row returned by the PATCH CTE (includes old_status) / unblock UPDATE.
    updateRow: null as Record<string, unknown> | null,
    // Row returned by the unblock pre-check SELECT.
    existingRow: null as Record<string, unknown> | null,
  },
}));

const CREATED_ROW = {
  id: ACTION,
  organization_id: ORG,
  title: "Patch OpenSSL on edge fleet",
  description: "long free text that must never reach a webhook",
  action_type: "remediation",
  source_type: "manual",
  source_id: null,
  priority: "immediate",
  due_date: "2026-08-15",
  owner_user_id: null,
  status: "open",
  created_at: "2026-07-28T00:00:00.000Z",
  updated_at: "2026-07-28T00:00:00.000Z",
};

function resolve(sql: string): { rows: unknown[]; rowCount: number } {
  if (/INSERT INTO actions/.test(sql)) {
    return { rows: [CREATED_ROW], rowCount: 1 };
  }
  if (/UPDATE actions/.test(sql)) {
    return h.state.updateRow
      ? { rows: [h.state.updateRow], rowCount: 1 }
      : { rows: [], rowCount: 0 };
  }
  if (/SELECT id, status, source_type/.test(sql)) {
    return h.state.existingRow
      ? { rows: [h.state.existingRow], rowCount: 1 }
      : { rows: [], rowCount: 0 };
  }
  return { rows: [], rowCount: 0 };
}

const dispatched = vi.hoisted(() => ({ events: [] as Array<Record<string, unknown>> }));

vi.mock("../infra/postgres.js", () => ({
  pg: { query: vi.fn(async (sql: string) => resolve(sql)), connect: vi.fn() },
  withTenant: vi.fn(async (_org: string, cb: () => Promise<unknown>) => cb()),
  pgElevated: { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) },
}));
vi.mock("../lib/webhookDispatcher.js", () => ({
  dispatchWebhookEvent: vi.fn(async (event: Record<string, unknown>) => {
    dispatched.events.push(event);
  }),
}));
vi.mock("../lib/auditLog.js", () => ({ writeAuditEvent: vi.fn() }));
vi.mock("../lib/findingLifecycle.js", () => ({
  recomputeFindingOperationalStatus: vi.fn(async () => ({ changed: false })),
}));
vi.mock("../middleware/requireApiKey.js", () => ({
  requireApiKey: (req: Record<string, unknown>, _res: unknown, next: () => void) => {
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
    req.organizationContext = { organizationId: ORG, entitlementLevel: "premium" };
    next();
  },
}));
vi.mock("../lib/corePlatformCapability.js", () => ({
  requirePremiumOrCorePlatform: (_req: unknown, _res: unknown, next: () => void) =>
    next(),
}));

// Import AFTER mocks.
import actionsRouter from "../routes/actions.js";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", actionsRouter);
  return app;
}

/** Emission is fire-and-forget — let the microtask settle before asserting. */
function settle(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  dispatched.events = [];
  h.state.updateRow = null;
  h.state.existingRow = null;
});

describe("POST /api/actions — action.created emission", () => {
  it("emits once with canonical fields and no free text", async () => {
    const res = await request(makeApp())
      .post("/api/actions")
      .send({
        title: "Patch OpenSSL on edge fleet",
        source_type: "manual",
        priority: "immediate",
      });
    expect(res.status).toBe(201);
    await settle();

    expect(dispatched.events).toHaveLength(1);
    const evt = dispatched.events[0]!;
    expect(evt.event_type).toBe("action.created");
    expect(evt.organization_id).toBe(ORG);
    expect(evt.data).toEqual({
      id: ACTION,
      title: "Patch OpenSSL on edge fleet",
      status: "open",
      priority: "immediate",
      action_type: "remediation",
      source_type: "manual",
      source_id: null,
      owner_user_id: null,
      due_date: "2026-08-15",
      created_at: "2026-07-28T00:00:00.000Z",
    });
    expect(JSON.stringify(evt)).not.toContain("long free text");
  });

  it("does not emit on a validation failure", async () => {
    const res = await request(makeApp()).post("/api/actions").send({ title: "x" });
    expect(res.status).toBe(400);
    await settle();
    expect(dispatched.events).toHaveLength(0);
  });
});

describe("PATCH /api/actions/:id — action.updated emission", () => {
  const baseRow = {
    id: ACTION,
    organization_id: ORG,
    title: "Patch OpenSSL on edge fleet",
    source_type: "manual",
    source_id: null,
    priority: "immediate",
    status: "in_progress",
    owner_user_id: null,
    due_date: null,
    updated_at: "2026-07-28T01:00:00.000Z",
    completed_at: null,
    blocked_reason: null,
    blocked_dependency: null,
    blocked_owner_user_id: null,
    blocked_expected_unblock_date: null,
  };

  it("a status write carries status_change from→to", async () => {
    h.state.updateRow = { ...baseRow, old_status: "open" };
    const res = await request(makeApp())
      .patch(`/api/actions/${ACTION}`)
      .send({ status: "in_progress" });
    expect(res.status).toBe(200);
    await settle();

    expect(dispatched.events).toHaveLength(1);
    const evt = dispatched.events[0]!;
    expect(evt.event_type).toBe("action.updated");
    expect((evt.data as Record<string, unknown>).status_change).toEqual({
      from: "open",
      to: "in_progress",
    });
    // old_status is audit-only — it must not leak into the payload.
    expect("old_status" in (evt.data as Record<string, unknown>)).toBe(false);
  });

  it("a non-status write emits with status_change null", async () => {
    h.state.updateRow = { ...baseRow, status: "open", old_status: "open" };
    const res = await request(makeApp())
      .patch(`/api/actions/${ACTION}`)
      .send({ priority: "planned" });
    expect(res.status).toBe(200);
    await settle();

    expect(dispatched.events).toHaveLength(1);
    expect((dispatched.events[0]!.data as Record<string, unknown>).status_change).toBeNull();
  });

  it("does not emit when the row is absent (404)", async () => {
    h.state.updateRow = null;
    const res = await request(makeApp())
      .patch(`/api/actions/${ACTION}`)
      .send({ priority: "planned" });
    expect(res.status).toBe(404);
    await settle();
    expect(dispatched.events).toHaveLength(0);
  });

  it("keeps blocked_reason out of the payload on a block write", async () => {
    h.state.updateRow = {
      ...baseRow,
      status: "blocked",
      old_status: "in_progress",
      blocked_reason: "vendor has not shipped the fix",
    };
    const res = await request(makeApp())
      .patch(`/api/actions/${ACTION}`)
      .send({ status: "blocked", blocked_reason: "vendor has not shipped the fix" });
    expect(res.status).toBe(200);
    await settle();

    expect(dispatched.events).toHaveLength(1);
    expect(JSON.stringify(dispatched.events[0])).not.toContain("vendor has not shipped");
  });
});

describe("POST /api/actions/:id/unblock — action.updated emission", () => {
  it("emits with status_change blocked→in_progress", async () => {
    h.state.existingRow = {
      id: ACTION,
      status: "blocked",
      source_type: "manual",
      source_id: null,
      blocked_reason: "waiting on vendor",
      blocked_dependency: null,
      blocked_owner_user_id: null,
      blocked_expected_unblock_date: null,
    };
    h.state.updateRow = {
      id: ACTION,
      organization_id: ORG,
      title: "Patch OpenSSL on edge fleet",
      source_type: "manual",
      source_id: null,
      priority: "immediate",
      status: "in_progress",
      owner_user_id: null,
      due_date: null,
      updated_at: "2026-07-28T02:00:00.000Z",
      completed_at: null,
      blocked_reason: "waiting on vendor",
      blocked_dependency: null,
      blocked_owner_user_id: null,
      blocked_expected_unblock_date: null,
    };
    const res = await request(makeApp()).post(`/api/actions/${ACTION}/unblock`).send({});
    expect(res.status).toBe(200);
    await settle();

    expect(dispatched.events).toHaveLength(1);
    const evt = dispatched.events[0]!;
    expect(evt.event_type).toBe("action.updated");
    expect((evt.data as Record<string, unknown>).status_change).toEqual({
      from: "blocked",
      to: "in_progress",
    });
    expect(JSON.stringify(evt)).not.toContain("waiting on vendor");
  });

  it("does not emit on a 409 (action not blocked)", async () => {
    h.state.existingRow = {
      id: ACTION,
      status: "open",
      source_type: "manual",
      source_id: null,
      blocked_reason: null,
      blocked_dependency: null,
      blocked_owner_user_id: null,
      blocked_expected_unblock_date: null,
    };
    const res = await request(makeApp()).post(`/api/actions/${ACTION}/unblock`).send({});
    expect(res.status).toBe(409);
    await settle();
    expect(dispatched.events).toHaveLength(0);
  });
});
