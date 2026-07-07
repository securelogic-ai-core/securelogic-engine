/**
 * eventGraphContext.test.ts — Intelligence Pipeline Hardening (item 3).
 *
 * Proves the graph "ask" reasons over canonical events: events supplied to
 * answerGraphQuestion become citable evidence (the LLM may cite a canonical_key),
 * and are ignored when not supplied. Plus the pure vendor-name extractor.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("../../infra/postgres.js", () => ({ pgElevated: { query: vi.fn() } }));

import { vendorNamesFromLabels } from "../../lib/signals/eventGraphContext.js";
import { answerGraphQuestion, type GraphEventContext } from "../../lib/graphNlAnswer.js";
import type { GraphImpactAnalysis } from "../../lib/graphImpactAnalysis.js";

const analysis: GraphImpactAnalysis = {
  blast_radius: { reachable_count: 1, by_type: { vendor: 1 }, max_depth: 1, edge_count: 1 },
  dependencies: [{ label: "Acme", node_type: "vendor", node_id: "v1", depth: 1, own_risk: 40, criticality: "high" }],
  at_risk_dependencies: [{ label: "Acme", node_type: "vendor", node_id: "v1", depth: 1, own_risk: 40, criticality: "high" }],
  business_impact_score: 42,
  business_impact_band: "moderate"
} as unknown as GraphImpactAnalysis;

const event: GraphEventContext = {
  canonical_key: "cve:CVE-2026-1234", title: "Acme Gateway RCE", severity: "Critical", status: "actively_exploited", confidence: 85
};

function fakeClientCiting(citation: string) {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: "text", text: JSON.stringify({ answer: "Acme faces an actively exploited RCE.", citations: [citation] }) }],
        model: "test"
      })
    }
  };
}

describe("vendorNamesFromLabels", () => {
  it("dedupes and lowercases, dropping nulls/blanks", () => {
    expect(vendorNamesFromLabels(["Acme", "acme", null, "  ", "Beta"])).toEqual(["acme", "beta"]);
  });
});

describe("answerGraphQuestion — canonical events as evidence", () => {
  it("accepts a citation of a supplied event canonical_key", async () => {
    const res = await answerGraphQuestion("Acme", "Is Acme exploited?", analysis, { client: fakeClientCiting("cve:CVE-2026-1234") }, [event]);
    expect(res.source).toBe("llm");
    expect(res.citations).toContain("cve:CVE-2026-1234");
  });

  it("drops an event citation when no events are supplied (ungrounded)", async () => {
    const res = await answerGraphQuestion("Acme", "Is Acme exploited?", analysis, { client: fakeClientCiting("cve:CVE-2026-1234") }, []);
    expect(res.citations).not.toContain("cve:CVE-2026-1234");
  });
});
