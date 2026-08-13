/**
 * route.test.ts — the same-origin SSE proxy for Ask streaming (LC-3).
 *
 * What must hold:
 *  - unauthenticated → 401 without touching the engine;
 *  - the session token travels as Authorization: Bearer, the question body is
 *    forwarded, and the engine's SSE bytes come back UNBUFFERED through a
 *    streaming body (not one late arrayBuffer flush);
 *  - engine errors (404 dark flag included) pass through as JSON with their
 *    status, so the client's fallback logic sees the truth.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const sessionState = vi.hoisted(() => ({ token: "test-jwt" as string | null }));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({})),
}));
vi.mock("iron-session", () => ({
  getIronSession: vi.fn(async () => ({ jwtToken: sessionState.token, apiKey: null })),
}));
vi.mock("@/lib/session", () => ({
  getSessionOptions: vi.fn(() => ({})),
}));

import { POST } from "../route";

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});
beforeEach(() => {
  vi.clearAllMocks();
  sessionState.token = "test-jwt";
});

function makeRequest(body: unknown = { question: "How many findings?" }): Request {
  return new Request("http://localhost:3000/api/ask/stream", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function engineSse(frames: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(frame));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

describe("POST /api/ask/stream (proxy)", () => {
  it("401s without a session token and never calls the engine", async () => {
    sessionState.token = null;
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("forwards the token as Bearer and the body verbatim, and pipes SSE back", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    global.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init! });
      return engineSse([
        'event: delta\ndata: {"text":"a"}\n\n',
        'event: final\ndata: {"answer":"a"}\n\n',
      ]);
    }) as unknown as typeof fetch;

    const res = await POST(makeRequest({ question: "q", conversation_id: "c-1" }));

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain("/api/ask/stream");
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer test-jwt");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      question: "q",
      conversation_id: "c-1",
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    // The body must be a stream delivering the engine's bytes.
    expect(await res.text()).toBe(
      'event: delta\ndata: {"text":"a"}\n\nevent: final\ndata: {"answer":"a"}\n\n'
    );
  });

  it("passes an engine 404 (dark flag) through as JSON so the client can fall back", async () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: "not_found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      })
    ) as unknown as typeof fetch;

    const res = await POST(makeRequest());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("passes engine validation errors through with their status", async () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: "question_too_long", message: "too long" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      })
    ) as unknown as typeof fetch;

    const res = await POST(makeRequest({ question: "x".repeat(501) }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "question_too_long", message: "too long" });
  });

  it("400s on a non-JSON request body without calling the engine", async () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    const res = await POST(makeRequest("not json{"));
    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("maps an unreachable engine to 502 ask_unavailable", async () => {
    global.fetch = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;

    const res = await POST(makeRequest());
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "ask_unavailable" });
  });
});
