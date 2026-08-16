/**
 * askActionsTurnPayload.test.ts — the runAskToolTurn half of the ASK-B token
 * custody chain (LC-5).
 *
 * What must hold at the TURN level:
 *
 *   * the raw token appears in the HTTP payload's proposed_actions — and in
 *     NOTHING else the turn produces: not the audit ledger, not the persisted
 *     conversation rows, not the log stream;
 *   * the class list widens only under flag + human identity — the flag off,
 *     or a userless API-key caller, keeps orchestration read-only;
 *   * proposal persistence failure drops the cards entirely (fail toward NOT
 *     mutating), never a partial render.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const ORG = "11111111-1111-4111-8111-111111111111";
const RAW_TOKEN = "f".repeat(64);

const h = vi.hoisted(() => ({
  auditEvents: [] as Array<Record<string, unknown>>,
  sqlWrites: [] as Array<{ sql: string; params: unknown[] }>,
  orchestrationCalls: [] as Array<Record<string, unknown>>,
  proposalsFromLoop: [] as Array<Record<string, unknown>>,
  createProposalCalls: [] as Array<Record<string, unknown>>,
  failCreateProposal: false,
  attachUserId: true,
  enrichmentVisible: true,
}));

vi.mock("../infra/postgres.js", () => ({
  pg: {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      h.sqlWrites.push({ sql, params });
      if (/INSERT INTO ask_conversations/.test(sql)) return { rows: [{ id: "conv-1" }], rowCount: 1 };
      if (/INSERT INTO ask_messages/.test(sql)) return { rows: [{ id: "msg-1" }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    }),
    connect: vi.fn(),
  },
  withTenant: vi.fn(async (_org: string, cb: () => Promise<unknown>) => cb()),
  pgElevated: { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) },
}));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: vi.fn(async () => ({ content: [{ type: "text", text: "snap" }] })) };
  },
}));
vi.mock("../infra/providerQuotaAlert.js", () => ({ instrumentAnthropicClient: (c: unknown) => c }));
vi.mock("../lib/auditLog.js", () => ({
  writeAuditEvent: vi.fn((e: Record<string, unknown>) => { h.auditEvents.push(e); }),
}));
vi.mock("../lib/ask/governedSummaries.js", () => ({
  enrichProposalSummary: vi.fn(
    async (
      _org: string,
      toolName: string,
      _input: Record<string, unknown>,
      summary: string
    ) => {
      if (toolName === "findings.close") {
        return h.enrichmentVisible
          ? { ok: true, summary: `${summary} — finding: "Stale TLS cert" (severity High)` }
          : { ok: false };
      }
      return { ok: true, summary };
    }
  ),
}));
vi.mock("../lib/ask/proposalStore.js", () => ({
  createProposal: vi.fn(async (args: Record<string, unknown>) => {
    h.createProposalCalls.push(args);
    if (h.failCreateProposal) throw new Error("db down");
    return {
      id: `prop-${h.createProposalCalls.length}`,
      token: "f".repeat(64),
      expiresAt: "2099-01-01T00:00:00Z",
    };
  }),
}));
vi.mock("../lib/ask/orchestrator.js", () => ({
  runAskOrchestration: vi.fn(async (a: Record<string, unknown>) => {
    h.orchestrationCalls.push(a);
    return {
      answer: "Prepared a change for your confirmation.",
      invocations: [],
      proposals: h.proposalsFromLoop,
      iterations: 1,
      stoppedBy: "model",
      provenance: null,
    };
  }),
}));
// Partial mocks: ask.ts's registry import loads the ENTIRE route graph, and
// other route files consume other members of these modules (requireCapability,
// requirePremiumOrCorePlatform, …) — keep the real exports, override only the
// gates on the /api/ask chain under test.
vi.mock("../middleware/requireApiKey.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  requireApiKey: (req: Record<string, unknown>, _s: unknown, next: () => void) => {
    req.apiKey = { id: "key-1" };
    if (h.attachUserId) req.userId = "22222222-2222-4222-8222-222222222222";
    next();
  },
}));
vi.mock("../middleware/attachOrganizationContext.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  attachOrganizationContext: (req: Record<string, unknown>, _s: unknown, next: () => void) => {
    req.organizationContext = { organizationId: ORG, entitlementLevel: "premium" };
    next();
  },
}));
vi.mock("../middleware/requireEntitlement.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  requireEntitlement: () => (_r: unknown, _s: unknown, next: () => void) => next(),
}));
vi.mock("../middleware/requireSeat.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  denyContributor: () => (_r: unknown, _s: unknown, next: () => void) => next(),
}));

import askRouter from "../routes/ask.js";

const app = () => {
  const a = express();
  a.use(express.json());
  a.use("/api", askRouter);
  return a;
};
const ask = () => request(app()).post("/api/ask").send({ question: "Create an action" });

const PROPOSAL = {
  toolName: "actions.create",
  input: { title: "Patch routers", source_type: "manual", priority: "immediate" },
  summary: 'Create remediation action: "Patch routers"',
};

const GOVERNED_PROPOSAL = {
  toolName: "findings.close",
  input: {
    id: "55555555-5555-4555-8555-555555555555",
    decision_state: "resolved",
    decision_note: "False positive: the host was decommissioned in Q2.",
  },
  summary: "Close finding 55555555-5555-4555-8555-555555555555 (decision_state → resolved)",
};

beforeEach(() => {
  vi.clearAllMocks();
  h.auditEvents = [];
  h.sqlWrites = [];
  h.orchestrationCalls = [];
  h.createProposalCalls = [];
  h.proposalsFromLoop = [PROPOSAL];
  h.failCreateProposal = false;
  h.attachUserId = true;
  h.enrichmentVisible = true;
  process.env.ANTHROPIC_API_KEY = "test-key";
  process.env.SECURELOGIC_ASK_TOOLS_ENABLED = "true";
  process.env.SECURELOGIC_ASK_ACTIONS_ENABLED = "true";
  delete process.env.SECURELOGIC_ASK_GOVERNED_ENABLED;
  delete process.env.SECURELOGIC_ASK_ENABLED;
});

describe("ASK-B turn — token custody", () => {
  it("the raw token reaches the HTTP payload and NOTHING else the turn produced", async () => {
    const res = await ask();
    expect(res.status).toBe(200);
    expect(res.body.proposed_actions).toHaveLength(1);
    expect(res.body.proposed_actions[0]).toMatchObject({
      id: "prop-1",
      tool: "actions.create",
      token: RAW_TOKEN,
    });

    // Not in any audit event…
    expect(JSON.stringify(h.auditEvents)).not.toContain(RAW_TOKEN);
    // …and not in any SQL the turn issued (conversation rows, messages).
    expect(JSON.stringify(h.sqlWrites)).not.toContain(RAW_TOKEN);
  });

  it("audits ask.action.proposed per proposal and counts proposals on ask.question.asked", async () => {
    await ask();
    const proposed = h.auditEvents.filter((e) => e.eventType === "ask.action.proposed");
    expect(proposed).toHaveLength(1);
    expect(proposed[0]).toMatchObject({ resourceId: "prop-1" });
    const asked = h.auditEvents.find((e) => e.eventType === "ask.question.asked");
    expect((asked!.payload as Record<string, unknown>).proposals).toBe(1);
  });

  it("proposal persistence failure drops ALL cards — never a partial render", async () => {
    h.failCreateProposal = true;
    const res = await ask();
    expect(res.status).toBe(200);
    expect(res.body.proposed_actions).toBeUndefined();
    expect(h.auditEvents.filter((e) => e.eventType === "ask.action.proposed")).toHaveLength(0);
  });
});

describe("ASK-B turn — class widening is flag- and identity-gated", () => {
  it("flag on + user present → orchestration runs with read+mutate", async () => {
    await ask();
    expect(h.orchestrationCalls[0]!.actionClasses).toEqual(["read", "mutate"]);
  });

  it("flag off → read-only orchestration and an unchanged payload shape", async () => {
    delete process.env.SECURELOGIC_ASK_ACTIONS_ENABLED;
    const res = await ask();
    expect(h.orchestrationCalls[0]!.actionClasses).toEqual(["read"]);
    expect(res.body.proposed_actions).toBeUndefined();
    expect(h.createProposalCalls).toHaveLength(0);
  });

  it("a caller with no human identity gets read-only orchestration even with the flag on", async () => {
    h.attachUserId = false;
    const res = await ask();
    expect(h.orchestrationCalls[0]!.actionClasses).toEqual(["read"]);
    expect(res.body.proposed_actions).toBeUndefined();
  });

  it("the governed flag widens INDEPENDENTLY: alone → read+governed; both → all three", async () => {
    delete process.env.SECURELOGIC_ASK_ACTIONS_ENABLED;
    process.env.SECURELOGIC_ASK_GOVERNED_ENABLED = "true";
    await ask();
    expect(h.orchestrationCalls[0]!.actionClasses).toEqual(["read", "governed"]);

    process.env.SECURELOGIC_ASK_ACTIONS_ENABLED = "true";
    await ask();
    expect(h.orchestrationCalls[1]!.actionClasses).toEqual(["read", "mutate", "governed"]);
  });
});

describe("ASK-B turn — governed summary enrichment (LC-5b)", () => {
  it("a governed card carries the SERVER-sourced object identity", async () => {
    process.env.SECURELOGIC_ASK_GOVERNED_ENABLED = "true";
    h.proposalsFromLoop = [GOVERNED_PROPOSAL];
    const res = await ask();
    expect(res.body.proposed_actions).toHaveLength(1);
    expect(res.body.proposed_actions[0].summary).toContain('"Stale TLS cert"');
    expect(res.body.proposed_actions[0].summary).toContain("severity High");
    // The enriched summary is what got persisted (and what audit will carry).
    expect(h.createProposalCalls[0]!.summary).toContain("severity High");
  });

  it("risks.accept proposals persist with the 5-minute TTL (per-tool override)", async () => {
    process.env.SECURELOGIC_ASK_GOVERNED_ENABLED = "true";
    h.proposalsFromLoop = [
      {
        toolName: "risks.accept",
        input: {
          id: "77777777-7777-4777-8777-777777777777",
          owner_user_id: "22222222-2222-4222-8222-222222222222",
          rationale: "Compensating controls cover this exposure through Q4.",
          expires_at: "2027-06-30",
        },
        summary: "Propose RISK ACCEPTANCE for finding 7777…",
      },
    ];
    const res = await ask();
    expect(res.body.proposed_actions).toHaveLength(1);
    expect(h.createProposalCalls[0]!.ttlMs).toBe(5 * 60 * 1000);
  });

  it("an object the org cannot see DROPS the proposal — no row, no token, no card", async () => {
    process.env.SECURELOGIC_ASK_GOVERNED_ENABLED = "true";
    h.enrichmentVisible = false;
    h.proposalsFromLoop = [GOVERNED_PROPOSAL, PROPOSAL];
    const res = await ask();
    // The governed card vanished; the mutate card survived.
    expect(res.body.proposed_actions).toHaveLength(1);
    expect(res.body.proposed_actions[0].tool).toBe("actions.create");
    expect(h.createProposalCalls).toHaveLength(1);
  });
});
