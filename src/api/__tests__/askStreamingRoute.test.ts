/**
 * askStreamingRoute.test.ts — POST /api/ask/stream (Launch Completion 3).
 *
 * The invariants worth holding:
 *
 *   - DARK BY DEFAULT, doubly: the route 404s unless BOTH the streaming flag
 *     and the tool-path flag are on (streaming is not built for the retiring
 *     snapshot path).
 *   - Validation stays JSON: a bad request is refused with a plain status
 *     BEFORE any SSE upgrade.
 *   - The `final` event is byte-shape-identical to the JSON route's body —
 *     one turn implementation, two transports, no drift.
 *   - Failure after the upgrade is an `error` EVENT, and the audit trail marks
 *     streamed turns (`streamed: true`) so the ledger can distinguish them.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const ORG = "11111111-1111-4111-8111-111111111111";

const h = vi.hoisted(() => ({
  auditEvents: [] as Array<Record<string, unknown>>,
  orchestrationCalls: [] as Array<Record<string, unknown>>,
  failOrchestration: false,
}));

vi.mock("../infra/postgres.js", () => ({
  pg: {
    query: vi.fn(async (sql: string) => {
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

// The orchestrator's own streaming behaviour is covered in
// askOrchestrator.test.ts; here it is scripted so the ROUTE's SSE contract is
// what is under test. When the route passes onEvent, the script emits the
// sequence a two-round tool turn would produce.
vi.mock("../lib/ask/orchestrator.js", () => ({
  runAskOrchestration: vi.fn(async (a: Record<string, unknown>) => {
    h.orchestrationCalls.push(a);
    if (h.failOrchestration) throw new Error("model unavailable");
    const onEvent = a.onEvent as ((e: Record<string, unknown>) => void) | undefined;
    if (onEvent) {
      onEvent({ type: "round", iteration: 1 });
      onEvent({ type: "delta", text: "Checking findings." });
      onEvent({ type: "tool_call", tool: "findings.search", authorized: true });
      onEvent({ type: "round", iteration: 2 });
      onEvent({ type: "delta", text: "tool " });
      onEvent({ type: "delta", text: "answer" });
    }
    return {
      answer: "tool answer",
      invocations: [
        { toolName: "findings.search", actionClass: "read", input: {}, authorized: true, statusCode: 200, errorCode: null, latencyMs: 4, outputDigest: { findings_count: 2 } },
      ],
      iterations: 2,
      proposals: [],
      stoppedBy: "model",
      provenance: null,
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
import { askStreamingEnabled } from "../lib/ask/askStreamingFeatureFlag.js";

const app = () => {
  const a = express();
  a.use(express.json());
  a.use("/api", askRouter);
  return a;
};
const askStream = (body: Record<string, unknown> = {}) =>
  request(app()).post("/api/ask/stream").send({ question: "How many findings?", ...body });
const askJson = () =>
  request(app()).post("/api/ask").send({ question: "How many findings?" });

/** Parse a raw SSE body into ordered {event, data} frames. */
function parseFrames(raw: string): Array<{ event: string; data: Record<string, unknown> }> {
  return raw
    .split("\n\n")
    .filter((f) => f.trim().length > 0)
    .map((frame) => {
      const event = /event: (.*)/.exec(frame)?.[1] ?? "message";
      const data = JSON.parse(/data: (.*)/.exec(frame)?.[1] ?? "{}") as Record<string, unknown>;
      return { event, data };
    });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.auditEvents = [];
  h.orchestrationCalls = [];
  h.failOrchestration = false;
  process.env.ANTHROPIC_API_KEY = "test-key";
  delete process.env.SECURELOGIC_ASK_ENABLED;
  delete process.env.SECURELOGIC_ASK_TOOLS_ENABLED;
  delete process.env.SECURELOGIC_ASK_STREAMING_ENABLED;
});

// ─── The flag ───────────────────────────────────────────────────────────────

describe("Ask streaming — dark by default", () => {
  it("the flag requires the literal 'true'", () => {
    expect(askStreamingEnabled({})).toBe(false);
    expect(askStreamingEnabled({ SECURELOGIC_ASK_STREAMING_ENABLED: "true" })).toBe(true);
    expect(askStreamingEnabled({ SECURELOGIC_ASK_STREAMING_ENABLED: "1" })).toBe(false);
  });

  it("404s with streaming off, even with the tool path on", async () => {
    process.env.SECURELOGIC_ASK_TOOLS_ENABLED = "true";
    const res = await askStream();
    expect(res.status).toBe(404);
    expect(h.orchestrationCalls).toHaveLength(0);
  });

  it("404s with the tool path off, even with streaming on — no snapshot streaming", async () => {
    process.env.SECURELOGIC_ASK_STREAMING_ENABLED = "true";
    const res = await askStream();
    expect(res.status).toBe(404);
    expect(h.orchestrationCalls).toHaveLength(0);
  });

  it("the Ask kill switch still 404s first", async () => {
    process.env.SECURELOGIC_ASK_ENABLED = "false";
    process.env.SECURELOGIC_ASK_TOOLS_ENABLED = "true";
    process.env.SECURELOGIC_ASK_STREAMING_ENABLED = "true";
    const res = await askStream();
    expect(res.status).toBe(404);
  });
});

// ─── Validation stays JSON ──────────────────────────────────────────────────

describe("Ask streaming — bad requests are refused before the SSE upgrade", () => {
  beforeEach(() => {
    process.env.SECURELOGIC_ASK_TOOLS_ENABLED = "true";
    process.env.SECURELOGIC_ASK_STREAMING_ENABLED = "true";
  });

  it("missing question → 400 JSON", async () => {
    const res = await request(app()).post("/api/ask/stream").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("question_required");
    expect(res.headers["content-type"]).toContain("application/json");
  });

  it("over-long question → 400 JSON", async () => {
    const res = await askStream({ question: "x".repeat(501) });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("question_too_long");
  });

  it("no Anthropic key → 503 JSON", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const res = await askStream();
    expect(res.status).toBe(503);
    expect(res.body.error).toBe("ask_unavailable");
  });
});

// ─── The stream ─────────────────────────────────────────────────────────────

describe("Ask streaming — the SSE contract", () => {
  beforeEach(() => {
    process.env.SECURELOGIC_ASK_TOOLS_ENABLED = "true";
    process.env.SECURELOGIC_ASK_STREAMING_ENABLED = "true";
  });

  it("streams round/delta/tool_call frames in orchestration order, then final", async () => {
    const res = await askStream();
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");

    const frames = parseFrames(res.text);
    expect(frames.map((f) => f.event)).toEqual([
      "round",
      "delta",
      "tool_call",
      "round",
      "delta",
      "delta",
      "final",
    ]);
    expect(frames[2]!.data).toMatchObject({ tool: "findings.search", authorized: true });
    const deltas = frames
      .filter((f, i) => f.event === "delta" && i > 3)
      .map((f) => f.data.text)
      .join("");
    expect(deltas).toBe("tool answer");
  });

  it("the final frame is byte-shape-identical to the JSON route's body", async () => {
    const streamed = await askStream();
    const frames = parseFrames(streamed.text);
    const finalFrame = frames.find((f) => f.event === "final")!.data;

    const json = await askJson();
    expect(json.status).toBe(200);
    expect(finalFrame).toEqual(json.body);
  });

  it("orchestration failure after the upgrade becomes an error event, same wording as the 502", async () => {
    h.failOrchestration = true;
    const res = await askStream();
    // Headers were already flushed — the transport can only say 200.
    expect(res.status).toBe(200);
    const frames = parseFrames(res.text);
    expect(frames).toHaveLength(1);
    expect(frames[0]!.event).toBe("error");
    expect(frames[0]!.data).toEqual({ error: "ask_failed", message: "Unable to process query" });
  });
});

// ─── Audit ──────────────────────────────────────────────────────────────────

describe("Ask streaming — the audit trail distinguishes transports", () => {
  beforeEach(() => {
    process.env.SECURELOGIC_ASK_TOOLS_ENABLED = "true";
    process.env.SECURELOGIC_ASK_STREAMING_ENABLED = "true";
  });

  it("a streamed turn audits ask.question.asked with streamed:true", async () => {
    await askStream();
    const ev = h.auditEvents.find((e) => e.eventType === "ask.question.asked")!;
    expect((ev.payload as Record<string, unknown>).streamed).toBe(true);
    expect((ev.payload as Record<string, unknown>).retrieval).toBe("tools");
  });

  it("a JSON turn audits streamed:false — same event, same ledger", async () => {
    await askJson();
    const ev = h.auditEvents.find((e) => e.eventType === "ask.question.asked")!;
    expect((ev.payload as Record<string, unknown>).streamed).toBe(false);
  });
});
