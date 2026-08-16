/**
 * askStream.test.ts — the client-side SSE consumer (LC-3).
 *
 * What must hold:
 *  - frames split across arbitrary chunk boundaries still parse (the normal
 *    case under TCP — a delta can arrive half in one read, half in the next);
 *  - `final` is the ONLY success: a stream that just ends is an error, so a
 *    half-delivered preview can never be mistaken for an answer;
 *  - a dark endpoint (404) is a silent `fallback`, not a user-facing error.
 */
import { describe, it, expect, vi } from "vitest";

import { createSseParser, streamAsk, type AskStreamHandlers } from "../askStream";

// ─── The parser ─────────────────────────────────────────────────────────────

describe("createSseParser", () => {
  it("parses complete frames and preserves order", () => {
    const seen: Array<[string, string]> = [];
    const parse = createSseParser((e, d) => seen.push([e, d]));
    parse('event: delta\ndata: {"text":"a"}\n\nevent: final\ndata: {"answer":"x"}\n\n');
    expect(seen).toEqual([
      ["delta", '{"text":"a"}'],
      ["final", '{"answer":"x"}'],
    ]);
  });

  it("handles frames split across chunk boundaries", () => {
    const seen: Array<[string, string]> = [];
    const parse = createSseParser((e, d) => seen.push([e, d]));
    const full = 'event: delta\ndata: {"text":"hello world"}\n\n';
    // Feed one character at a time — the harshest possible chunking.
    for (const ch of full) parse(ch);
    expect(seen).toEqual([["delta", '{"text":"hello world"}']]);
  });

  it("accepts \\r\\n line endings", () => {
    const seen: Array<[string, string]> = [];
    const parse = createSseParser((e, d) => seen.push([e, d]));
    parse('event: delta\r\ndata: {"text":"a"}\r\n\r\n');
    expect(seen).toEqual([["delta", '{"text":"a"}']]);
  });

  it("joins multi-data-line frames with newlines per the SSE spec", () => {
    const seen: Array<[string, string]> = [];
    const parse = createSseParser((e, d) => seen.push([e, d]));
    parse("event: delta\ndata: line1\ndata: line2\n\n");
    expect(seen).toEqual([["delta", "line1\nline2"]]);
  });
});

// ─── The consumer ───────────────────────────────────────────────────────────

function sseResponse(frames: string[], init?: { status?: number; contentType?: string }) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(frame));
      controller.close();
    },
  });
  return new Response(stream, {
    status: init?.status ?? 200,
    headers: { "content-type": init?.contentType ?? "text/event-stream" },
  });
}

function collectHandlers() {
  const events: Array<Record<string, unknown>> = [];
  const handlers: AskStreamHandlers = {
    onRound: () => events.push({ type: "round" }),
    onDelta: (text) => events.push({ type: "delta", text }),
    onToolCall: (tool, authorized) => events.push({ type: "tool_call", tool, authorized }),
  };
  return { events, handlers };
}

describe("streamAsk", () => {
  it("dispatches round/delta/tool_call and resolves with the final payload", async () => {
    const { events, handlers } = collectHandlers();
    const fetchImpl = vi.fn(async () =>
      sseResponse([
        'event: round\ndata: {"type":"round","iteration":1}\n\n',
        'event: delta\ndata: {"text":"You have "}\n\n',
        'event: tool_call\ndata: {"tool":"findings.search","authorized":true}\n\n',
        'event: delta\ndata: {"text":"2 findings."}\n\n',
        'event: final\ndata: {"answer":"You have 2 findings.","question":"q","conversation_id":"c-1","context_used":{"retrieval":"tools","tool_calls":1,"tools_denied":0,"complete":true}}\n\n',
      ])
    ) as unknown as typeof fetch;

    const outcome = await streamAsk("q", null, handlers, fetchImpl);

    expect(outcome.kind).toBe("final");
    if (outcome.kind === "final") {
      expect(outcome.data.answer).toBe("You have 2 findings.");
      expect(outcome.data.conversation_id).toBe("c-1");
    }
    expect(events).toEqual([
      { type: "round" },
      { type: "delta", text: "You have " },
      { type: "tool_call", tool: "findings.search", authorized: true },
      { type: "delta", text: "2 findings." },
    ]);
  });

  it("sends conversation_id when continuing a thread, omits it when not", async () => {
    const bodies: string[] = [];
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(String(init?.body));
      return sseResponse(['event: final\ndata: {"answer":"a"}\n\n']);
    }) as unknown as typeof fetch;

    const { handlers } = collectHandlers();
    await streamAsk("q", "conv-9", handlers, fetchImpl);
    await streamAsk("q", null, handlers, fetchImpl);

    expect(JSON.parse(bodies[0]!)).toEqual({ question: "q", conversation_id: "conv-9" });
    expect(JSON.parse(bodies[1]!)).toEqual({ question: "q" });
  });

  it("404 means the endpoint is dark → silent fallback, not an error", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ error: "not_found" }), { status: 404 })
    ) as unknown as typeof fetch;
    const { handlers } = collectHandlers();
    expect(await streamAsk("q", null, handlers, fetchImpl)).toEqual({ kind: "fallback" });
  });

  it("a non-SSE 200 (something rewrote the response) also falls back", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response("{}", { status: 200, headers: { "content-type": "application/json" } })
    ) as unknown as typeof fetch;
    const { handlers } = collectHandlers();
    expect(await streamAsk("q", null, handlers, fetchImpl)).toEqual({ kind: "fallback" });
  });

  it("maps an HTTP error body onto the structured error shape", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ error: "rate_limit_exceeded", message: "Too many questions. Wait 60 seconds." }), {
        status: 429,
        headers: { "content-type": "application/json" },
      })
    ) as unknown as typeof fetch;
    const { handlers } = collectHandlers();
    expect(await streamAsk("q", null, handlers, fetchImpl)).toEqual({
      kind: "error",
      status: 429,
      code: "rate_limit_exceeded",
      message: "Too many questions. Wait 60 seconds.",
    });
  });

  it("an error event is terminal and carries the engine's code", async () => {
    const fetchImpl = vi.fn(async () =>
      sseResponse([
        'event: delta\ndata: {"text":"partial"}\n\n',
        'event: error\ndata: {"error":"ask_failed","message":"Unable to process query"}\n\n',
      ])
    ) as unknown as typeof fetch;
    const { handlers } = collectHandlers();
    const outcome = await streamAsk("q", null, handlers, fetchImpl);
    expect(outcome).toEqual({
      kind: "error",
      status: 502,
      code: "ask_failed",
      message: "Unable to process query",
    });
  });

  it("a stream that ends without a terminal frame is an error, never a success", async () => {
    // A half-delivered preview must not be mistaken for an answer: nothing was
    // persisted-confirmed, no conversation id arrived, no provenance came back.
    const fetchImpl = vi.fn(async () =>
      sseResponse(['event: delta\ndata: {"text":"partial answer that never finishes"}\n\n'])
    ) as unknown as typeof fetch;
    const { handlers } = collectHandlers();
    const outcome = await streamAsk("q", null, handlers, fetchImpl);
    expect(outcome).toEqual({ kind: "error", status: 0, code: "stream_interrupted" });
  });

  it("network failure maps to network_error", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const { handlers } = collectHandlers();
    expect(await streamAsk("q", null, handlers, fetchImpl)).toEqual({
      kind: "error",
      status: 0,
      code: "network_error",
    });
  });
});
