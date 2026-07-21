/**
 * decisionTransitions.ts — client-side mirror of the finding decision-state
 * machine (docs/specs/finding-lifecycle-spec.md §4; server authority is
 * src/api/lib/findingLifecycle.ts — the engine 409s anything illegal, this
 * module only keeps the dropdown honest so it never OFFERS a move the server
 * will reject: no dead controls).
 *
 *   needs_review → mitigating          (accept plan)
 *   any          → accepted_risk       (audited governance override)
 *   *            → resolved            (close) — only when the DERIVED
 *                                      operational_status is 'remediated'
 *                                      or the risk is already accepted
 *   resolved     → needs_review        (reopen)
 *
 * Pure + dependency-free so it is unit-testable like workQueues.ts.
 */

export const DECISION_STATES = [
  "needs_review",
  "mitigating",
  "accepted_risk",
  "resolved",
] as const;
export type DecisionState = (typeof DECISION_STATES)[number];

export function isDecisionState(v: string | null | undefined): v is DecisionState {
  return typeof v === "string" && (DECISION_STATES as readonly string[]).includes(v);
}

/**
 * The decision states legally reachable FROM `current`, given the finding's
 * derived operational_status. Always includes `current` itself (the select's
 * controlled value). Unknown/legacy current states offer no moves (fail-safe —
 * the server would 409 them anyway).
 */
export function legalDecisionTargets(
  current: string | null | undefined,
  operationalStatus: string | null | undefined
): DecisionState[] {
  if (!isDecisionState(current)) return [];

  const targets = new Set<DecisionState>([current]);

  if (current === "needs_review") targets.add("mitigating");
  if (current !== "accepted_risk") targets.add("accepted_risk");
  if (current === "resolved") targets.add("needs_review");

  const closeAllowed =
    current !== "resolved" &&
    (operationalStatus === "remediated" || current === "accepted_risk");
  if (closeAllowed) targets.add("resolved");

  // Stable presentation order.
  return DECISION_STATES.filter((s) => targets.has(s));
}
