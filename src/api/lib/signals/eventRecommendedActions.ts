/**
 * eventRecommendedActions.ts — pure recommended-action derivation for a canonical
 * Intelligence Event. Intelligence Pipeline Hardening (item 8).
 *
 * Deterministic, explainable guidance derived from the event's lifecycle state,
 * severity, and affected entity — surfaced by the API/UI alongside the event.
 * No I/O.
 */

import type { LifecycleState } from "./intelligenceEventLifecycle.js";

export interface RecommendedActionInput {
  readonly status: LifecycleState;
  readonly severity: string;
  readonly affected_vendor: string | null;
  readonly affected_cve: string | null;
  /** Whether the viewing org has a finding for this event. */
  readonly hasFinding: boolean;
}

export interface RecommendedAction {
  readonly action: string;
  readonly urgency: "immediate" | "near_term" | "planned" | "watch";
}

/** Derive an ordered list of recommended actions (most urgent first). */
export function recommendedActions(input: RecommendedActionInput): RecommendedAction[] {
  const out: RecommendedAction[] = [];

  if (input.status === "actively_exploited") {
    out.push({
      action: input.affected_cve
        ? `Prioritize remediation of ${input.affected_cve} — active exploitation reported.`
        : "Prioritize remediation — active exploitation reported.",
      urgency: "immediate"
    });
  }

  if (input.status === "mitigated") {
    out.push({ action: "Apply the available patch or mitigation and verify coverage.", urgency: "near_term" });
  }

  if (input.affected_vendor) {
    out.push({
      action: `Review exposure to ${input.affected_vendor} across the vendor and asset inventory.`,
      urgency: input.severity === "Critical" ? "near_term" : "planned"
    });
  }

  if (!input.hasFinding && (input.severity === "Critical" || input.severity === "High")) {
    out.push({ action: "Open a tracked finding to own remediation and evidence.", urgency: "planned" });
  }

  if (input.status === "new" || input.status === "corroborating") {
    out.push({ action: "Monitor for corroboration and confirmation before acting.", urgency: "watch" });
  }

  if (out.length === 0) {
    out.push({ action: "No action required; monitor for changes.", urgency: "watch" });
  }
  return out;
}
