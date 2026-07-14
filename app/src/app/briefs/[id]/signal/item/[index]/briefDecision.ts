/**
 * briefDecision.ts — pure logic for the Brief → Decision flow (ERIP
 * launch-readiness, PR-B). Dependency-free (no React/fetch) so it is
 * unit-testable without a DOM/RTL harness the app does not have.
 *
 * A Brief item is derived from an external signal (`cyber_signal_id`). When the
 * org has a Finding for that signal, the brief routes the reader straight into the
 * Decision Workspace. When it does not, the reader can CREATE one (promotion).
 *
 * Promotion exists because the automated path only creates a finding when a signal
 * matches a vendor or AI system already in the org's registry — so a reader could
 * open a Brief item about anything else and have nowhere to take it. This used to
 * point at /queue ("Review suggested links"), which was a dead end: /queue accepts
 * suggested signal↔entity LINKS and has never created a Finding. It sent the reader
 * somewhere that could not do the thing the link implied.
 *
 * DARK behind SECURELOGIC_DECISION_WORKSPACE_ENABLED; flag-off shows no
 * affordance (byte-identical brief item).
 */

export type BriefDecisionAffordance =
  | { state: "linked"; findingId: string; href: string }
  /** No finding yet — the reader can promote this signal into one. */
  | { state: "promotable"; signalId: string };

/**
 * Resolve the decision affordance for a brief item from its (already org-scoped)
 * related finding lookup. A finding → deep-link into its Decision Workspace; none →
 * offer to create one from this signal.
 *
 * `signalId` is the item's cyber_signal_id — the caller only reaches this function
 * when shouldResolveBriefDecision() has already established it is present.
 */
export function briefDecisionAffordance(
  relatedFinding: { id: string } | null | undefined,
  signalId: string,
): BriefDecisionAffordance {
  if (relatedFinding && relatedFinding.id) {
    return { state: "linked", findingId: relatedFinding.id, href: `/findings/${relatedFinding.id}` };
  }
  return { state: "promotable", signalId };
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

/**
 * D5 — Brief → Intelligence Event bridge. Once a brief item is linked to a finding,
 * the finding context already carries the supporting Intelligence Event(s) (resolved
 * across the signal↔event bridge). Pick the first resolvable event id so the brief
 * can offer a direct drill-through, closing the brief → event path without any new
 * engine route or a signal→event lookup. Returns null → no link (honest degrade:
 * no finding, no event data, or Intelligence Events dark).
 */
export function briefSupportingEventId(
  context: { intelligence?: { events?: Array<Record<string, unknown>> } } | null | undefined,
): string | null {
  const events = context?.intelligence?.events;
  if (!Array.isArray(events)) return null;
  for (const e of events) {
    if (e && typeof e["id"] === "string" && (e["id"] as string).length > 0) return e["id"] as string;
  }
  return null;
}
