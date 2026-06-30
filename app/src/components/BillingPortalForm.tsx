"use client";

import { useRef, useState } from "react";
import { createSubmitGuard } from "./billingPortalSubmit";

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
 * native form submission in some browsers, which made the first click appear to
 * do nothing and forced users to click again. Instead:
 *   - the FIRST submit always proceeds natively (no preventDefault, button never
 *     disabled), so a single click reliably fires the POST + 303; and
 *   - pending state is conveyed purely via the label + aria-busy; and
 *   - genuine duplicate submits (rapid double-click before navigation lands) are
 *     blocked by preventDefault()-ing the 2nd+ submit via a ref-held guard.
 *
 * Progressive enhancement: with JS disabled, onSubmit never runs and the form
 * still submits and redirects normally.
 */
export function BillingPortalForm({
  label,
  buttonClassName,
  formClassName,
  pendingLabel = "Opening billing…",
}: {
  label: string;
  buttonClassName: string;
  formClassName?: string;
  pendingLabel?: string;
}) {
  const [pending, setPending] = useState(false);
  // One guard per mounted form instance; persists across re-renders.
  const guardRef = useRef<ReturnType<typeof createSubmitGuard> | null>(null);
  if (guardRef.current === null) {
    guardRef.current = createSubmitGuard();
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    if (!guardRef.current!.shouldProceed()) {
      // Already submitting — block the duplicate POST. We do NOT disable the
      // button (that can cancel the in-flight native submission); preventDefault
      // on the later submit is the safe way to dedupe.
      event.preventDefault();
      return;
    }
    // First submit: let the native POST proceed; only reflect pending visually.
    setPending(true);
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
    </form>
  );
}
