/**
 * llmTelemetry.test.ts — token/cost/latency measurement.
 *
 * The contract that matters most here is the NEGATIVE one: an unpriced model
 * must never be reported as costing $0. Silent zeros are how cost telemetry
 * lies, and a lying cost figure is worse than none because it is trusted.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../infra/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

import {
  withLlmCallContext,
  currentLlmCallContext,
  estimateCostUsd,
  isModelPriced,
  recordLlmUsage,
  beginLlmRunAccumulation,
  endLlmRunAccumulation,
  emptyLlmRunTotals,
  resetLlmRunAccumulationForTest
} from "../lib/llm/llmTelemetry.js";
import { logger } from "../infra/logger.js";

const noTokens = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0
};

describe("estimateCostUsd", () => {
  it("prices a Sonnet 4.6 call at the published $3 / $15 per MTok", () => {
    const cost = estimateCostUsd("claude-sonnet-4-6", {
      ...noTokens,
      inputTokens: 1_000_000,
      outputTokens: 1_000_000
    });
    expect(cost).toBeCloseTo(18.0, 6);
  });

  it("prices cache reads at 0.1x input and cache writes at 1.25x input", () => {
    const cost = estimateCostUsd("claude-sonnet-4-6", {
      ...noTokens,
      cacheReadTokens: 1_000_000,
      cacheWriteTokens: 1_000_000
    });
    expect(cost).toBeCloseTo(3.0 * 0.1 + 3.0 * 1.25, 6);
  });

  it("returns NULL — never 0 — for a model with no price entry", () => {
    expect(estimateCostUsd("some-future-model", { ...noTokens, inputTokens: 5_000_000 })).toBeNull();
    expect(isModelPriced("some-future-model")).toBe(false);
  });

  it("prices every model the brief path actually calls", () => {
    // If a call site's model id changes, this fails rather than silently
    // producing unpriced calls.
    expect(isModelPriced("claude-sonnet-4-6")).toBe(true);
    expect(isModelPriced("claude-haiku-4-5")).toBe(true);
  });
});

describe("withLlmCallContext — attribution", () => {
  it("makes purpose/org visible to code running inside, including across awaits", async () => {
    expect(currentLlmCallContext()).toBeUndefined();

    await withLlmCallContext({ purpose: "brief_headline", organizationId: "org-1" }, async () => {
      expect(currentLlmCallContext()?.purpose).toBe("brief_headline");
      await Promise.resolve();
      expect(currentLlmCallContext()?.organizationId).toBe("org-1");
    });

    expect(currentLlmCallContext()).toBeUndefined();
  });

  it("keeps concurrent branches attributed to their own context", async () => {
    const seen: string[] = [];
    await Promise.all([
      withLlmCallContext({ purpose: "a", organizationId: "org-a" }, async () => {
        await new Promise((r) => setTimeout(r, 5));
        seen.push(currentLlmCallContext()!.purpose);
      }),
      withLlmCallContext({ purpose: "b", organizationId: "org-b" }, async () => {
        seen.push(currentLlmCallContext()!.purpose);
      })
    ]);
    expect(seen.sort()).toEqual(["a", "b"]);
  });
});

describe("run accumulation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetLlmRunAccumulationForTest();
  });

  it("totals tokens, latency and cost overall and per purpose", () => {
    beginLlmRunAccumulation();

    withLlmCallContext({ purpose: "brief_item_enrichment", organizationId: "org-1" }, () => {
      recordLlmUsage({
        model: "claude-sonnet-4-6",
        tokens: { ...noTokens, inputTokens: 1000, outputTokens: 500 },
        latencyMs: 1200,
        ok: true
      });
    });
    withLlmCallContext({ purpose: "brief_headline", organizationId: "org-1" }, () => {
      recordLlmUsage({
        model: "claude-sonnet-4-6",
        tokens: { ...noTokens, inputTokens: 200, outputTokens: 40 },
        latencyMs: 300,
        ok: true
      });
    });

    const totals = endLlmRunAccumulation();

    expect(totals.calls).toBe(2);
    expect(totals.input_tokens).toBe(1200);
    expect(totals.output_tokens).toBe(540);
    expect(totals.latency_ms).toBe(1500);
    expect(totals.cost_usd).toBeGreaterThan(0);
    expect(totals.by_purpose["brief_item_enrichment"]?.calls).toBe(1);
    expect(totals.by_purpose["brief_headline"]?.calls).toBe(1);
  });

  it("counts unpriced calls separately so cost_usd is never a false total", () => {
    beginLlmRunAccumulation();
    recordLlmUsage({
      model: "unpriced-model",
      tokens: { ...noTokens, inputTokens: 10_000 },
      latencyMs: 100,
      ok: true
    });
    const totals = endLlmRunAccumulation();

    expect(totals.calls).toBe(1);
    expect(totals.unpriced_calls).toBe(1);
    expect(totals.cost_usd).toBe(0); // and unpriced_calls > 0 says why
  });

  it("counts failed calls and attributes their latency, with no cost", () => {
    beginLlmRunAccumulation();
    recordLlmUsage({ model: "claude-sonnet-4-6", tokens: noTokens, latencyMs: 900, ok: false });
    const totals = endLlmRunAccumulation();

    expect(totals.failed_calls).toBe(1);
    expect(totals.latency_ms).toBe(900);
    expect(totals.cost_usd).toBe(0);
    expect(totals.unpriced_calls).toBe(1); // failure ⇒ cost unknown, not zero
  });

  it("records usage as unattributed outside any context, and never throws", () => {
    beginLlmRunAccumulation();
    expect(() =>
      recordLlmUsage({ model: "claude-sonnet-4-6", tokens: noTokens, latencyMs: 5, ok: true })
    ).not.toThrow();
    const totals = endLlmRunAccumulation();
    expect(totals.by_purpose["unattributed"]?.calls).toBe(1);
  });

  it("emits one llm_call_usage log event per call", () => {
    recordLlmUsage({
      model: "claude-sonnet-4-6",
      tokens: { ...noTokens, inputTokens: 10, outputTokens: 2 },
      latencyMs: 42,
      ok: true
    });
    const events = vi.mocked(logger.info).mock.calls.map((c) => (c[0] as { event: string }).event);
    expect(events).toContain("llm_call_usage");
  });

  it("a second begin does not clobber an active accumulation", () => {
    beginLlmRunAccumulation();
    recordLlmUsage({ model: "claude-sonnet-4-6", tokens: noTokens, latencyMs: 1, ok: true });
    beginLlmRunAccumulation(); // must be a no-op
    const totals = endLlmRunAccumulation();
    expect(totals.calls).toBe(1);
  });

  it("records nothing when no accumulation is active (logging still happens)", () => {
    recordLlmUsage({ model: "claude-sonnet-4-6", tokens: noTokens, latencyMs: 1, ok: true });
    expect(endLlmRunAccumulation()).toEqual(emptyLlmRunTotals());
  });
});
