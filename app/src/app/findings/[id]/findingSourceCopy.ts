/**
 * findingSourceCopy.ts — source-aware copy for the Decision Workspace (ERIP
 * launch-readiness, PR-C). Dependency-free (no React) so it is unit-testable
 * without a DOM/RTL harness the app does not have.
 *
 * Empty zones should explain themselves in terms of WHERE the finding came from:
 * an assessment-sourced finding legitimately has no external intelligence, while
 * a signal-sourced one that shows none is genuinely awaiting a link. Generic
 * "None" text reads as a defect; source-aware text reads as an answer.
 *
 * Used only inside the Decision Workspace (SECURELOGIC_DECISION_WORKSPACE_ENABLED),
 * so flag-off is unaffected.
 */

const SOURCE_LABELS: Record<string, string> = {
  vendor_review: "vendor assessment",
  control_test: "control test",
  obligation_review: "obligation review",
  ai_review: "AI review",
  ai_governance_review: "AI governance review",
  assessment: "assessment",
  manual: "manual entry",
  risk: "risk register entry",
  signal: "external intelligence signal",
  cyber_signal: "external intelligence signal",
  intelligence_event: "intelligence event",
};

/** Whether a finding's source is external threat/vulnerability intelligence. */
export function isIntelligenceSourced(sourceType: string): boolean {
  return sourceType === "signal" || sourceType === "cyber_signal" || sourceType === "intelligence_event";
}

/** Friendly label for a finding's source_type (falls back to a de-slugged form). */
export function findingSourceLabel(sourceType: string): string {
  return SOURCE_LABELS[sourceType] ?? sourceType.replace(/[._]/g, " ");
}

/**
 * Source-aware empty state for the "supporting intelligence events" zone. An
 * intelligence-sourced finding awaits a link; any other source has no external
 * intelligence by nature.
 */
export function intelligenceEmptyCopy(sourceType: string): string {
  if (isIntelligenceSourced(sourceType)) {
    return "No intelligence event is linked to this finding yet.";
  }
  return `This finding comes from a ${findingSourceLabel(sourceType)} — external threat intelligence isn't expected for this source.`;
}

/**
 * Source-aware empty state for the recommendation zone: nudge toward the right
 * kind of remediation guidance for where the finding came from.
 */
export function recommendationEmptyCopy(sourceType: string): string {
  if (isIntelligenceSourced(sourceType)) {
    return "No recommendation recorded yet — assess exposure to the linked intelligence and add remediation guidance.";
  }
  return `No recommendation recorded yet — add remediation guidance based on this ${findingSourceLabel(sourceType)}.`;
}
