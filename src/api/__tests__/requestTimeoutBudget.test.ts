/**
 * requestTimeoutBudget.test.ts
 *
 * The global 30s request timeout is a fail-closed control, and for every route
 * that answers from Postgres it is the right one. The Ask tool path is the
 * exception: a turn is a multi-round model loop plus a provenance pass, which
 * measured 45s on staging for one ordinary question (2026-08-14).
 *
 * Under the shared default that produced two distinct failures:
 *
 *   - POST /api/ask returned 504 request_timeout on EVERY tool-path turn. The
 *     route writes nothing until it is done, so the socket's idle timer never
 *     resets and 30s acts as a hard total-duration cap.
 *   - POST /api/ask/stream passed only by luck. SSE writes reset that timer, but
 *     the provenance pass emits nothing for its entire duration — a measured 29s
 *     of silence against a 30s limit. One second slower and the stream is cut
 *     after the final delta and before `final`, which a client cannot
 *     distinguish from a complete answer.
 *
 * These assert the budget, and just as importantly assert that the exception
 * stayed narrow — the neighbouring /api/ask/* routes do no model work and must
 * keep the strict default.
 */
import { describe, it, expect, vi } from "vitest";

// postgres.ts throws at module load without DATABASE_URL, and app.ts pulls in
// the route tree. Nothing here opens a connection.
vi.hoisted(() => {
  process.env.DATABASE_URL ||= "postgres://request-timeout-test/unused";
});

import { resolveRequestTimeoutMs } from "../app.js";

const STRICT_MS = 30_000;
const ASK_MS = 90_000;

describe("request timeout budget", () => {
  it("gives the two Ask model routes room to finish a real turn", () => {
    expect(resolveRequestTimeoutMs("/api/ask")).toBe(ASK_MS);
    expect(resolveRequestTimeoutMs("/api/ask/stream")).toBe(ASK_MS);
  });

  it("exceeds the measured worst case with margin", () => {
    // 45s observed end-to-end. A budget that merely matched it would convert a
    // routine slow turn back into the 504 this exists to remove.
    expect(ASK_MS).toBeGreaterThan(45_000 * 1.5);
  });

  it("stays below the edge proxy's own abort", () => {
    // Cloudflare fronts the service and gives up on an origin request around
    // 100s, answering with an HTML 524 that no client here can parse. The app
    // must lose the race so a timeout stays a clean JSON 504.
    expect(ASK_MS).toBeLessThan(100_000);
  });

  it.each([
    "/api/ask/conversations",
    "/api/ask/conversations/8f14e45f-ceea-467a-9f79-b7e0a3d0a1e2",
    "/api/ask/actions/confirm",
    "/api/ask/actions/decline",
  ])("keeps the strict default for %s — no model work happens there", (path) => {
    expect(resolveRequestTimeoutMs(path)).toBe(STRICT_MS);
  });

  it("does not widen the exception to unrelated routes", () => {
    for (const path of ["/api/findings", "/api/vendors", "/health", "/", "/api/asked"]) {
      expect(resolveRequestTimeoutMs(path)).toBe(STRICT_MS);
    }
  });

  it("normalizes a trailing slash rather than silently under-budgeting it", () => {
    // Express routes "/api/ask/" to the same handler with default settings. A
    // raw Set lookup would miss and hand that request the 30s budget.
    expect(resolveRequestTimeoutMs("/api/ask/")).toBe(ASK_MS);
    expect(resolveRequestTimeoutMs("/api/ask/stream/")).toBe(ASK_MS);
    expect(resolveRequestTimeoutMs("/")).toBe(STRICT_MS);
  });
});
