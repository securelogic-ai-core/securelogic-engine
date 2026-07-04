/**
 * workflowRecommendations.test.ts — S6: the pure workflow-derivation core, incl. the
 * idempotency property (the DONE bar). Database-free.
 */

import { describe, expect, it } from "vitest";

import {
  deriveWorkflowRecommendations,
  DEFAULT_WORKFLOW_POLICY,
  type WorkflowRecommendation
} from "../workflowRecommendations.js";
import type { StoredAssessment } from "../explainability.js";
import { computeContentHash, type AssessmentIdentity, type EvidenceSnapshot } from "../contentHash.js";
import type { ApplicabilityResult, ApplicabilityDecision } from "../types.js";

const identity: AssessmentIdentity = {
  organization_id: "org-1",
  signal_id: "sig-1",
  target_type: "vendor",
  target_id: "vendor-acme"
};
const evidence: EvidenceSnapshot[] = [
  { evidence_type: "match_candidate", ref_table: "signal_match_suggestions", ref_id: "m-1", captured_value: "{}", weight: 1 }
];

function stored(decision: ApplicabilityDecision, overrides: Partial<StoredAssessment> = {}): StoredAssessment {
  const result: ApplicabilityResult = {
    decision,
    confidence: 90,
    confidence_band: "high",
    reasoning_steps: [{ rule_id: "R1", inputs_considered: "x", outcome: decision }],
    affected_entities: [
      { node_type: "application", node_id: "app-1", min_depth: 1, via_target_type: "vendor", via_target_id: "vendor-acme" },
      { node_type: "identity", node_id: "owner-1", min_depth: 2, via_target_type: "vendor", via_target_id: "vendor-acme" }
    ],
    engine_version: "iae-v1.0.0",
    schema_version: "applicability-result.v1"
  };
  const content_hash = computeContentHash(identity, result, evidence, "0".repeat(64));
  return {
    ...identity,
    decision,
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

const types = (r: WorkflowRecommendation[]) => r.map((x) => x.type);

describe("deriveWorkflowRecommendations — decision mapping", () => {
  it("affected -> finding_draft + risk_review_recommendation + evidence_request + owner notification", () => {
    const r = deriveWorkflowRecommendations(stored("affected"));
    expect(types(r)).toEqual(["finding_draft", "risk_review_recommendation", "evidence_request", "notification"]);
    // notification targets the affected identity owner
    const notif = r.find((x) => x.type === "notification")!;
    expect(notif.target).toEqual({ kind: "entity", ref_type: "identity", ref_id: "owner-1" });
  });

  it("NEVER emits a risk_open / risk_transition (AD-9 — human-gated)", () => {
    const r = deriveWorkflowRecommendations(stored("affected"));
    expect(types(r)).not.toContain("risk_open");
    expect(types(r)).not.toContain("risk_transition");
    expect(r.some((x) => x.type === "risk_review_recommendation")).toBe(true);
  });

  it("potentially_affected -> human_review_task + informational notification", () => {
    expect(types(deriveWorkflowRecommendations(stored("potentially_affected")))).toEqual(["human_review_task", "notification"]);
  });

  it("needs_review -> a single human_review_task (medium)", () => {
    const r = deriveWorkflowRecommendations(stored("needs_review"));
    expect(types(r)).toEqual(["human_review_task"]);
    expect(r[0].priority).toBe("medium");
  });

  it("not_affected and unknown -> no workflow", () => {
    expect(deriveWorkflowRecommendations(stored("not_affected"))).toEqual([]);
    expect(deriveWorkflowRecommendations(stored("unknown"))).toEqual([]);
  });

  it("falls back to a target-scoped notification when no owner identity is in the blast radius", () => {
    const noOwner = stored("affected", {
      affected_entities: [
        { node_type: "application", node_id: "app-1", min_depth: 1, via_target_type: "vendor", via_target_id: "vendor-acme" }
      ]
    });
    const notif = deriveWorkflowRecommendations(noOwner).find((x) => x.type === "notification")!;
    expect(notif.target).toEqual({ kind: "target", ref_type: "vendor", ref_id: "vendor-acme" });
  });

  it("priority follows the confidence band", () => {
    expect(deriveWorkflowRecommendations(stored("affected", { confidence_band: "medium" }))[0].priority).toBe("medium");
    expect(deriveWorkflowRecommendations(stored("affected", { confidence_band: "low" }))[0].priority).toBe("low");
  });
});

describe("deriveWorkflowRecommendations — idempotency (DONE bar)", () => {
  it("re-deriving from the same stored decision yields identical idempotency keys", () => {
    const a = stored("affected");
    const k1 = deriveWorkflowRecommendations(a).map((x) => x.idempotency_key);
    const k2 = deriveWorkflowRecommendations(a).map((x) => x.idempotency_key);
    expect(k1).toEqual(k2);
  });

  it("keys are unique per (type, target) within one decision", () => {
    const keys = deriveWorkflowRecommendations(stored("affected")).map((x) => x.idempotency_key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("a NEW decision (different content_hash) yields DIFFERENT keys", () => {
    const a = stored("affected");
    const b = stored("affected", { content_hash: "f".repeat(64) });
    const ka = deriveWorkflowRecommendations(a).map((x) => x.idempotency_key).sort();
    const kb = deriveWorkflowRecommendations(b).map((x) => x.idempotency_key).sort();
    for (const k of ka) expect(kb).not.toContain(k);
  });

  it("keys are 64-char hex", () => {
    for (const r of deriveWorkflowRecommendations(stored("affected"))) {
      expect(r.idempotency_key).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});

describe("policy gating", () => {
  it("a policy that marks affected non-actionable produces nothing", () => {
    const policy = { ...DEFAULT_WORKFLOW_POLICY, actionable: { ...DEFAULT_WORKFLOW_POLICY.actionable, affected: false } };
    expect(deriveWorkflowRecommendations(stored("affected"), policy)).toEqual([]);
  });
});
