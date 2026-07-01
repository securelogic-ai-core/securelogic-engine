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
