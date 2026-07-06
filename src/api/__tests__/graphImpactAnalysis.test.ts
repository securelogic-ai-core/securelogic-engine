/**
 * graphImpactAnalysis.test.ts — ERIP E7: the pure impact analysis + the
 * LLM-grounded answer (fake client). Deterministic; grounding enforced.
 */

import { describe, expect, it } from "vitest";
import { analyzeGraphImpact, type EnrichedNode } from "../lib/graphImpactAnalysis.js";
import { buildDeterministicAnswer, answerGraphQuestion } from "../lib/graphNlAnswer.js";
import type { GraphEdgeLike } from "../lib/blastRadiusSummary.js";
import type { RawLlmClient } from "../lib/llm/llmService.js";

function node(node_id: string, depth: number, own_risk: number, criticality: string | null, label: string | null): EnrichedNode {
  return { node_type: node_id === "root" ? "asset" : "vendor", node_id, depth, own_risk, criticality, label };
}
const edge: GraphEdgeLike = { from_type: "asset", from_id: "root", to_type: "vendor", to_id: "v1" };

describe("analyzeGraphImpact", () => {
  it("computes blast radius, dependencies, at-risk deps, and business impact", () => {
    const a = analyzeGraphImpact(
      [
        node("root", 0, 0, "critical", "App"),
        node("v1", 1, 90, "critical", "Vendor One"),
        node("v2", 1, 0, "low", "Vendor Two")
      ],
      [edge]
    );
    expect(a.blast_radius.reachable_count).toBe(2);
    expect(a.dependencies[0]).toMatchObject({ node_id: "v1", own_risk: 90 }); // highest own-risk first
    expect(a.at_risk_dependencies).toHaveLength(1);
    // worst = 90 * 1.0 (critical) + breadth lift → high/critical band.
    expect(a.business_impact_score).toBeGreaterThanOrEqual(80);
    expect(a.business_impact_band).toBe("critical");
  });

  it("no at-risk dependencies → zero business impact", () => {
    const a = analyzeGraphImpact([node("root", 0, 0, null, "App"), node("v1", 1, 0, "low", "V")], [edge]);
    expect(a.at_risk_dependencies).toEqual([]);
    expect(a.business_impact_score).toBe(0);
    expect(a.business_impact_band).toBe("none");
  });

  it("criticality weights the worst dependency", () => {
    const critical = analyzeGraphImpact([node("root", 0, 0, null, "A"), node("v", 1, 80, "critical", "V")], [edge]);
    const low = analyzeGraphImpact([node("root", 0, 0, null, "A"), node("v", 1, 80, "low", "V")], [edge]);
    expect(critical.business_impact_score).toBeGreaterThan(low.business_impact_score);
  });
});

const ANALYSIS = analyzeGraphImpact(
  [node("root", 0, 0, "critical", "Billing App"), node("v1", 1, 90, "critical", "Auth Vendor")],
  [edge]
);

describe("buildDeterministicAnswer", () => {
  it("states the blast radius, at-risk deps, and business impact, grounded in labels", () => {
    const ans = buildDeterministicAnswer("Billing App", "what's the blast radius?", ANALYSIS);
    expect(ans.source).toBe("deterministic");
    expect(ans.answer).toContain("Billing App");
    expect(ans.answer).toContain("Auth Vendor");
    expect(ans.citations).toEqual(expect.arrayContaining(["Billing App", "Auth Vendor"]));
  });
});

describe("answerGraphQuestion", () => {
  function llm(reply: string): RawLlmClient {
    return { messages: { create: async () => ({ content: [{ type: "text", text: reply }], stop_reason: "end_turn", model: "claude-sonnet-4-6" }) } };
  }

  it("returns deterministic when the client is null", async () => {
    const a = await answerGraphQuestion("Billing App", "impact?", ANALYSIS, { client: null });
    expect(a.source).toBe("deterministic");
  });

  it("uses the LLM and keeps only grounded citations", async () => {
    const reply = JSON.stringify({
      answer: "A compromise of Auth Vendor would cascade to Billing App.",
      citations: ["Auth Vendor", "Billing App", "Ghost Node Not In Graph"]
    });
    const a = await answerGraphQuestion("Billing App", "what is the blast radius of Auth Vendor?", ANALYSIS, { client: llm(reply) });
    expect(a.source).toBe("llm");
    expect(a.citations).toEqual(expect.arrayContaining(["Auth Vendor", "Billing App"]));
    expect(a.citations).not.toContain("Ghost Node Not In Graph"); // ungrounded dropped
  });

  it("degrades to deterministic on unparseable LLM output", async () => {
    const a = await answerGraphQuestion("Billing App", "impact?", ANALYSIS, { client: llm("no json") });
    expect(a.source).toBe("deterministic");
  });

  it("empty question → deterministic (no LLM call)", async () => {
    const a = await answerGraphQuestion("Billing App", "   ", ANALYSIS, { client: llm("{}") });
    expect(a.source).toBe("deterministic");
  });
});
