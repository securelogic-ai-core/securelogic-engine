/**
 * contentHash.test.ts — determinism, chain, and tamper-evidence proofs for the
 * pure content-hash helper (AD-16 reproducibility). Database-free.
 */

import { createHash } from "crypto";
import { describe, expect, it } from "vitest";

import {
  serializeCanonical,
  computeContentHash,
  verifyChain,
  GENESIS_PREV_HASH,
  type AssessmentIdentity,
  type EvidenceSnapshot
} from "../contentHash.js";
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
    { rule_id: "R_inputs", inputs_considered: "1 candidate", outcome: "normalized" },
    { rule_id: "R1_strong_match_reachable", inputs_considered: "tier=strong", outcome: "decision=affected" }
  ],
  affected_entities: [
    { node_type: "application", node_id: "app-1", min_depth: 1, via_target_type: "vendor", via_target_id: "vendor-acme" },
    { node_type: "identity", node_id: "owner-1", min_depth: 2, via_target_type: "vendor", via_target_id: "vendor-acme" }
  ],
  engine_version: "iae-v1.0.0",
  schema_version: "applicability-result.v1"
};

const evidence: EvidenceSnapshot[] = [
  { evidence_type: "match_candidate", ref_table: "signal_match_suggestions", ref_id: "m-1", captured_value: '{"match_score":92}', weight: 1 },
  { evidence_type: "graph_edge", ref_table: "enterprise_relationships", ref_id: "e-1", captured_value: '{"rel":"supplies"}', weight: null }
];

describe("serializeCanonical", () => {
  it("is deterministic across repeated calls", () => {
    expect(serializeCanonical(identity, result, evidence)).toBe(serializeCanonical(identity, result, evidence));
  });

  it("is stable under affected_entities / evidence input reordering (sorted internally)", () => {
    const shuffled: ApplicabilityResult = { ...result, affected_entities: [result.affected_entities[1], result.affected_entities[0]] };
    const evShuffled = [evidence[1], evidence[0]];
    expect(serializeCanonical(identity, shuffled, evShuffled)).toBe(serializeCanonical(identity, result, evidence));
  });

  it("changes when genuine content changes", () => {
    const changed: ApplicabilityResult = { ...result, decision: "not_affected" };
    expect(serializeCanonical(identity, changed, evidence)).not.toBe(serializeCanonical(identity, result, evidence));
  });

  it("cannot be forged by delimiter injection in a field value", () => {
    const a: AssessmentIdentity = { ...identity, signal_id: "sig-1|vendor" };
    const b: AssessmentIdentity = { ...identity, signal_id: "sig-1", target_id: "vendor|vendor-acme" };
    expect(serializeCanonical(a, result, evidence)).not.toBe(serializeCanonical(b, result, evidence));
  });
});

describe("computeContentHash", () => {
  it("matches an independently-computed sha256 over the canonical string (known vector)", () => {
    const canonical = serializeCanonical(identity, result, evidence);
    const expected = createHash("sha256").update(`${canonical}|prev:${GENESIS_PREV_HASH}`, "utf8").digest("hex");
    expect(computeContentHash(identity, result, evidence, GENESIS_PREV_HASH)).toBe(expected);
  });

  it("is a 64-char hex string", () => {
    expect(computeContentHash(identity, result, evidence, GENESIS_PREV_HASH)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("depends on prev_hash (chaining)", () => {
    const h1 = computeContentHash(identity, result, evidence, GENESIS_PREV_HASH);
    const h2 = computeContentHash(identity, result, evidence, "a".repeat(64));
    expect(h1).not.toBe(h2);
  });
});

describe("verifyChain", () => {
  function link(prevHash: string, r: ApplicabilityResult) {
    return {
      identity,
      result: r,
      evidence,
      prev_hash: prevHash,
      content_hash: computeContentHash(identity, r, evidence, prevHash)
    };
  }

  it("verifies a well-formed 3-link chain (returns -1)", () => {
    const l1 = link(GENESIS_PREV_HASH, result);
    const l2 = link(l1.content_hash, { ...result, decision: "potentially_affected" });
    const l3 = link(l2.content_hash, { ...result, decision: "not_affected" });
    expect(verifyChain([l1, l2, l3])).toBe(-1);
  });

  it("detects tampering: mutating link 1's content breaks the chain at link 1", () => {
    const l1 = link(GENESIS_PREV_HASH, result);
    const l2 = link(l1.content_hash, { ...result, decision: "potentially_affected" });
    // Attacker edits l1's stored decision but cannot recompute the whole downstream chain.
    const tampered = { ...l1, result: { ...result, decision: "not_affected" as const } };
    expect(verifyChain([tampered, l2])).toBe(0);
  });

  it("detects a broken prev_hash link (returns the first bad index)", () => {
    const l1 = link(GENESIS_PREV_HASH, result);
    const l2 = link("f".repeat(64), { ...result, decision: "not_affected" }); // wrong predecessor
    expect(verifyChain([l1, l2])).toBe(1);
  });

  it("empty chain verifies", () => {
    expect(verifyChain([])).toBe(-1);
  });
});
