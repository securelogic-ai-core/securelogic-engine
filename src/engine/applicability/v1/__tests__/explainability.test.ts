/**
 * explainability.test.ts — S5: the pure explainability layer renders an
 * auditor-defensible explanation from stored decision data. Database-free.
 */

import { describe, expect, it } from "vitest";

import { explainAssessment, renderExplanationText, type StoredAssessment } from "../explainability.js";
import { computeContentHash, type AssessmentIdentity, type EvidenceSnapshot } from "../contentHash.js";
import type { ApplicabilityResult } from "../types.js";

const identity: AssessmentIdentity = {
  organization_id: "org-1",
  signal_id: "sig-1",
  target_type: "vendor",
  target_id: "vendor-acme"
};

const result: ApplicabilityResult = {
  decision: "affected",
  confidence: 92,
  confidence_band: "high",
  reasoning_steps: [
    { rule_id: "R_inputs", inputs_considered: "1 candidate, top_score=92", outcome: "normalized" },
    { rule_id: "R1_strong_match_reachable", inputs_considered: "tier=strong, reachable=true", outcome: "decision=affected" }
  ],
  affected_entities: [
    { node_type: "application", node_id: "app-1", min_depth: 1, via_target_type: "vendor", via_target_id: "vendor-acme" },
    { node_type: "application", node_id: "app-2", min_depth: 2, via_target_type: "vendor", via_target_id: "vendor-acme" },
    { node_type: "identity", node_id: "owner-1", min_depth: 2, via_target_type: "vendor", via_target_id: "vendor-acme" }
  ],
  engine_version: "iae-v1.0.0",
  schema_version: "applicability-result.v1"
};

const evidence: EvidenceSnapshot[] = [
  { evidence_type: "match_candidate", ref_table: "signal_match_suggestions", ref_id: "m-1", captured_value: '{"s":92}', weight: 1 },
  { evidence_type: "graph_edge", ref_table: "enterprise_relationships", ref_id: "e-1", captured_value: '{"rel":"supplies"}', weight: null }
];

function stored(overrides: Partial<StoredAssessment> = {}): StoredAssessment {
  const content_hash = computeContentHash(identity, result, evidence, "0".repeat(64));
  return {
    ...identity,
    decision: result.decision,
    confidence: result.confidence,
    confidence_band: result.confidence_band,
    reasoning_steps: result.reasoning_steps,
    affected_entities: result.affected_entities,
    evidence,
    engine_version: result.engine_version,
    schema_version: result.schema_version,
    content_hash,
    prev_hash: "0".repeat(64),
    ...overrides
  };
}

describe("explainAssessment", () => {
  it("headline states decision, confidence, and downstream reach", () => {
    const x = explainAssessment(stored());
    expect(x.headline).toContain("applies to your environment");
    expect(x.headline).toContain("92%");
    expect(x.headline).toContain("3 downstream entities");
  });

  it("renders the ordered reasoning chain from stored steps", () => {
    const x = explainAssessment(stored());
    expect(x.reasoning_chain).toHaveLength(2);
    expect(x.reasoning_chain[0]).toBe("1. [R_inputs] 1 candidate, top_score=92 → normalized");
    expect(x.reasoning_chain[1]).toContain("[R1_strong_match_reachable]");
  });

  it("groups blast radius by node_type with shallowest depth", () => {
    const x = explainAssessment(stored());
    expect(x.affected_count).toBe(3);
    expect(x.blast_radius).toEqual([
      { node_type: "application", count: 2, min_depth: 1 },
      { node_type: "identity", count: 1, min_depth: 2 }
    ]);
  });

  it("categorizes evidence used and reports none missing when both categories present", () => {
    const x = explainAssessment(stored());
    expect(x.evidence_used).toEqual([
      { category: "match", count: 1, types: ["match_candidate"] },
      { category: "graph_reachability", count: 1, types: ["graph_edge"] }
    ]);
    expect(x.evidence_missing).toEqual([]);
  });

  it("reports graph_reachability missing when only match evidence exists", () => {
    const x = explainAssessment(stored({ evidence: [evidence[0]] }));
    expect(x.evidence_used.map((e) => e.category)).toEqual(["match"]);
    expect(x.evidence_missing).toEqual(["graph_reachability"]);
  });

  it("reproducibility.reproduces is true for an untampered stored decision", () => {
    expect(explainAssessment(stored()).reproducibility.reproduces).toBe(true);
  });

  it("reproducibility.reproduces is FALSE when the stored content_hash was tampered", () => {
    const x = explainAssessment(stored({ content_hash: "deadbeef".repeat(8) }));
    expect(x.reproducibility.reproduces).toBe(false);
  });

  it("reproducibility.reproduces is FALSE when a reasoning step was altered post-hoc", () => {
    // content_hash reflects the ORIGINAL steps; altering the stored steps must break re-derivation.
    const tampered = stored({
      reasoning_steps: [{ rule_id: "R_inputs", inputs_considered: "FORGED", outcome: "normalized" }, result.reasoning_steps[1]]
    });
    expect(explainAssessment(tampered).reproducibility.reproduces).toBe(false);
  });

  it("is deterministic (same stored row → deep-equal explanation)", () => {
    expect(explainAssessment(stored())).toEqual(explainAssessment(stored()));
  });

  it("handles not_affected with no reach gracefully", () => {
    const na = stored({ decision: "not_affected", confidence: 80, confidence_band: "high", affected_entities: [] });
    const x = explainAssessment(na);
    expect(x.headline).toContain("does not appear to apply");
    expect(x.blast_radius).toEqual([]);
    expect(x.affected_count).toBe(0);
  });
});

describe("renderExplanationText", () => {
  it("produces a readable multi-line report including reproducibility", () => {
    const text = renderExplanationText(explainAssessment(stored()));
    expect(text).toContain("applies to your environment");
    expect(text).toContain("Reasoning:");
    expect(text).toContain("Blast radius (3):");
    expect(text).toContain("Evidence used:");
    expect(text).toContain("re-derives from stored inputs");
  });

  it("flags tampering in the rendered text", () => {
    const text = renderExplanationText(explainAssessment(stored({ content_hash: "0".repeat(64) })));
    expect(text).toContain("DOES NOT re-derive");
  });
});
