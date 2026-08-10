/**
 * providerSuppression.ts — asks the mail provider whether an address is on ITS
 * suppression list.
 *
 * WHY THIS EXISTS
 * ---------------
 * Resend keeps its own account-level suppression list, entirely separate from
 * our `email_suppressions` table, and it auto-adds an address roughly one
 * second after a hard bounce. Nothing in this codebase knew that list existed.
 *
 * The consequence was found during clean-tenant onboarding validation: a tenant
 * signed up with a mistyped address, the verification mail hard-bounced, Resend
 * suppressed the address, and every later send to it was silently dropped at
 * the provider. The product reported `verification_email: "sent"` throughout,
 * because the send call does not throw for a suppressed recipient — it is
 * accepted and then discarded. The customer was permanently locked out of an
 * account we had told them was fine.
 *
 * WHAT THIS IS AND IS NOT FOR
 * ---------------------------
 * This is safe to consult at SIGNUP, where the caller has just created the
 * account and therefore already knows it exists — reporting "this address
 * cannot receive mail" leaks nothing it did not just tell us.
 *
 * It must NOT be wired into `POST /auth/resend-verification`. That endpoint
 * answers identically, and in the same time, for a real unverified user, an
 * already-verified one, and a stranger — that constancy is its entire
 * enumeration defence. A per-address deliverability verdict there would rebuild
 * the oracle it exists to prevent.
 *
 * FAILURE POSTURE: FAIL OPEN
 * --------------------------
 * Any outcome that is not a definite "yes, suppressed" resolves to `unknown`,
 * and callers treat `unknown` as "go ahead and send". A provider blip, a
 * timeout or a changed API shape must never block a legitimate signup from
 * getting its verification mail — the cost of a wasted send is one bounce, the
 * cost of a false block is a customer who cannot create an account at all.
 * This mirrors the fail-open suppression check already documented in
 * `infra/email.ts`.
 */

import { logger } from "./logger.js";

export type SuppressionStatus =
  /** The provider holds a suppression for this address; sending is futile. */
  | "suppressed"
  /** The provider explicitly has no suppression for this address. */
  | "clear"
  /** We could not find out. Callers MUST treat this as "proceed". */
  | "unknown";

/** Bounded so a provider stall cannot hold a signup request open. */
const LOOKUP_TIMEOUT_MS = 3000;

/**
 * Ask Resend whether `email` is suppressed.
 *
 * `GET /suppressions/{email}` is an exact-address lookup: 200 with the record
 * when suppressed, 404 `not_found` when not. Anything else is `unknown`.
 */
export async function getProviderSuppression(
  email: string
): Promise<SuppressionStatus> {
  const address = email?.trim();
  if (!address) return "unknown";

  const key = process.env.RESEND_API_KEY?.trim();
  // No provider configured is not "clear" — it is simply unknowable, and the
  // caller has its own `unavailable` path for that case.
  if (!key) return "unknown";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);

  try {
    const res = await fetch(
      `https://api.resend.com/suppressions/${encodeURIComponent(address)}`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${key}` },
        signal: controller.signal
      }
    );

    if (res.status === 200) {
      logger.info(
        { event: "provider_suppression_hit" },
        "Address is on the mail provider's suppression list"
      );
      return "suppressed";
    }
    if (res.status === 404) return "clear";

    logger.warn(
      { event: "provider_suppression_lookup_unexpected", status: res.status },
      "Unexpected status from provider suppression lookup — treating as unknown"
    );
    return "unknown";
  } catch (err) {
    logger.warn(
      { event: "provider_suppression_lookup_failed", err },
      "Provider suppression lookup failed — treating as unknown (fail open)"
    );
    return "unknown";
  } finally {
    clearTimeout(timer);
  }
}
