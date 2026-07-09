/**
 * decisionTabs.ts — the Decision Workspace tab model (ERIP Package 3.3, PR-4).
 * Dependency-free (no React) so the tab identity/default are unit-testable
 * without a DOM/RTL harness the app does not have; the component's tab strip is
 * a thin wrapper over these values.
 *
 * Executive zones (A–C) stay always-visible ABOVE the tabs. The tabs split the
 * detail body: Overview (affected context, evidence & intelligence, related
 * findings, activity) and Remediation (recommendation + remediation actions).
 */

export type DecisionTab = "overview" | "remediation";

export const DECISION_TABS: ReadonlyArray<{ id: DecisionTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "remediation", label: "Remediation" },
];

/** The tab shown on first render. */
export const DEFAULT_DECISION_TAB: DecisionTab = "overview";

export function isDecisionTab(v: string): v is DecisionTab {
  return v === "overview" || v === "remediation";
}
