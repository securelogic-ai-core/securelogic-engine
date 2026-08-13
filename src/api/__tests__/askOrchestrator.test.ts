/**
 * askOrchestrator.test.ts — the Ask tool-calling loop.
 *
 * The invariants worth holding here are the ones that fail QUIETLY in
 * production: a loop that never terminates, a denial the model reads as an
 * empty result, an audit ledger that records successes but not refusals, and a
 * digest that quietly copies customer data into a second table.
 */
import { describe, it, expect, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL ||= "postgres://ask-orchestrator-test/unused";
});

import {
  MAX_ITERATIONS,
  MAX_TOOL_CALLS,
  digestToolOutput,
  runAskOrchestration,
} from "../lib/ask/orchestrator.js";

/** A fake Anthropic client driven by a scripted sequence of responses. */
function scriptedClient(script: Array<Array<Record<string, unknown>>>) {
  let call = 0;
  const seen: Array<Record<string, unknown>> = [];
  return {
    seen,
    calls: () => call,
    client: {
      messages: {
        create: vi.fn(async (opts: Record<string, unknown>) => {
          seen.push(opts);
          const content = script[Math.min(call, script.length - 1)] ?? [
            { type: "text", text: "done" },
          ];
          call += 1;
          return { content };
        }),
      },
    } as never,
  };
}

const textBlock = (text: string) => ({ type: "text", text });
const toolUse = (name: string, input: Record<string, unknown> = {}, id = "tu-1") => ({
  type: "tool_use",
  id,
  name,
  input,
});

/** A request stub. The executor inherits from it; tools are mocked out below. */
const fakeReq = () => ({ headers: {} }) as never;

// The executor is exercised for real in the isolation harness
// (askToolAuthorizationEquivalence). Here it is stubbed so the LOOP's behaviour
// is what is under test, not the route stack.
vi.mock("../tools/executor.js", () => ({
  executeTool: vi.fn(async (_req: unknown, tool: { name: string }) => {
    if (tool.name === "vendors.get") {
      return { ok: false, error: "denied", status: 404, message: "Not found, or not accessible to this user.", latencyMs: 3 };
    }
    return { ok: true, status: 200, data: { findings: [{ id: "f-1" }, { id: "f-2" }], total: 2 }, latencyMs: 5 };
  }),
}));

const run = (script: Array<Array<Record<string, unknown>>>) => {
  const { client, seen, calls } = scriptedClient(script);
  return {
    seen,
    calls,
    result: runAskOrchestration({
      client,
      model: "test-model",
      systemPrompt: "sys",
      history: [],
      question: "How many findings?",
      origin: fakeReq(),
    }),
  };
};

// ─── Termination ────────────────────────────────────────────────────────────

describe("Ask orchestration — the loop terminates", () => {
  it("stops as soon as the model returns prose with no tool calls", async () => {
    const { result, calls } = run([[textBlock("You have 2 active findings.")]]);
    const r = await result;
    expect(r.answer).toBe("You have 2 active findings.");
    expect(r.stoppedBy).toBe("model");
    expect(calls()).toBe(1);
    expect(r.invocations).toHaveLength(0);
  });

  it("runs a tool, feeds the result back, and finishes", async () => {
    const { result } = run([
      [toolUse("findings.search", { severity: "Critical" })],
      [textBlock("You have 2 Critical findings.")],
    ]);
    const r = await result;
    expect(r.invocations).toHaveLength(1);
    expect(r.invocations[0]!.toolName).toBe("findings.search");
    expect(r.answer).toBe("You have 2 Critical findings.");
  });

  it("CANNOT loop forever — the iteration cap is enforced, not requested", async () => {
    // A model asked politely to stop calling tools will sometimes not. The cap
    // is the reason a runaway turn cannot burn unbounded provider credit.
    const forever = [[toolUse("findings.search")]];
    const { result, calls } = run(forever);
    const r = await result;
    expect(calls()).toBeLessThanOrEqual(MAX_ITERATIONS);
    expect(r.iterations).toBeLessThanOrEqual(MAX_ITERATIONS);
  });

  it("stops at the TOOL cap and tells the model the answer may be incomplete", async () => {
    // Three tool calls per turn will cross MAX_TOOL_CALLS before the iteration
    // cap does.
    const many = [
      [toolUse("findings.search", {}, "a"), toolUse("findings.search", {}, "b"), toolUse("findings.search", {}, "c")],
    ];
    const { result, seen } = run(many);
    const r = await result;

    expect(r.invocations.length).toBeLessThanOrEqual(MAX_TOOL_CALLS);
    expect(r.stoppedBy).toBe("tool_cap");

    // The budget message must reach the model, so a partial answer can say so
    // rather than presenting itself as complete.
    const lastMessages = JSON.stringify(seen[seen.length - 1]);
    expect(lastMessages).toMatch(/budget exhausted/i);
    expect(lastMessages).toMatch(/incomplete/i);
  });
});

// ─── Denials ────────────────────────────────────────────────────────────────

describe("Ask orchestration — denials are stated, never silently empty", () => {
  it("records a denied tool call as authorized:false", async () => {
    // A ledger of successes only cannot answer "what did Ask try to read and get
    // refused?" — which is exactly what an auditor asks.
    const { result } = run([[toolUse("vendors.get", { id: "v-other-org" })], [textBlock("ok")]]);
    const r = await result;

    expect(r.invocations).toHaveLength(1);
    expect(r.invocations[0]!.authorized).toBe(false);
    expect(r.invocations[0]!.errorCode).toBe("denied");
    expect(r.invocations[0]!.statusCode).toBe(404);
  });

  it("hands the model a NON-DISCLOSING denial it is told not to speculate about", async () => {
    const { result, seen } = run([[toolUse("vendors.get", { id: "x" })], [textBlock("ok")]]);
    await result;

    // Inspect the tool_result content itself, not the whole request — the tool
    // SCHEMAS also travel on every call and legitimately contain the words the
    // leak patterns look for.
    const msgs = (seen[1] as { messages: Array<{ role: string; content: unknown }> }).messages;
    const toolResult = msgs
      .flatMap((m) => (Array.isArray(m.content) ? m.content : []))
      .find((b: any) => b?.type === "tool_result") as { content: string };

    expect(toolResult.content).toMatch(/not_found_or_not_accessible/);
    expect(toolResult.content).toMatch(/do not speculate/i);

    // Must not AFFIRM existence or attribute the record to another tenant —
    // that would leak through Ask what the API deliberately refuses to leak.
    // ("do not speculate about whether it exists" is the non-disclosure
    // instruction itself, so the bare word is fine; the affirmations are not.)
    expect(toolResult.content).not.toMatch(/another organization|other org|belongs to/i);
    expect(toolResult.content).not.toMatch(/\bdoes exist\b|\bexists but\b/i);
  });

  it("a denial does not abort the turn — the model still answers", async () => {
    const { result } = run([
      [toolUse("vendors.get", { id: "x" })],
      [textBlock("I could not access that vendor.")],
    ]);
    const r = await result;
    expect(r.answer).toBe("I could not access that vendor.");
  });

  it("an invented tool name is reported, not guessed at", async () => {
    const { result, seen } = run([[toolUse("vendors.deleteEverything")], [textBlock("ok")]]);
    const r = await result;
    // No invocation is recorded for a tool that does not exist.
    expect(r.invocations).toHaveLength(0);
    expect(JSON.stringify(seen[1])).toMatch(/unknown_tool/);
  });
});

// ─── Action-class fencing ───────────────────────────────────────────────────

describe("Ask orchestration — only READ tools are offered", () => {
  it("the model is never shown a non-read tool", async () => {
    // September 15 ships read-only; draft is P1 and mutate/governed are P2
    // behind Stop Gate ASK-B. Passing the class list explicitly means a write
    // tool appearing in the registry cannot silently become reachable.
    const { result, seen } = run([[textBlock("ok")]]);
    await result;
    const declared = (seen[0] as { tools?: Array<{ name: string }> }).tools ?? [];
    expect(declared.length).toBeGreaterThan(0);
    const names = declared.map((t) => t.name);
    // Every offered tool is one of the read tools in the registry.
    expect(names.every((n) => /\.(search|get|summary|current|findings)$/.test(n))).toBe(true);
  });

  it("tool schemas never leak the middleware chain to the model", async () => {
    const { result, seen } = run([[textBlock("ok")]]);
    await result;
    expect(JSON.stringify(seen[0].tools)).not.toMatch(/requireApiKey|asTenant|chain/);
  });
});

// ─── The digest ─────────────────────────────────────────────────────────────

describe("Ask orchestration — output digest records shape, not payload", () => {
  it("summarises arrays as counts plus ids", () => {
    const d = digestToolOutput({ findings: [{ id: "a" }, { id: "b" }], total: 2 })!;
    expect(d.findings_count).toBe(2);
    expect(d.findings_ids).toEqual(["a", "b"]);
    expect(d.total).toBe(2);
  });

  it("does NOT copy row contents into the ledger", () => {
    // Tool output is customer risk data. Copying it wholesale into a second
    // table would double the blast radius of any future leak for no
    // investigative gain the ids do not already provide.
    const d = digestToolOutput({
      findings: [{ id: "a", title: "SECRET VENDOR BREACH", description: "sensitive detail" }],
    })!;
    const serialized = JSON.stringify(d);
    expect(serialized).not.toMatch(/SECRET VENDOR BREACH/);
    expect(serialized).not.toMatch(/sensitive detail/);
    expect(d.findings_ids).toEqual(["a"]);
  });

  it("keeps scalar aggregates, because those are what an answer quotes", () => {
    const d = digestToolOutput({ active_count: 7, critical_active: 2 })!;
    expect(d.active_count).toBe(7);
    expect(d.critical_active).toBe(2);
  });

  it("caps the id list rather than growing without bound", () => {
    const rows = Array.from({ length: 200 }, (_, i) => ({ id: `id-${i}` }));
    const d = digestToolOutput({ rows })!;
    expect(d.rows_count).toBe(200);
    expect((d.rows_ids as string[]).length).toBe(50);
  });

  it("returns null for empty or scalar-free output", () => {
    expect(digestToolOutput(null)).toBeNull();
    expect(digestToolOutput({})).toBeNull();
  });
});

// ─── Streaming events (LC-3) ────────────────────────────────────────────────
//
// With onEvent the loop runs through the SDK's streaming API; without it,
// behaviour is byte-identical to before the parameter existed (every suite
// above passes a client with NO stream method — that is the proof).

/** A scripted client whose streaming path emits text deltas before resolving. */
function scriptedStreamClient(script: Array<Array<Record<string, unknown>>>) {
  let call = 0;
  const create = vi.fn(async () => {
    throw new Error("create() must not be called when onEvent is provided");
  });
  const stream = vi.fn(() => {
    const content = script[Math.min(call, script.length - 1)] ?? [textBlock("done")];
    call += 1;
    const textListeners: Array<(t: string) => void> = [];
    return {
      on: (event: string, cb: (t: string) => void) => {
        if (event === "text") textListeners.push(cb);
      },
      finalMessage: async () => {
        // The real SDK emits deltas while the response streams; emitting them
        // before finalMessage resolves reproduces that ordering.
        for (const block of content) {
          if (block.type !== "text") continue;
          for (const word of String(block.text).split(/(?<= )/)) {
            for (const listener of textListeners) listener(word);
          }
        }
        return { content };
      },
    };
  });
  return { client: { messages: { create, stream } } as never, create, stream };
}

describe("Ask orchestration — streaming events (LC-3)", () => {
  const twoTurnScript = [
    [textBlock("Checking your findings."), toolUse("findings.search")],
    [textBlock("You have 2 active findings.")],
  ];

  it("emits round → deltas → tool_call per turn, and the answer still assembles", async () => {
    const { client, create, stream } = scriptedStreamClient(twoTurnScript);
    const events: Array<Record<string, unknown>> = [];
    const r = await runAskOrchestration({
      client,
      model: "test-model",
      systemPrompt: "sys",
      history: [],
      question: "How many findings?",
      origin: fakeReq(),
      onEvent: (e) => events.push(e as unknown as Record<string, unknown>),
    });

    expect(r.answer).toBe("You have 2 active findings.");
    expect(create).not.toHaveBeenCalled();
    expect(stream).toHaveBeenCalledTimes(2);

    const types = events.map((e) => e.type);
    // Round 1: interim prose deltas, then the tool call. Round 2: answer deltas.
    expect(types[0]).toBe("round");
    expect(types).toContain("tool_call");
    const roundIndices = types
      .map((t, i) => (t === "round" ? i : -1))
      .filter((i) => i !== -1);
    expect(roundIndices).toHaveLength(2);

    // Deltas of the SECOND round reassemble the final answer exactly.
    const secondRoundDeltas = events
      .slice(roundIndices[1]!)
      .filter((e) => e.type === "delta")
      .map((e) => e.text)
      .join("");
    expect(secondRoundDeltas).toBe("You have 2 active findings.");

    const toolEvent = events.find((e) => e.type === "tool_call")!;
    expect(toolEvent.tool).toBe("findings.search");
    expect(toolEvent.authorized).toBe(true);
  });

  it("reports denials as tool_call events with authorized:false", async () => {
    const { client } = scriptedStreamClient([
      [toolUse("vendors.get", { id: "x" })],
      [textBlock("That vendor is not accessible.")],
    ]);
    const events: Array<Record<string, unknown>> = [];
    await runAskOrchestration({
      client,
      model: "test-model",
      systemPrompt: "sys",
      history: [],
      question: "Show me vendor x",
      origin: fakeReq(),
      onEvent: (e) => events.push(e as unknown as Record<string, unknown>),
    });
    const toolEvent = events.find((e) => e.type === "tool_call")!;
    expect(toolEvent.authorized).toBe(false);
  });

  it("a throwing onEvent listener cannot fail the orchestration", async () => {
    const { client } = scriptedStreamClient(twoTurnScript);
    const r = await runAskOrchestration({
      client,
      model: "test-model",
      systemPrompt: "sys",
      history: [],
      question: "How many findings?",
      origin: fakeReq(),
      onEvent: () => {
        throw new Error("listener bug");
      },
    });
    expect(r.answer).toBe("You have 2 active findings.");
    expect(r.stoppedBy).toBe("model");
  });
});
