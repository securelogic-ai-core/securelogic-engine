/**
 * myActions.ts — pure logic for the minimal "My Actions" view (ERIP Package 3.3,
 * PR-5). Dependency-free (no React/fetch) so it is unit-testable without a
 * DOM/RTL harness the app does not have.
 *
 * When the Decision Workspace is on, /actions is reframed as "My Actions" — the
 * signed-in user's own remediation actions across findings — instead of the
 * org-wide standalone list. This is a BRIDGE, deliberately NOT the P3.4
 * saved-views system.
 *
 * TENANT/USER ISOLATION (R5): ownership is derived from the SESSION identity,
 * never from request input. That filter now lives in the ENGINE (`?owner=me`,
 * resolved server-side by resolveOwnerMeFilter and applied in SQL) rather than
 * here. A client-side helper that filtered an already-fetched page used to do it,
 * and it silently dropped a user's own work whenever the org had more actions
 * than the engine's 100-row page cap. It is deliberately NOT re-added: filtering a
 * capped page can only ever under-report.
 */

/** The remediation-queue scopes the workspace supports. */
export type ActionScope = "mine" | "team";

/** A view param is a recognized scope only for these values. */
export function actionScope(view: string | undefined): ActionScope | null {
  return view === "mine" || view === "team" ? view : null;
}

/**
 * Redirect target for a bare /actions when the Decision Workspace is on: the
 * canonical My Actions form. Returns null when no redirect is needed (already on a
 * recognized scope — ?view=mine (own) or ?view=team (all open) — or the workspace
 * is dark → legacy list).
 */
export function myActionsRedirect(workspace: boolean, view: string | undefined): string | null {
  if (workspace && actionScope(view) === null) return "/actions?view=mine";
  return null;
}

/** Whether the current render is the workspace remediation view (either scope). */
export function isMyActionsView(workspace: boolean, view: string | undefined): boolean {
  return workspace && actionScope(view) !== null;
}

/**
 * Build the destination for an ORG-WIDE Actions count (the dashboard/posture
 * "open / in progress / overdue / view all" links). The dashboard counts are
 * org-wide, so their links must land on the org-wide list — NOT the session
 * user's "My Actions".
 *
 * Appending `view=team` (the recognized "All open" scope) guarantees that:
 *   - workspace ON  → renders the org-wide "All open" remediation view directly,
 *     bypassing the bare-/actions → `?view=mine` redirect that otherwise scoped
 *     an enterprise-wide count down to the caller's own handful of actions;
 *   - workspace OFF → `view=team` is inert (the legacy list ignores it) while any
 *     `status`/`overdue` filter is still honored — byte-identical legacy behavior.
 * So the same URL reconciles the count with its destination in BOTH flag states.
 */
export function orgActionsHref(filter?: {
  status?: string;
  overdue?: boolean;
  active?: boolean;
}): string {
  const params = new URLSearchParams();
  if (filter?.status) params.set("status", filter.status);
  if (filter?.overdue) params.set("overdue", "true");
  // `active` is what an ACTIVE count links to. `view=team` alone only widened the
  // scope to the org — it applied no status filter — so a tile reading "N active
  // actions" landed on a list that also contained closed and accepted ones. There
  // was no URL that could reproduce the number the tile displayed.
  if (filter?.active) params.set("active", "true");
  params.set("view", "team");
  return `/actions?${params.toString()}`;
}

/**
 * Honest pagination disclosure for a capped list: returns "Showing N of M" when
 * the rendered slice is smaller than the true total, else null (nothing to
 * disclose). Kills silent truncation where a page shows ≤100 rows under a header
 * that claims the full count.
 */
export function showingOfTotal(shown: number, total: number | undefined): string | null {
  if (typeof total !== "number" || total <= shown) return null;
  return `Showing ${shown} of ${total}`;
}
