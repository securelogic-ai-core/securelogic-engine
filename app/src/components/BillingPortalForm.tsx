"use client";

import { useState } from "react";

/**
 * Manage/Update Billing CTA.
 *
 * Wraps the native <form method="POST" action="/api/billing/portal"> so we can
 * give the user immediate pending feedback on the first click. The Stripe
 * portal round-trip (BFF route → engine → Stripe) can take several seconds; with
 * a plain submit button the page gives no visual signal, so users tap a second
 * time believing the first click was ignored.
 *
 * Mechanism: onSubmit flips a local pending flag WITHOUT preventDefault, so the
 * browser still performs the native POST and the route's 303 redirect is
 * unchanged. The component unmounts when that navigation lands (success → Stripe;
 * error → /account), which also clears the pending state.
 *
 * NOTE on useFormStatus: useFormStatus().pending only engages for React form
 * *Actions* (function actions). These forms intentionally keep a string action
 * for a native POST + server 303 redirect, for which useFormStatus never reports
 * pending — hence the local useState flag here instead.
 *
 * Progressive enhancement: with JS disabled, onSubmit never runs and the form
 * still submits and redirects normally; the button simply never shows the
 * pending label.
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

  return (
    <form
      action="/api/billing/portal"
      method="POST"
      className={formClassName}
      onSubmit={() => setPending(true)}
    >
      <button
        type="submit"
        disabled={pending}
        aria-busy={pending}
        className={buttonClassName}
      >
        {pending ? pendingLabel : label}
      </button>
    </form>
  );
}
