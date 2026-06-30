/**
 * Submit-guard for the native billing-portal form (see BillingPortalForm.tsx).
 *
 * Kept as a pure, React-free module so the double-submit decision can be
 * unit-tested in isolation (mirrors the api/billing/portal/retry.ts split).
 *
 * Why this exists — the "single-click" bug:
 * The Manage/Update Billing CTA is a native <form method="POST"> that relies on
 * the browser performing a real top-level POST + following the server 303. The
 * previous implementation flipped the SUBMIT BUTTON to `disabled` synchronously
 * inside onSubmit to show pending state. Disabling a submit button within the
 * same synchronous submit dispatch can suppress the browser's native submission
 * (a browser-timing-dependent React + native-form race): the button shows
 * "Opening billing…" but the POST never navigates, so the user clicks a second
 * time. We must therefore NEVER disable the button to gate it.
 *
 * Instead the component:
 *   1. always lets the FIRST native submit proceed (no preventDefault, no
 *      disabled attribute — the POST + 303 fire reliably on a single click), and
 *   2. blocks only genuine duplicate submissions (rapid double-click before the
 *      navigation lands) by preventDefault()-ing the 2nd+ submit.
 *
 * This guard encapsulates (2): the first call returns true (proceed), every
 * subsequent call returns false (block). It is intentionally stateful and
 * single-use per form instance (held in a ref).
 */

export interface SubmitGuard {
  /**
   * True for the first submission (let the native POST proceed); false for every
   * later submission (caller must preventDefault to avoid a duplicate POST).
   */
  shouldProceed(): boolean;
  /** Whether a submission has already been accepted. */
  readonly hasSubmitted: boolean;
}

/** Create a fresh single-use submit guard for one form instance. */
export function createSubmitGuard(): SubmitGuard {
  let submitted = false;
  return {
    shouldProceed() {
      if (submitted) return false;
      submitted = true;
      return true;
    },
    get hasSubmitted() {
      return submitted;
    },
  };
}
