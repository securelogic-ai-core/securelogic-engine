/**
 * predictiveNarrative.test.ts — ERIP E5b: the LLM-assisted insight overlay.
 * Fake LLM client only. Covers the deterministic fallback, the LLM-assisted
 * path, grounding enforcement (ungrounded recommendations dropped), and
 * graceful degradation on any LLM failure.
 */

import { describe, expect, it } from "vitest";
import {
  buildDeterministicNarrative,
  generatePredictiveInsights
} from "../lib/predictiveNarrative.js";
import type { StoredForecast } from "../lib/riskForecastStore.js";
import type { RawLlmClient } from "../lib/llm/llmService.js";

function fc(dimension: string, metric: "avg_risk" | "at_risk_count", trend: string, projected: number, confidence: number): StoredForecast {
  return {
    dimension,
    metric,
    horizon_days: 30,
    method: "holt_linear",
    projected_value: projected,
    trend: trend as StoredForecast["trend"],
    confidence,
    in_sample_rmse: 1,
    sample_size: 8,
    reasoning: ["fit"],
    forecast_date: "2026-07-06"
  };
}

const RISING = [
  fc("vendor", "avg_risk", "increasing", 88, 80),
  fc("endpoint", "avg_risk", "increasing", 55, 60),
  fc("cloud_resource", "avg_risk", "stable", 20, 70)
];

function llm(reply: string): RawLlmClient {
  return {
    messages: {
      create: async () => ({ content: [{ type: "text", text: reply }], stop_reason: "end_turn", model: "claude-sonnet-4-6" })
    }
  };
}

describe("buildDeterministicNarrative", () => {
  it("headlines the top rising dimension and grounds recommendations", () => {
    const n = buildDeterministicNarrative(RISING);
    expect(n.source).toBe("deterministic");
    expect(n.headline).toContain("vendor"); // highest confidence x value
    expect(n.recommendations[0]).toMatchObject({ dimension: "vendor", priority: "immediate" });
    expect(n.recommendations.every((r) => ["vendor", "endpoint"].includes(r.dimension))).toBe(true);
  });

  it("stable-only forecasts yield a no-increase headline and no recommendations", () => {
    const n = buildDeterministicNarrative([fc("vendor", "avg_risk", "stable", 30, 90)]);
    expect(n.headline).toContain("No dimension");
    expect(n.recommendations).toEqual([]);
  });
});

describe("generatePredictiveInsights", () => {
  it("returns the deterministic narrative when the client is null", async () => {
    const r = await generatePredictiveInsights(RISING, { client: null });
    expect(r.source).toBe("deterministic");
  });

  it("uses the LLM when configured and validates grounded recommendations", async () => {
    const reply = JSON.stringify({
      headline: "Vendor risk is climbing",
      narrative: "Vendor average risk is projected to reach 88.",
      recommendations: [
        { dimension: "vendor", action: "Escalate vendor reviews", priority: "immediate", rationale: "Projected 88" },
        // ungrounded dimension → must be dropped
        { dimension: "not_a_real_dimension", action: "x", priority: "planned", rationale: "y" },
        // bad priority → dropped
        { dimension: "endpoint", action: "z", priority: "someday", rationale: "w" }
      ]
    });
    const r = await generatePredictiveInsights(RISING, { client: llm(reply) });
    expect(r.source).toBe("llm");
    expect(r.headline).toBe("Vendor risk is climbing");
    expect(r.recommendations).toHaveLength(1); // only the grounded, valid one survives
    expect(r.recommendations[0]).toMatchObject({ dimension: "vendor", priority: "immediate" });
  });

  it("degrades to deterministic when the LLM returns unparseable output", async () => {
    const r = await generatePredictiveInsights(RISING, { client: llm("sorry, no json here") });
    expect(r.source).toBe("deterministic");
  });

  it("degrades to deterministic on an LLM error", async () => {
    const throwing: RawLlmClient = { messages: { create: async () => { throw new Error("boom"); } } };
    const r = await generatePredictiveInsights(RISING, { client: throwing });
    expect(r.source).toBe("deterministic");
  });
});
