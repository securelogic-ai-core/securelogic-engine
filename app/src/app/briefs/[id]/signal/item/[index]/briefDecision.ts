/**
 * briefDecision.ts — pure logic for the Brief → Decision flow (ERIP
 * launch-readiness, PR-B). Dependency-free (no React/fetch) so it is
 * unit-testable without a DOM/RTL harness the app does not have.
 *
 * A Brief item is derived from an external signal (`cyber_signal_id`). When the
 * org has a Finding for that signal, the brief should route the reader straight
 * into the Decision Workspace; when it does not, it should say so honestly and
 * offer the correct next action (Review Suggested Links, where signals become
 * linked findings) rather than leaving the user to search manually.
 *
 * DARK behind SECURELOGIC_DECISION_WORKSPACE_ENABLED; flag-off shows no
 * affordance (byte-identical brief item).
 */

export type BriefDecisionAffordance =
  | { state: "linked"; findingId: string; href: string }
  | { state: "no_finding"; href: string };

/**
 * Resolve the decision affordance for a brief item from its (already
 * org-scoped) related finding lookup. A finding → deep-link into its Decision
 * Workspace; none → point at Review Suggested Links.
 */
export function briefDecisionAffordance(
  relatedFinding: { id: string } | null | undefined,
): BriefDecisionAffordance {
  if (relatedFinding && relatedFinding.id) {
    return { state: "linked", findingId: relatedFinding.id, href: `/findings/${relatedFinding.id}` };
  }
  return { state: "no_finding", href: "/queue" };
}

/**
 * Whether to attempt the decision affordance at all: only when the workspace is
 * on AND the item carries a signal id we can resolve a finding from.
 */
export function shouldResolveBriefDecision(
  workspace: boolean,
  cyberSignalId: string | null | undefined,
): boolean {
  return workspace && typeof cyberSignalId === "string" && cyberSignalId.length > 0;
}
