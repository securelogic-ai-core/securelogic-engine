/**
 * askClientTimeout.test.ts — the Ask call must outlive the ENGINE's budget.
 *
 * THE DEFECT THIS LOCKS. `engineFetch` aborts every engine call after 15s, which
 * is right for the CRUD surface it was written for. `askQuestion` inherited it.
 * But a real tool-path Ask turn runs 38–52s on staging, and the engine was
 * deliberately given a 90s budget in 1f8da416 for exactly that reason — so the
 * app was abandoning a healthy request at 15s and reporting `network_error`,
 * which the Ask page renders as "Couldn't reach the server. Check your
 * connection and try again."
 *
 * It went unnoticed because of WHERE it sits. The page streams when streaming is
 * on (that proxy already allows 180s), so this path is the one that runs where
 * streaming is OFF — the production default. Every probe that "proved" Ask
 * worked called the engine directly and never crossed this client.
 *
 * The test drives the real AbortSignal on fake timers rather than asserting the
 * constant, because the constant being right is not the property that matters —
 * the signal still being unaborted at 52s is.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { askQuestion, ASK_CLIENT_TIMEOUT_MS, ENGINE_FETCH_TIMEOUT_MS } from "../api";

/** Captures the signal handed to fetch and never settles, so only time moves. */
function captureSignal(): { signals: AbortSignal[] } {
  const signals: AbortSignal[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((_url: string, init?: RequestInit) => {
      if (init?.signal) signals.push(init.signal);
      return new Promise<Response>(() => {});
    })
  );
  return { signals };
}

describe("askQuestion — client timeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("is still waiting at 52s — the slowest turn actually measured on staging", async () => {
    const { signals } = captureSignal();
    void askQuestion("jwt", "Summarise my critical findings");
    await vi.advanceTimersByTimeAsync(0);

    expect(signals).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(52_000);
    expect(signals[0]!.aborted).toBe(false);
  });

  it("was aborting at 15s before the fix — the exact regression to catch", async () => {
    const { signals } = captureSignal();
    void askQuestion("jwt", "Summarise my critical findings");
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(15_001);
    expect(signals[0]!.aborted).toBe(false);
  });

  it("still gives up eventually, AFTER the engine's own 90s budget", async () => {
    const { signals } = captureSignal();
    void askQuestion("jwt", "Summarise my critical findings");
    await vi.advanceTimersByTimeAsync(0);

    // At 90s the engine returns its own 504; the client must still be listening
    // so the user sees that real answer instead of a fabricated network error.
    await vi.advanceTimersByTimeAsync(90_000);
    expect(signals[0]!.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(ASK_CLIENT_TIMEOUT_MS - 90_000);
    expect(signals[0]!.aborted).toBe(true);
  });

  it("orders the two budgets so the engine always speaks first", () => {
    // 90s is the engine's ASK_REQUEST_TIMEOUT_MS. Below it, the client steals
    // the failure and mislabels it; above ~100s, Cloudflare kills the origin
    // and the body is an unparseable HTML 524.
    expect(ASK_CLIENT_TIMEOUT_MS).toBeGreaterThan(90_000);
    expect(ASK_CLIENT_TIMEOUT_MS).toBeLessThan(100_000);
  });

  it("leaves the CRUD default alone — this is an Ask exception, not a raise", () => {
    expect(ENGINE_FETCH_TIMEOUT_MS).toBe(15_000);
  });
});
