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

/**
 * pendingReviewTile — pure selection of the dashboard's governance-review callout.
 *
 * WHY (count-scope audit, 2026-07-20): three surfaces count the SAME predicate
 * (operational_status='remediated' AND decision_state non-terminal) at two scopes:
 * the org-wide population (dashboard tile, ops "Ready to Close" = 5) and the
 * reviewer-scoped subset (review_owner=me = 1). The dashboard tile showed the
 * ORG-WIDE number under the PERSONAL queue's label ("Pending Independent Review"),
 * so a reviewer read "5 assigned to me" when their queue held 1. This helper makes
 * the scope explicit and testable:
 *
 *   - personal — the viewer has reviews assigned (mine > 0) AND the independent-
 *     review queue exists (flag on): lead with THEIR number, link THEIR queue,
 *     show the org-wide total as labeled context.
 *   - org — otherwise, when the org-wide population is non-empty: the leadership
 *     tile, explicitly labeled organization-wide, linking the org-wide queue.
 *   - null — nothing to surface (tile hidden; unchanged gate).
 *
 * `mine` is null when the session has no user identity (API-key callers) or the
 * findings summary fetch failed — an honest unknown, never treated as zero for
 * the personal variant.
 */
export type PendingReviewTile =
  | { variant: "personal"; mine: number; orgWide: number; href: string }
  | { variant: "org"; orgWide: number; href: string };

export function pendingReviewTile(
  orgWide: number,
  mine: number | null,
  independentReviewOn: boolean,
): PendingReviewTile | null {
  if (independentReviewOn && mine !== null && mine > 0) {
    return {
      variant: "personal",
      mine,
      orgWide,
      href: "/findings?bucket=pending_independent_review",
    };
  }
  if (orgWide > 0) {
    return { variant: "org", orgWide, href: "/findings?bucket=ready_to_close" };
  }
  return null;
}
