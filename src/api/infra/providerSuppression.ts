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
 * FAILURE POSTURE: FAIL OPEN — FOR THE READ PATH ONLY
 * ---------------------------------------------------
 * Any outcome that is not a definite "yes, suppressed" resolves to `unknown`,
 * and callers treat `unknown` as "go ahead and send". A provider blip, a
 * timeout or a changed API shape must never block a legitimate signup from
 * getting its verification mail — the cost of a wasted send is one bounce, the
 * cost of a false block is a customer who cannot create an account at all.
 * This mirrors the fail-open suppression check already documented in
 * `infra/email.ts`.
 *
 * The RECOVERY path at the bottom of this file inverts that posture
 * deliberately: it fails CLOSED. Read the comment there before "fixing" the
 * inconsistency — it is load-bearing, not an oversight.
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

/* ─────────────────────────────────────────────────────────────────────────────
 * RECOVERY PATH — reading the suppression RECORD, and clearing it.
 *
 * FAILURE POSTURE HERE IS THE OPPOSITE: FAIL CLOSED.
 *
 * `getProviderSuppression` above fails open because the cost of being wrong is
 * one wasted send. Down here the cost of being wrong is deleting shared
 * provider state on a guess, so anything we are not certain about resolves to
 * `unavailable` and the caller must refuse to act. "We could not read the list"
 * must never be allowed to look like "there is nothing to worry about".
 *
 * These functions do NOT enforce the environment boundary — that is
 * `lib/providerSuppressionRecoveryPolicy.ts`, checked by the route before
 * anything here is called. Keeping the policy out of the transport layer means
 * the guard is visible at the surface an operator actually hits, rather than
 * buried three files deep.
 * ────────────────────────────────────────────────────────────────────────── */

/** Bounded like the lookup: a provider stall must not hold an admin request. */
const MUTATION_TIMEOUT_MS = 5000;

export type ProviderSuppressionRecord = {
  /** The provider's own identifier — what DELETE is addressed to. */
  id: string;
  /** Why the provider suppressed it ("bounce", "complaint", …), if given. */
  origin: string | null;
  createdAt: string | null;
};

export type ProviderSuppressionLookup =
  /** The provider holds a suppression AND told us its identifier. */
  | { outcome: "suppressed"; record: ProviderSuppressionRecord }
  /** The provider explicitly has no suppression for this address. */
  | { outcome: "clear" }
  /** We could not find out, or could not parse what we were told. */
  | { outcome: "unavailable"; detail: string };

/**
 * Read the full suppression RECORD for an address, not just its status.
 *
 * Separate from `getProviderSuppression` rather than replacing it: that
 * function is on the signup hot path, its three-state contract is depended on
 * by `customerAuth.ts`, and it deliberately never parses a response body. This
 * one must parse, because the identifier only exists in the body — and a parse
 * that throws here becomes `unavailable`, which is safe, whereas the same
 * change applied to the signup path would turn provider hiccups into blocked
 * signups.
 */
export async function lookupProviderSuppressionRecord(
  email: string
): Promise<ProviderSuppressionLookup> {
  const address = email?.trim();
  if (!address) {
    return { outcome: "unavailable", detail: "No address supplied." };
  }

  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) {
    return {
      outcome: "unavailable",
      detail: "No RESEND_API_KEY is configured on this service."
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MUTATION_TIMEOUT_MS);

  try {
    const res = await fetch(
      `https://api.resend.com/suppressions/${encodeURIComponent(address)}`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${key}` },
        signal: controller.signal
      }
    );

    if (res.status === 404) return { outcome: "clear" };

    if (res.status !== 200) {
      logger.warn(
        { event: "provider_suppression_record_unexpected", status: res.status },
        "Unexpected status reading provider suppression record"
      );
      return {
        outcome: "unavailable",
        detail: `Provider returned HTTP ${res.status}.`
      };
    }

    const body = (await res.json()) as Record<string, unknown> | null;
    const id = typeof body?.["id"] === "string" ? (body["id"] as string) : null;

    // A 200 whose body carries no usable identifier is NOT "clear" and is not
    // actionable either: we know the address is blocked but cannot name the
    // record to remove. Fail closed rather than fall back to guessing, which
    // is what a shape change at the provider would look like.
    if (!id) {
      logger.warn(
        { event: "provider_suppression_record_unparseable" },
        "Provider reported a suppression without an identifier"
      );
      return {
        outcome: "unavailable",
        detail:
          "Provider reported a suppression but returned no identifier for it; " +
          "the response shape may have changed."
      };
    }

    return {
      outcome: "suppressed",
      record: {
        id,
        origin: typeof body?.["origin"] === "string" ? (body["origin"] as string) : null,
        createdAt:
          typeof body?.["created_at"] === "string" ? (body["created_at"] as string) : null
      }
    };
  } catch (err) {
    logger.warn(
      { event: "provider_suppression_record_failed", err },
      "Could not read provider suppression record — failing closed"
    );
    return {
      outcome: "unavailable",
      detail: "Provider request failed or timed out."
    };
  } finally {
    clearTimeout(timer);
  }
}

export type ProviderSuppressionDeletion =
  | { outcome: "deleted" }
  /** The provider says there is no such record — someone else already cleared it. */
  | { outcome: "already_absent" }
  | { outcome: "failed"; detail: string };

/**
 * Delete one suppression by the provider's own identifier.
 *
 * Addressed by id rather than by email on purpose: the id is what the caller
 * confirmed against a fresh read, so a suppression created between that read
 * and this call — the address bouncing again — has a different id and is left
 * alone. Deleting by email would silently clear the newer block instead.
 */
export async function deleteProviderSuppression(
  suppressionId: string
): Promise<ProviderSuppressionDeletion> {
  const id = suppressionId?.trim();
  if (!id) return { outcome: "failed", detail: "No suppression id supplied." };

  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) {
    return {
      outcome: "failed",
      detail: "No RESEND_API_KEY is configured on this service."
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MUTATION_TIMEOUT_MS);

  try {
    const res = await fetch(
      `https://api.resend.com/suppressions/${encodeURIComponent(id)}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${key}` },
        signal: controller.signal
      }
    );

    if (res.status === 200 || res.status === 202 || res.status === 204) {
      logger.info(
        { event: "provider_suppression_deleted" },
        "Cleared a suppression on the mail provider"
      );
      return { outcome: "deleted" };
    }

    if (res.status === 404) return { outcome: "already_absent" };

    logger.error(
      { event: "provider_suppression_delete_rejected", status: res.status },
      "Provider refused the suppression delete"
    );
    return { outcome: "failed", detail: `Provider returned HTTP ${res.status}.` };
  } catch (err) {
    // Ambiguous by nature: the DELETE may or may not have been applied. Say so
    // rather than reporting either success or a clean failure.
    logger.error(
      { event: "provider_suppression_delete_failed", err },
      "Provider suppression delete failed or timed out"
    );
    return {
      outcome: "failed",
      detail:
        "Provider request failed or timed out; it is not known whether the " +
        "delete was applied. Re-read before retrying."
    };
  } finally {
    clearTimeout(timer);
  }
}
