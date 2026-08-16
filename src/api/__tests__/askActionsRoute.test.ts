/**
 * askActionsRoute.test.ts — the confirm/decline half of Stop Gate ASK-B (LC-5).
 *
 * What must hold at this surface:
 *
 *   * every miss — malformed token, unknown token, expired, replayed, another
 *     user's, no user identity — produces a BYTE-IDENTICAL 404, so a probing
 *     caller cannot learn which check failed;
 *   * execution runs the canonical chain via executeTool with the FROZEN
 *     row input — nothing from the confirm request's body can reach it;
 *   * a refused execution still consumes the token (no retry channel);
 *   * the middleware chain carries every text-Ask gate, in order;
 *   * both flags 404 the surface before any work.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import request from "supertest";

const ORG = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const TOKEN = "a".repeat(64);

const h = vi.hoisted(() => ({
  auditEvents: [] as Array<Record<string, unknown>>,
  claimResult: null as Record<string, unknown> | null,
  declineResult: null as Record<string, unknown> | null,
  executeResult: {
    ok: true,
    status: 201,
    data: { id: "act-1", title: "Patch routers" },
    latencyMs: 5,
  } as Record<string, unknown>,
  toolAvailable: true,
  toolClass: "mutate" as string,
  withAuditContext: false,
  userId: "22222222-2222-4222-8222-222222222222" as string | null,
  outcomes: [] as Array<Record<string, unknown>>,
  claimCalls: [] as Array<Record<string, unknown>>,
  executeCalls: [] as Array<unknown[]>,
}));

vi.mock("../lib/auditLog.js", () => ({
  writeAuditEvent: vi.fn((e: Record<string, unknown>) => {
    h.auditEvents.push(e);
  }),
}));
vi.mock("../middleware/requireApiKey.js", () => ({
  requireApiKey: (req: Record<string, unknown>, _s: unknown, next: () => void) => {
    req.apiKey = { id: "key-1", organization_id: ORG };
    if (h.userId) req.userId = h.userId;
    next();
  },
}));
vi.mock("../middleware/attachOrganizationContext.js", () => ({
  attachOrganizationContext: (req: Record<string, unknown>, _s: unknown, next: () => void) => {
    req.organizationContext = { organizationId: ORG, entitlementLevel: "premium" };
    next();
  },
}));
vi.mock("../middleware/requireSeat.js", () => ({
  denyContributor: () => (_r: unknown, _s: unknown, next: () => void) => next(),
}));
vi.mock("../infra/postgres.js", () => ({
  withTenant: vi.fn(async (_org: string, fn: () => unknown) => fn()),
  pg: { query: vi.fn() },
}));
vi.mock("../lib/ask/proposalStore.js", () => ({
  claimPendingByTokenHash: vi.fn(async (args: Record<string, unknown>) => {
    h.claimCalls.push(args);
    return h.claimResult;
  }),
  declineByTokenHash: vi.fn(async () => h.declineResult),
  recordExecutionOutcome: vi.fn(async (args: Record<string, unknown>) => {
    h.outcomes.push(args);
  }),
}));
vi.mock("../tools/executor.js", () => ({
  executeTool: vi.fn(async (...args: unknown[]) => {
    h.executeCalls.push(args);
    return h.executeResult;
  }),
}));
vi.mock("../tools/registry.js", () => ({
  getTool: vi.fn(() =>
    h.toolAvailable
      ? {
          name: "actions.create",
          actionClass: h.toolClass,
          inputSchema: {},
          binding: {},
          chain: [],
          ...(h.withAuditContext
            ? {
                auditContext: (
                  input: Record<string, unknown>,
                  resultData: unknown
                ) => ({
                  transition: "decision_state → resolved",
                  rationale: input.decision_note ?? null,
                  resulting_state: resultData
                    ? { decision_state: "resolved" }
                    : null,
                }),
              }
            : {}),
        }
      : null
  ),
}));

import askActionsRouter from "../routes/askActions.js";

const app = () => {
  const a = express();
  a.use(express.json());
  a.use("/api", askActionsRouter);
  return a;
};

const post = (path: string, body: Record<string, unknown>) =>
  request(app()).post(path).send(body);

const RECORD = {
  id: "prop-1",
  tool_name: "actions.create",
  tool_input: { title: "Patch routers", source_type: "manual", priority: "immediate" },
  summary: 'Create remediation action: "Patch routers", priority immediate, source manual',
  conversation_id: "conv-1",
};

beforeEach(() => {
  vi.clearAllMocks();
  h.auditEvents = [];
  h.outcomes = [];
  h.claimCalls = [];
  h.executeCalls = [];
  h.claimResult = null;
  h.declineResult = null;
  h.toolAvailable = true;
  h.toolClass = "mutate";
  h.withAuditContext = false;
  h.userId = USER;
  h.executeResult = { ok: true, status: 201, data: { id: "act-1" }, latencyMs: 5 };
  process.env.SECURELOGIC_ASK_ACTIONS_ENABLED = "true";
  delete process.env.SECURELOGIC_ASK_GOVERNED_ENABLED;
  delete process.env.SECURELOGIC_ASK_ENABLED;
});

// ─── Flags ──────────────────────────────────────────────────────────────────

describe("ASK-B routes — flags", () => {
  it("dark by default: with NEITHER class flag both routes 404 as not_found", async () => {
    delete process.env.SECURELOGIC_ASK_ACTIONS_ENABLED;
    for (const path of ["/api/ask/actions/confirm", "/api/ask/actions/decline"]) {
      const res = await post(path, { token: TOKEN });
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "not_found" });
    }
  });

  it("killing Ask kills the confirm surface with it", async () => {
    process.env.SECURELOGIC_ASK_ENABLED = "false";
    const res = await post("/api/ask/actions/confirm", { token: TOKEN });
    expect(res.status).toBe(404);
  });

  it("the governed flag alone opens the surface (independence, LC-5b)", async () => {
    delete process.env.SECURELOGIC_ASK_ACTIONS_ENABLED;
    process.env.SECURELOGIC_ASK_GOVERNED_ENABLED = "true";
    // Surface open; miss semantics unchanged.
    const res = await post("/api/ask/actions/confirm", { token: TOKEN });
    expect(res.status).toBe(404);
    expect(res.body).toEqual(expect.objectContaining({ error: "proposal_not_found" }));
  });

  it("a MUTATE proposal cannot execute when only the governed flag is on — 409, token consumed", async () => {
    delete process.env.SECURELOGIC_ASK_ACTIONS_ENABLED;
    process.env.SECURELOGIC_ASK_GOVERNED_ENABLED = "true";
    h.claimResult = RECORD; // claim happens (surface open), tool is mutate-class
    const res = await post("/api/ask/actions/confirm", { token: TOKEN });
    expect(res.status).toBe(409);
    expect(h.executeCalls).toHaveLength(0);
    expect(h.outcomes[0]).toMatchObject({ id: "prop-1", httpStatus: 503 });
  });

  it("a GOVERNED proposal cannot execute when only the actions flag is on — 409, token consumed", async () => {
    h.toolClass = "governed";
    h.claimResult = RECORD;
    const res = await post("/api/ask/actions/confirm", { token: TOKEN });
    expect(res.status).toBe(409);
    expect(h.executeCalls).toHaveLength(0);
  });

  it("a governed proposal executes under its own flag, with the governed audit context", async () => {
    process.env.SECURELOGIC_ASK_GOVERNED_ENABLED = "true";
    h.toolClass = "governed";
    h.withAuditContext = true;
    h.claimResult = {
      ...RECORD,
      tool_name: "findings.close",
      tool_input: {
        id: "55555555-5555-4555-8555-555555555555",
        decision_state: "resolved",
        decision_note: "False positive: host decommissioned.",
      },
    };
    const res = await post("/api/ask/actions/confirm", { token: TOKEN });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("executed");

    // B-8 (governed): proposal + confirmer + transition + rationale +
    // resulting state on ONE audit event.
    const ev = h.auditEvents.find((e) => e.eventType === "ask.action.executed")!;
    expect(ev).toMatchObject({ resourceId: "prop-1", actorUserId: USER });
    const payload = ev.payload as Record<string, unknown>;
    expect(payload.transition).toBe("decision_state → resolved");
    expect(payload.rationale).toBe("False positive: host decommissioned.");
    expect(payload.resulting_state).toEqual({ decision_state: "resolved" });
  });
});

// ─── Byte-identical denial ──────────────────────────────────────────────────

describe("ASK-B routes — the uniform miss", () => {
  it("malformed, unknown, and userless misses are byte-identical 404s", async () => {
    const bodies: unknown[] = [];

    // Malformed token (never even hashed).
    let res = await post("/api/ask/actions/confirm", { token: "not-a-token" });
    expect(res.status).toBe(404);
    bodies.push(res.body);

    // Well-formed but unknown/expired/consumed/foreign (claim returns null).
    res = await post("/api/ask/actions/confirm", { token: TOKEN });
    expect(res.status).toBe(404);
    bodies.push(res.body);

    // No human identity on the caller.
    h.userId = null;
    res = await post("/api/ask/actions/confirm", { token: TOKEN });
    expect(res.status).toBe(404);
    bodies.push(res.body);

    const first = JSON.stringify(bodies[0]);
    for (const b of bodies) expect(JSON.stringify(b)).toBe(first);

    // And nothing executed, nothing recorded as an outcome.
    expect(h.executeCalls).toHaveLength(0);
    expect(h.outcomes).toHaveLength(0);
  });

  it("every denial writes ask.action.confirm_denied with no token material", async () => {
    await post("/api/ask/actions/confirm", { token: TOKEN });
    const ev = h.auditEvents.find((e) => e.eventType === "ask.action.confirm_denied");
    expect(ev).toBeTruthy();
    expect(JSON.stringify(ev)).not.toContain(TOKEN);
  });
});

// ─── Execution binding ──────────────────────────────────────────────────────

describe("ASK-B routes — execution is bound to the frozen proposal", () => {
  it("executes the canonical chain with the ROW's input; confirm-body fields cannot reach it", async () => {
    h.claimResult = RECORD;
    const res = await post("/api/ask/actions/confirm", {
      token: TOKEN,
      // Attempted overrides — all must be ignored.
      tool_input: { title: "EVIL" },
      title: "EVIL",
      priority: "watch",
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("executed");
    expect(res.body.proposal_id).toBe("prop-1");

    expect(h.executeCalls).toHaveLength(1);
    const [, , inputArg] = h.executeCalls[0] as [unknown, unknown, Record<string, unknown>];
    expect(inputArg).toEqual(RECORD.tool_input);

    // Outcome recorded, audit written.
    expect(h.outcomes[0]).toMatchObject({ id: "prop-1", httpStatus: 201 });
    const ev = h.auditEvents.find((e) => e.eventType === "ask.action.executed");
    expect(ev).toMatchObject({ resourceId: "prop-1", actorUserId: USER });
  });

  it("claim is keyed on the CALLER's org+user, not anything client-supplied", async () => {
    h.claimResult = RECORD;
    await post("/api/ask/actions/confirm", { token: TOKEN, organization_id: "other-org" });
    expect(h.claimCalls[0]).toMatchObject({ organizationId: ORG, userId: USER, rawToken: TOKEN });
  });

  it("a refused execution consumes the token, reports honestly, and audits the refusal", async () => {
    h.claimResult = RECORD;
    h.executeResult = { ok: false, error: "denied", status: 403, message: "no", latencyMs: 2 };
    const res = await post("/api/ask/actions/confirm", { token: TOKEN });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("refused");
    expect(res.body.reason).toBe("denied");

    // The consumed claim is never reversed — there is no unclaim in the store.
    expect(h.outcomes[0]).toMatchObject({ id: "prop-1", httpStatus: 403 });
    const refusedEv = h.auditEvents.find(
      (e) => e.eventType === "ask.action.execution_refused"
    )!;
    expect(refusedEv).toBeTruthy();
    // Denials stay reason-free in the ledger (non-disclosing by construction).
    expect((refusedEv.payload as Record<string, unknown>).refusal_detail).toBeUndefined();
  });

  it("a WORKFLOW refusal's reason lands in the audit event and the outcome digest", async () => {
    h.claimResult = RECORD;
    h.executeResult = {
      ok: false,
      error: "unavailable",
      status: 409,
      message: "cannot_decide",
      latencyMs: 2,
    };
    const res = await post("/api/ask/actions/confirm", { token: TOKEN });
    expect(res.body.status).toBe("refused");

    expect(h.outcomes[0]).toMatchObject({
      id: "prop-1",
      httpStatus: 409,
      digest: { error: "unavailable", detail: "cannot_decide" },
    });
    const ev = h.auditEvents.find((e) => e.eventType === "ask.action.execution_refused")!;
    expect((ev.payload as Record<string, unknown>).refusal_detail).toBe("cannot_decide");
  });

  it("a tool retired between proposal and confirm is honestly unexecutable (409)", async () => {
    h.claimResult = RECORD;
    h.toolAvailable = false;
    const res = await post("/api/ask/actions/confirm", { token: TOKEN });
    expect(res.status).toBe(409);
    expect(h.executeCalls).toHaveLength(0);
    expect(h.outcomes[0]).toMatchObject({ id: "prop-1", httpStatus: 503 });
  });
});

// ─── Decline ────────────────────────────────────────────────────────────────

describe("ASK-B routes — decline", () => {
  it("declines a pending proposal, audits it, and never executes anything", async () => {
    h.declineResult = RECORD;
    const res = await post("/api/ask/actions/decline", { token: TOKEN });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("declined");
    expect(h.executeCalls).toHaveLength(0);
    expect(h.auditEvents.some((e) => e.eventType === "ask.action.declined")).toBe(true);
  });

  it("a decline miss is the same 404 the confirm miss produces", async () => {
    const confirmMiss = await post("/api/ask/actions/confirm", { token: TOKEN });
    const declineMiss = await post("/api/ask/actions/decline", { token: TOKEN });
    expect(declineMiss.status).toBe(404);
    expect(JSON.stringify(declineMiss.body)).toBe(JSON.stringify(confirmMiss.body));
  });
});

// ─── Chain parity (structural) ──────────────────────────────────────────────

describe("ASK-B routes — middleware chain parity with text Ask", () => {
  it("both routes carry every text-Ask gate, in order, plus the actions flag", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, "..", "routes", "askActions.ts"), "utf8");
    const chain = /const CHAIN = \[([\s\S]*?)\] as const;/.exec(src)![1]!;
    const order = [
      "askFeatureFlag",
      "askActionsFlag",
      "requireApiKey",
      "attachOrganizationContext",
      'requireEntitlement("premium")',
      "denyContributor()",
      "confirmRateLimit",
    ];
    let last = -1;
    for (const gate of order) {
      const at = chain.indexOf(gate);
      expect(at, `${gate} missing from the askActions chain`).toBeGreaterThan(-1);
      expect(at, `${gate} out of order in the askActions chain`).toBeGreaterThan(last);
      last = at;
    }
    // Both routes mount the shared CHAIN.
    expect(src).toMatch(/post\("\/ask\/actions\/confirm", \.\.\.CHAIN/);
    expect(src).toMatch(/post\("\/ask\/actions\/decline", \.\.\.CHAIN/);
  });
});
