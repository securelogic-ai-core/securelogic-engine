/**
 * workflowRecommendations.ts — Slice 6 (S6): the pure workflow-automation core.
 * Given a persisted applicability decision, it derives the WORKFLOW ACTIONS the
 * platform should take — as RECOMMENDATIONS, deterministically, with idempotency
 * keys — but executes nothing. I/O-free: no DB, no notifications, no risk mutation.
 *
 * AD-9 (hard boundary): risk CREATION and lifecycle TRANSITIONS stay human/lifecycle-
 * gated. This engine only SUGGESTS/FLAGS/DRAFTS — it emits a `risk_review_recommendation`,
 * never a `risk_open`/`risk_transition`. AD-8a: recommendations are the human-review
 * projection of the assessment (each carries the assessment's content_hash).
 *
 * Idempotency (DONE bar): every recommendation carries an `idempotency_key` derived
 * from the decision's content_hash + action type + target, so a later dispatcher can
 * apply "at most once" — re-deriving from the same stored decision yields identical
 * keys, and a NEW decision (new content_hash) yields new keys. The live dispatcher
 * (write suggestion / enqueue action / send notification) is a later flag-gated
 * adapter; this slice is the deterministic decision→work mapping only.
 */

import { createHash } from "crypto";

import type { StoredAssessment } from "./explainability.js";
import type { ApplicabilityDecision } from "./types.js";

export const RECOMMENDATION_TYPES = [
  "finding_draft",
  "risk_review_recommendation",
  "evidence_request",
  "human_review_task",
  "notification"
] as const;
export type RecommendationType = (typeof RECOMMENDATION_TYPES)[number];

export const PRIORITIES = ["high", "medium", "low"] as const;
export type Priority = (typeof PRIORITIES)[number];

export interface RecommendationTarget {
  /** 'target' = the matched vendor/ai_system/etc.; 'entity' = a blast-radius node. */
  kind: "target" | "entity";
  ref_type: string;
  ref_id: string;
}

export interface WorkflowRecommendation {
  type: RecommendationType;
  priority: Priority;
  target: RecommendationTarget;
  rationale: string;
  /** Stable at-most-once key: content_hash + type + target. */
  idempotency_key: string;
}

/** Versioned governance of which decisions produce which recommendation kinds. */
export interface WorkflowPolicy {
  policy_version: string;
  /** Decisions that produce actionable workflow (others produce nothing). */
  actionable: Record<ApplicabilityDecision, boolean>;
}

export const DEFAULT_WORKFLOW_POLICY: WorkflowPolicy = {
  policy_version: "workflow-v1.0.0",
  actionable: {
    affected: true,
    potentially_affected: true,
    needs_review: true,
    not_affected: false,
    unknown: false
  }
};

function bandToPriority(band: StoredAssessment["confidence_band"]): Priority {
  return band === "high" ? "high" : band === "medium" ? "medium" : "low";
}

function idempotencyKey(contentHash: string, type: RecommendationType, target: RecommendationTarget): string {
  return createHash("sha256")
    .update(`${contentHash}|${type}|${target.kind}:${target.ref_type}:${target.ref_id}`, "utf8")
    .digest("hex");
}

function rec(
  a: StoredAssessment,
  type: RecommendationType,
  priority: Priority,
  target: RecommendationTarget,
  rationale: string
): WorkflowRecommendation {
  return { type, priority, target, rationale, idempotency_key: idempotencyKey(a.content_hash, type, target) };
}

/**
 * Derive the deterministic set of workflow recommendations for a stored decision.
 * Pure; the ordering is stable (grouped by type, blast-radius nodes sorted).
 */
export function deriveWorkflowRecommendations(
  a: StoredAssessment,
  policy: WorkflowPolicy = DEFAULT_WORKFLOW_POLICY
): WorkflowRecommendation[] {
  if (!policy.actionable[a.decision]) return [];

  const out: WorkflowRecommendation[] = [];
  const priority = bandToPriority(a.confidence_band);
  const primaryTarget: RecommendationTarget = { kind: "target", ref_type: a.target_type, ref_id: a.target_id };

  // Identity nodes in the blast radius = owners/people to notify (deterministic order).
  const identities = a.affected_entities
    .filter((e) => e.node_type === "identity")
    .map((e) => e.node_id)
    .sort();

  if (a.decision === "affected") {
    // Draft a finding, recommend a risk review (NOT auto-open — AD-9), request evidence.
    out.push(rec(a, "finding_draft", priority, primaryTarget, `Applicability=affected (${a.confidence}%) — draft a finding for review.`));
    out.push(rec(a, "risk_review_recommendation", priority, primaryTarget, "Affected with reachable impact — recommend risk review (human-gated)."));
    out.push(rec(a, "evidence_request", priority, primaryTarget, "Collect corroborating evidence for the affected target."));
    // Notify each affected owner; fall back to a single target-scoped notification.
    if (identities.length > 0) {
      for (const id of identities) {
        out.push(rec(a, "notification", priority, { kind: "entity", ref_type: "identity", ref_id: id }, "Owner of an affected downstream entity."));
      }
    } else {
      out.push(rec(a, "notification", priority, primaryTarget, "No downstream owner resolved — notify the target owner."));
    }
  } else if (a.decision === "potentially_affected") {
    // Projection for human accept/dismiss (AD-8a) + a lower-key notification.
    out.push(rec(a, "human_review_task", priority, primaryTarget, `Applicability=potentially_affected (${a.confidence}%) — route to human review.`));
    out.push(rec(a, "notification", "low", primaryTarget, "Potential applicability — informational notice."));
  } else if (a.decision === "needs_review") {
    // Matched but unscored — analyst must quantify.
    out.push(rec(a, "human_review_task", "medium", primaryTarget, "Matched but not automatically scored — analyst review required."));
  }

  return out;
}
