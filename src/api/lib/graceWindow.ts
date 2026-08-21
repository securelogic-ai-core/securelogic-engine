/**
 * graceWindow.ts — is this organization inside its payment-failure grace
 * period, and when does that grace end?
 *
 * WHY THIS IS A PURE FUNCTION IN ITS OWN FILE. Three different surfaces have to
 * agree about grace, and they cannot each carry their own arithmetic:
 *
 *   - the DUNNING EMAILS (PR-B) decide whether they may tell a customer
 *     "your access continues until DATE" or must say "your access has been
 *     suspended". A template that hard-codes the optimistic wording would
 *     promise continued access that the platform is not actually providing —
 *     the promise must be derived from the same rule that enforces it, or it
 *     is a lie waiting to happen;
 *   - request-time ENFORCEMENT (PR-F) reads it in attachOrganizationContext,
 *     which already SELECTs payment_failed_at, so grace costs no extra query;
 *   - the reconciling SWEEP (PR-F) reads it to decide which notification is due
 *     and when the backstop bites.
 *
 * Because enforcement is DERIVED at read time rather than materialised by a
 * job, no missed, late or duplicated sweep can leave a customer wrongly
 * entitled. That is the property that lets the sweep be a small in-process
 * worker instead of dedicated infrastructure.
 *
 * THE CLOCK IS STRIPE'S. `payment_failed_at` is stamped from the Stripe event's
 * `created` timestamp and holds the FIRST failure of the cycle (ruling R1), so
 * grace is measured from when the failure actually happened, not from when we
 * processed it and not from the latest retry. Retries do not move it; only a
 * successful payment clears it.
 */

/** Terminal Stripe subscription states: dunning is over, whatever the clock says. */
const TERMINAL_SUBSCRIPTION_STATUSES = new Set([
  "canceled",
  "unpaid",
  "incomplete_expired",
]);

export type GraceState = "healthy" | "in_grace" | "lapsed";

export interface GraceInputs {
  /** organizations.payment_failed_at — the cycle start, or null when healthy. */
  paymentFailedAt: Date | string | null | undefined;
  /** organizations.stripe_subscription_status, when known. */
  subscriptionStatus?: string | null | undefined;
}

/** Default grace window in days. Matches the 2-week Stripe retry window + 1. */
export const DEFAULT_GRACE_DAYS = 15;

/**
 * Master switch. OFF by default: with the flag off the platform behaves exactly
 * as it does today — the `past_due` webhook downgrades immediately and there is
 * no grace — and every consumer of graceState() sees `lapsed`, so no email can
 * promise access the platform is not granting.
 */
export function graceEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env["SECURELOGIC_BILLING_GRACE_ENABLED"] === "true";
}

/**
 * Grace length in days. Configurable because it must match the Stripe Dashboard
 * retry window, which lives outside this repo and can be changed there without
 * a deploy. An unset, unparseable or non-positive value falls back to the
 * default rather than producing a zero-day window by accident.
 */
export function graceDays(env: NodeJS.ProcessEnv = process.env): number {
  const raw = parseInt(env["SECURELOGIC_BILLING_GRACE_DAYS"] ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_GRACE_DAYS;
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * When grace ends for this cycle, or null when the org is not in a cycle.
 * Returns a date even when the flag is off, so copy and diagnostics can talk
 * about the window that WOULD apply — callers must still gate on graceState.
 */
export function graceEndsAt(
  input: GraceInputs,
  env: NodeJS.ProcessEnv = process.env
): Date | null {
  const start = toDate(input.paymentFailedAt);
  if (!start) return null;
  return new Date(start.getTime() + graceDays(env) * 86_400_000);
}

/**
 * The single grace decision.
 *
 * healthy   — no open payment failure.
 * in_grace  — a failure is open, the window has not elapsed, and Stripe has not
 *             reached a terminal state. Full access (ruling P2).
 * lapsed    — the window elapsed, or Stripe reached a terminal state, or the
 *             grace mechanism is not deployed.
 *
 * Terminal status beats the clock in BOTH directions: a subscription Stripe has
 * already canceled is lapsed even on day 1, because dunning is genuinely over.
 */
export function graceState(
  input: GraceInputs,
  now: Date = new Date(),
  env: NodeJS.ProcessEnv = process.env
): GraceState {
  const start = toDate(input.paymentFailedAt);
  if (!start) return "healthy";

  const status = (input.subscriptionStatus ?? "").trim();
  if (TERMINAL_SUBSCRIPTION_STATUSES.has(status)) return "lapsed";

  // Flag off = today's behaviour, which is zero grace. Deliberately evaluated
  // AFTER the healthy check so a healthy org is never reported as lapsed.
  if (!graceEnabled(env)) return "lapsed";

  const endsAt = new Date(start.getTime() + graceDays(env) * 86_400_000);
  return now.getTime() < endsAt.getTime() ? "in_grace" : "lapsed";
}
