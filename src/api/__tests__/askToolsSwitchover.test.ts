/**
 * askToolsSwitchover.test.ts — the retrieval-path switch.
 *
 * Ask has two retrieval implementations during the transition: the A0-corrected
 * SNAPSHOT (shipping) and the TOOL path (new). Two data paths is exactly the
 * problem this programme exists to remove, so it is only tolerable as a
 * transition — and only if the switch itself is provably safe:
 *
 *   - dark by default, so a deploy cannot flip a customer-facing surface;
 *   - rollback is the flag alone — no migration, no data change;
 *   - both paths keep the SAME authorization chain and BOTH write the audit
 *     event, so auditability never depends on which path ran.
 *
 * The tool path's authorization is proven for real against a database in
 * test/isolation/askToolAuthorizationEquivalence.test.ts. This file covers the
 * switch and the route-level contract.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const ORG = "11111111-1111-4111-8111-111111111111";

const h = vi.hoisted(() => ({
  auditEvents: [] as Array<Record<string, unknown>>,
  orchestrationCalls: [] as Array<Record<string, unknown>>,
  persisted: [] as string[],
  queries: [] as string[],
}));

vi.mock("../infra/postgres.js", () => ({
  pg: {
    query: vi.fn(async (sql: string) => {
      h.queries.push(sql);
      if (/INSERT INTO ask_conversations/.test(sql)) {
        return { rows: [{ id: "conv-1" }], rowCount: 1 };
      }
      if (/INSERT INTO ask_messages/.test(sql)) {
        return { rows: [{ id: "msg-1" }], rowCount: 1 };
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
    messages = { create: vi.fn(async () => ({ content: [{ type: "text", text: "snapshot answer" }] })) };
  },
}));
vi.mock("../infra/providerQuotaAlert.js", () => ({ instrumentAnthropicClient: (c: unknown) => c }));
vi.mock("../lib/auditLog.js", () => ({
  writeAuditEvent: vi.fn((e: Record<string, unknown>) => { h.auditEvents.push(e); }),
}));

// The orchestrator is exercised on its own in askOrchestrator.test.ts and end to
// end in the isolation harness. Stubbed here so the SWITCH is what is tested.
vi.mock("../lib/ask/orchestrator.js", () => ({
  runAskOrchestration: vi.fn(async (a: Record<string, unknown>) => {
    h.orchestrationCalls.push(a);
    return {
      answer: "tool answer",
      invocations: [
        { toolName: "findings.search", actionClass: "read", input: {}, authorized: true, statusCode: 200, errorCode: null, latencyMs: 4, outputDigest: { findings_count: 2 } },
        { toolName: "vendors.get", actionClass: "read", input: { id: "x" }, authorized: false, statusCode: 404, errorCode: "denied", latencyMs: 2, outputDigest: null },
      ],
      iterations: 2,
      stoppedBy: "model",
    };
  }),
}));

vi.mock("../middleware/requireApiKey.js", () => ({
  requireApiKey: (_r: unknown, _s: unknown, next: () => void) => next(),
}));
vi.mock("../middleware/attachOrganizationContext.js", () => ({
  attachOrganizationContext: (req: { organizationContext?: unknown }, _s: unknown, next: () => void) => {
    req.organizationContext = { organizationId: ORG };
    next();
  },
}));
vi.mock("../middleware/requireEntitlement.js", () => ({
  requireEntitlement: () => (_r: unknown, _s: unknown, next: () => void) => next(),
}));

import askRouter from "../routes/ask.js";
import { askToolsEnabled } from "../lib/ask/askToolsFeatureFlag.js";

const app = () => {
  const a = express();
  a.use(express.json());
  a.use("/api", askRouter);
  return a;
};
const ask = (body: Record<string, unknown> = {}) =>
  request(app()).post("/api/ask").send({ question: "How many findings?", ...body });

beforeEach(() => {
  vi.clearAllMocks();
  h.auditEvents = [];
  h.orchestrationCalls = [];
  h.persisted = [];
  h.queries = [];
  process.env.ANTHROPIC_API_KEY = "test-key";
  delete process.env.SECURELOGIC_ASK_TOOLS_ENABLED;
  delete process.env.SECURELOGIC_ASK_ENABLED;
});

// ─── The flag ───────────────────────────────────────────────────────────────

describe("Ask retrieval switch — dark by default", () => {
  it("defaults OFF, unlike the ASK_ENABLED kill switch", () => {
    // Opposite defaults, deliberately: ASK_ENABLED protects a capability already
    // live (so default-off would remove shipped behaviour), while ASK_TOOLS is a
    // dark launch of a new retrieval path no staging environment has exercised.
    expect(askToolsEnabled({})).toBe(false);
    expect(askToolsEnabled({ SECURELOGIC_ASK_TOOLS_ENABLED: "true" })).toBe(true);
    expect(askToolsEnabled({ SECURELOGIC_ASK_TOOLS_ENABLED: "1" })).toBe(false);
    expect(askToolsEnabled({ SECURELOGIC_ASK_TOOLS_ENABLED: "yes" })).toBe(false);
  });

  it("flag OFF runs the snapshot path and never the orchestrator", async () => {
    const res = await ask();
    expect(res.status).toBe(200);
    expect(res.body.answer).toBe("snapshot answer");
    expect(h.orchestrationCalls).toHaveLength(0);
  });

  it("flag ON runs the orchestrator and never the snapshot queries", async () => {
    process.env.SECURELOGIC_ASK_TOOLS_ENABLED = "true";
    const res = await ask();
    expect(res.status).toBe(200);
    expect(res.body.answer).toBe("tool answer");
    expect(h.orchestrationCalls).toHaveLength(1);
    // The eight-query snapshot must not run on the tool path — that would be
    // paying for both data paths on every question.
    expect(h.queries.some((q) => /FROM posture_snapshots/.test(q))).toBe(false);
    expect(h.queries.some((q) => /vendor_sourced/.test(q))).toBe(false);
  });
});

// ─── Contract parity ────────────────────────────────────────────────────────

describe("Ask retrieval switch — the response contract holds on both paths", () => {
  it("both paths return answer + question", async () => {
    const snapshot = await ask();
    process.env.SECURELOGIC_ASK_TOOLS_ENABLED = "true";
    const tools = await ask();

    for (const r of [snapshot, tools]) {
      expect(typeof r.body.answer).toBe("string");
      expect(r.body.question).toBe("How many findings?");
      expect(r.body).toHaveProperty("context_used");
    }
  });

  it("the tool path reports what it actually retrieved, including denials", async () => {
    process.env.SECURELOGIC_ASK_TOOLS_ENABLED = "true";
    const res = await ask();
    expect(res.body.context_used.retrieval).toBe("tools");
    expect(res.body.context_used.tool_calls).toBe(2);
    expect(res.body.context_used.tools_denied).toBe(1);
    expect(res.body.context_used.complete).toBe(true);
  });

  it("the tool path returns a conversation id so a follow-up can continue the thread", async () => {
    process.env.SECURELOGIC_ASK_TOOLS_ENABLED = "true";
    const res = await ask();
    expect(res.body.conversation_id).toBe("conv-1");
  });
});

// ─── Auditability does not depend on the path ───────────────────────────────

describe("Ask retrieval switch — BOTH paths audit", () => {
  it("the snapshot path writes ask.question.asked", async () => {
    await ask();
    expect(h.auditEvents.find((e) => e.eventType === "ask.question.asked")).toBeTruthy();
  });

  it("the tool path writes ask.question.asked, with the tool ledger as its digest", async () => {
    process.env.SECURELOGIC_ASK_TOOLS_ENABLED = "true";
    await ask();
    const ev = h.auditEvents.find((e) => e.eventType === "ask.question.asked")!;
    const payload = ev.payload as Record<string, any>;
    expect(payload.retrieval).toBe("tools");
    // Which authorized reads happened, and which were REFUSED. A ledger of
    // successes only cannot answer what an auditor actually asks.
    expect(payload.tool_calls).toEqual([
      { tool: "findings.search", authorized: true, status: 200 },
      { tool: "vendors.get", authorized: false, status: 404 },
    ]);
  });

  it("neither path puts the model's answer in the audit log", async () => {
    await ask();
    process.env.SECURELOGIC_ASK_TOOLS_ENABLED = "true";
    await ask();
    for (const ev of h.auditEvents) {
      expect(ev.payload).not.toHaveProperty("answer");
      expect((ev.payload as Record<string, unknown>).answer_length).toBeTypeOf("number");
    }
  });
});

// ─── Resilience ─────────────────────────────────────────────────────────────

describe("Ask retrieval switch — persistence never fails the answer", () => {
  it("a conversation-storage failure still returns the answer", async () => {
    // A user asking a question should not get a 500 because history could not be
    // written. The answer is the product; the thread is a convenience.
    process.env.SECURELOGIC_ASK_TOOLS_ENABLED = "true";
    const { pg } = await import("../infra/postgres.js");
    (pg.query as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("db down"));

    const res = await ask();
    expect(res.status).toBe(200);
    expect(res.body.answer).toBe("tool answer");
  });

  it("the kill switch still 404s before either path runs", async () => {
    process.env.SECURELOGIC_ASK_ENABLED = "false";
    process.env.SECURELOGIC_ASK_TOOLS_ENABLED = "true";
    const res = await ask();
    expect(res.status).toBe(404);
    expect(h.orchestrationCalls).toHaveLength(0);
    expect(h.queries).toHaveLength(0);
  });
});
