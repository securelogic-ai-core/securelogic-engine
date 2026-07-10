/**
 * dashboardState.ts — pure selection of which posture panel the dashboard renders.
 *
 * WHY (workflow-consistency Phase 2): the dashboard summary fetch returns `null`
 * on FAILURE but a zeros-object when the org genuinely has no data yet. The page
 * rendered the posture panel with `dashboardSummary && (…)`, so a failed load
 * silently dropped the entire panel — indistinguishable from "all clear / nothing
 * to show." A user could not tell "your data couldn't load" from "you have no
 * findings." This helper makes that distinction explicit and testable.
 *
 *   - non-platform user            → "sample"  (upsell/sample dashboard)
 *   - platform user, summary loaded → "posture" (real panel; zeros render honestly)
 *   - platform user, load FAILED    → "error"   (explicit "couldn't load" panel)
 *
 * `summaryLoaded` is `true` when the summary fetch returned an object (even an
 * all-zero one — that is a real, empty-by-design state), `false` only when the
 * fetch failed (null).
 */

export type DashboardPanel = "sample" | "posture" | "error";

export function dashboardPanel(isPlatformUser: boolean, summaryLoaded: boolean): DashboardPanel {
  if (!isPlatformUser) return "sample";
  return summaryLoaded ? "posture" : "error";
}
