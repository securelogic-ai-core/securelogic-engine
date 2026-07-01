"use client";

import { useEffect, useRef, useState } from "react";
import {
  decidePortalSubmit,
  phaseAfterPendingTimeout,
  PORTAL_PENDING_TIMEOUT_MS,
  type PortalSubmitPhase,
} from "./billingPortalSubmit";

/**
 * Manage/Update Billing CTA.
 *
 * Wraps the native <form method="POST" action="/api/billing/portal"> so the
 * browser performs a real top-level POST and follows the route's 303 redirect
 * (success → Stripe portal; error → /account). The Stripe round-trip can take
 * several seconds, so we give immediate pending feedback on the first click.
 *
 * Single-click correctness (see ./billingPortalSubmit.ts):
 * We must NOT use the button's `disabled` attribute to gate submission —
 * disabling a submit button synchronously inside onSubmit can suppress the
 * browser's native submission, which made the first click appear to do nothing
 * and forced users to click again. Instead the FIRST submit always proceeds
 * natively (no preventDefault, button never disabled) and pending is conveyed
 * purely via the label + aria-busy; genuine duplicate submits (a rapid 2nd click
 * before navigation lands) are blocked by preventDefault()-ing them.
 *
 * Never-stuck guarantee (Sprint 3H): a client-side watchdog auto-resets the
 * pending state after PORTAL_PENDING_TIMEOUT_MS. On a cold/slow engine the native
 * POST can stay in flight for many seconds; rather than sit indefinitely in
 * "Opening billing…", the CTA returns to a usable state, re-arms (a subsequent
 * click fires a fresh POST — no page refresh needed), and shows a concise retry
 * message. A successful/failed response navigates away first, unmounting the
 * form and clearing the timer, so the watchdog only ever fires on a genuine hang.
 *
 * Progressive enhancement: with JS disabled, onSubmit never runs and the form
 * still submits and redirects normally (the route returns a 303).
 */
export function BillingPortalForm({
  label,
  buttonClassName,
  formClassName,
  pendingLabel = "Opening billing…",
  retryMessage = "Billing is taking longer than expected. Please click to try again.",
  retryClassName,
}: {
  label: string;
  buttonClassName: string;
  formClassName?: string;
  pendingLabel?: string;
  retryMessage?: string;
  retryClassName?: string;
}) {
  const [pending, setPending] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  // Synchronous phase, read inside onSubmit to decide preventDefault; the
  // useState values above drive the visual only.
  const phaseRef = useRef<PortalSubmitPhase>("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear the watchdog if the form unmounts (e.g. a successful 303 navigation).
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, []);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    const { proceed, nextPhase } = decidePortalSubmit(phaseRef.current);
    if (!proceed) {
      // A request is already in flight — block the duplicate POST. We do NOT
      // disable the button (that can cancel the in-flight native submission);
      // preventDefault on the later submit is the safe way to dedupe.
      event.preventDefault();
      return;
    }

    phaseRef.current = nextPhase; // "pending"
    setPending(true);
    setTimedOut(false);

    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      // Still here after the timeout → the native POST is hanging (cold/slow
      // engine). Re-arm the CTA and surface a retry message so the UI never
      // stays indefinitely in the pending state and never needs a refresh.
      phaseRef.current = phaseAfterPendingTimeout(phaseRef.current); // "timedout"
      setPending(false);
      setTimedOut(true);
      timerRef.current = null;
    }, PORTAL_PENDING_TIMEOUT_MS);

    // First/again submit: let the native POST + 303 proceed (no preventDefault).
  }

  return (
    <form
      action="/api/billing/portal"
      method="POST"
      className={formClassName}
      onSubmit={handleSubmit}
    >
      <button
        type="submit"
        aria-busy={pending}
        data-pending={pending ? "true" : undefined}
        className={buttonClassName}
      >
        {pending ? pendingLabel : label}
      </button>
      {timedOut && (
        <p
          role="status"
          aria-live="polite"
          data-portal-retry="true"
          className={retryClassName}
          style={
            retryClassName
              ? undefined
              : { marginTop: 8, fontSize: 12, lineHeight: 1.4, color: "#b45309" }
          }
        >
          {retryMessage}
        </p>
      )}
    </form>
  );
}
