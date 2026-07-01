/**
 * Pending / duplicate-submit state model for the native billing-portal form
 * (see BillingPortalForm.tsx). Pure and React-free so the transitions can be
 * unit-tested in node (mirrors the api/billing/portal/retry.ts split).
 *
 * Background — the "stuck on Opening billing…" bug (Sprint 3H):
 * The Manage/Update Billing CTA is a native <form method="POST"> that relies on
 * the browser performing a real top-level POST and following the route's 303.
 * On a cold/slow engine the server round-trip can take many seconds (engineFetch
 * aborts at 15s and the route retries the transient class up to ~49s total),
 * during which the browser simply waits — the button sits in "Opening billing…"
 * with no client-side timeout. The previous guard was ALSO single-use per
 * mounted form, so a second click during that window was preventDefault()-ed and
 * did nothing; the only escape was a full page refresh.
 *
 * This model fixes both:
 *   - a submit while a request is already in flight ("pending") is still blocked
 *     as a duplicate (rapid double-click protection); but
 *   - a client-side watchdog moves "pending" → "timedout" after
 *     PORTAL_PENDING_TIMEOUT_MS, which re-arms the CTA (a subsequent submit
 *     proceeds) and lets the component surface a concise retry message — so the
 *     UI never stays indefinitely in the pending state and never needs a refresh.
 *
 * We still NEVER disable the submit button (disabling it synchronously inside
 * onSubmit can suppress the native submission — the original single-click bug);
 * pending is conveyed purely via the label + aria-busy.
 */

export type PortalSubmitPhase = "idle" | "pending" | "timedout";

export interface PortalSubmitDecision {
  /** True → let the native POST proceed; false → caller must preventDefault(). */
  proceed: boolean;
  /** Phase to store after this submit decision. */
  nextPhase: PortalSubmitPhase;
}

/**
 * Decide whether a submit should fire the native POST, given the current phase.
 *   - "idle" / "timedout" → proceed (fires the POST), move to "pending".
 *   - "pending"           → block (a request is already in flight): duplicate.
 *
 * A single click therefore always fires exactly one POST, and — crucially — the
 * CTA becomes usable again after a timeout ("timedout" proceeds) without a
 * refresh.
 */
export function decidePortalSubmit(phase: PortalSubmitPhase): PortalSubmitDecision {
  if (phase === "pending") return { proceed: false, nextPhase: "pending" };
  return { proceed: true, nextPhase: "pending" };
}

/**
 * Phase after the pending watchdog elapses without the page having navigated
 * away: reset "pending" → "timedout" so the CTA re-arms and a retry message can
 * show. Any non-pending phase is returned unchanged (a stale/leftover timer is a
 * no-op — e.g. it fired after the request already resolved).
 */
export function phaseAfterPendingTimeout(phase: PortalSubmitPhase): PortalSubmitPhase {
  return phase === "pending" ? "timedout" : phase;
}

/**
 * How long the CTA may show the pending state before auto-resetting (ms).
 * Comfortably longer than a warm round-trip (which navigates away and unmounts
 * the form, clearing the timer) yet bounded so the button never hangs
 * indefinitely on a cold/slow engine. Kept just past one engineFetch attempt
 * (15s) so a single successful cold attempt still navigates before the reset.
 */
export const PORTAL_PENDING_TIMEOUT_MS = 16000;

/**
 * What the client should do with the billing-portal response.
 *   - navigate: `window.location.assign(url)` to the Stripe portal.
 *   - login:    session expired → send to /login.
 *   - retry:    transient/failed → reset the CTA and show the retry message.
 */
export type PortalAction =
  | { kind: "navigate"; url: string }
  | { kind: "login" }
  | { kind: "retry" };

/**
 * Pure interpretation of the `/api/billing/portal` XHR response.
 *
 * This is the heart of the Sprint 3H follow-up fix: the CTA now takes explicit
 * client control of navigation (fetch → this decision → `window.location.assign`)
 * instead of relying on the browser to follow a native cross-origin 303 — which
 * was non-deterministic on the first click. Kept pure so single-click behavior
 * is unit-tested in node without a DOM.
 *
 *   - 200 with a non-empty `url` → navigate (the one-click success path).
 *   - 401                        → login (session gone).
 *   - anything else              → retry (server error / transient / no url).
 */
export function interpretPortalResponse(
  status: number,
  body: { url?: string; error?: string }
): PortalAction {
  if (status === 200 && typeof body.url === "string" && body.url.length > 0) {
    return { kind: "navigate", url: body.url };
  }
  if (status === 401) return { kind: "login" };
  return { kind: "retry" };
}
