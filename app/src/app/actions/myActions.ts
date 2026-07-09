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
 * TENANT/USER ISOLATION (R5): ownership is derived from the SESSION identity
 * (userId), never from request input. A missing identity yields an empty list,
 * never a fall-through to another user's or the whole org's actions.
 */

export type ActionOwned = { owner_user_id: string | null };

/**
 * Keep only actions owned by the signed-in user. `sessionUserId` MUST come from
 * the session, never from a query/body param. Undefined identity → empty (fail
 * closed), never the unfiltered set.
 */
export function filterMyActions<T extends ActionOwned>(
  actions: T[],
  sessionUserId: string | undefined,
): T[] {
  if (!sessionUserId) return [];
  return actions.filter((a) => a.owner_user_id !== null && a.owner_user_id === sessionUserId);
}

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
