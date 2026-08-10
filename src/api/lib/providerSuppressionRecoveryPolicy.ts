/**
 * providerSuppressionRecoveryPolicy.ts — who is allowed to clear a suppression
 * on the mail provider, and from where.
 *
 * WHY THIS IS NOT JUST A FEATURE FLAG
 * -----------------------------------
 * Production, staging and demo share ONE Resend account (an identical
 * RESEND_API_KEY on every sending service — verified per service, not assumed).
 * There is therefore no such thing as "clearing the staging suppression": a
 * DELETE issued from staging lifts the block that production is relying on, for
 * a real customer, with no trace in production's logs.
 *
 * That makes this the rare destructive action whose blast radius is not
 * contained by the environment it runs in. Every other admin mutation in this
 * codebase writes to its own database; this one reaches into shared
 * third-party state. So it is gated twice, by two facts that fail independently:
 *
 *   1. ENVIRONMENT IDENTITY — `APP_ENV` must be exactly `production`.
 *      Reuses `currentEmailEnvironment()` from the P1-2 isolation work rather
 *      than re-deriving "am I prod", so there is one answer to that question in
 *      the codebase. Unset or unrecognised resolves to `unknown`, never to
 *      production: absence of proof is not proof.
 *
 *   2. EXPLICIT OPERATOR INTENT — `SECURELOGIC_EMAIL_SUPPRESSION_RECOVERY_ENABLED`
 *      must be exactly "true", set per service. Default off everywhere,
 *      including production.
 *
 * WHAT TWO FACTORS ACTUALLY BUY
 * -----------------------------
 * Be honest about this: `APP_ENV` is self-declared configuration, not a
 * cryptographic proof of identity. A service told it is production will claim to
 * be production. What the pairing buys is that no SINGLE misconfiguration is
 * sufficient:
 *
 *   - staging accidentally granted the flag still cannot clear (APP_ENV=staging),
 *   - a service accidentally labelled production still cannot clear (flag off),
 *   - a service with neither set cannot clear (both fail),
 *   - and the capability is dormant in production itself until an operator turns
 *     it on deliberately.
 *
 * Both values bind at DEPLOY on Render, not at restart, so neither is casually
 * flipped, and changing either requires the same privilege as changing the
 * Resend key itself. This does not defend against an attacker who already
 * controls service configuration — at that point they hold the provider API key
 * directly and do not need this endpoint.
 *
 * The residual, and it is inherent rather than a defect here: clearing from
 * production still mutates the account staging and demo read from. Only
 * environment-separated Resend credentials can fix that. What this policy
 * guarantees is that exactly ONE designated context can perform the mutation,
 * and production is the correct one because production is where real customers
 * are stranded and where the provider's only webhook points.
 */

import { currentEmailEnvironment } from "../infra/emailEnvironment.js";

/** The one environment permitted to mutate shared provider suppression state. */
const MUTATION_ENVIRONMENT = "production";

export const RECOVERY_FLAG = "SECURELOGIC_EMAIL_SUPPRESSION_RECOVERY_ENABLED";

export type RecoveryAuthorization =
  | { allowed: true }
  | {
      allowed: false;
      /** Stable machine-readable reason, surfaced to the operator verbatim. */
      reason:
        | "provider_mutation_not_permitted_in_environment"
        | "provider_suppression_recovery_disabled";
      /** Operator-facing explanation of exactly what to change. */
      detail: string;
    };

export function recoveryFlagEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env[RECOVERY_FLAG] === "true";
}

/**
 * May THIS process clear a suppression on the shared provider account?
 *
 * Order matters: the environment check runs first so that a staging service is
 * told it is the wrong environment, rather than being told to go turn a flag on
 * — which is precisely the mistake this exists to prevent.
 */
export function recoveryAuthorization(
  env: NodeJS.ProcessEnv = process.env
): RecoveryAuthorization {
  const environment = currentEmailEnvironment();

  if (environment !== MUTATION_ENVIRONMENT) {
    return {
      allowed: false,
      reason: "provider_mutation_not_permitted_in_environment",
      detail:
        `This service reports APP_ENV="${environment}". Provider suppressions are ` +
        `account-level and shared across production, staging and demo, so clearing ` +
        `one here would lift a block that production depends on. Run this against ` +
        `the production engine.`
    };
  }

  if (!recoveryFlagEnabled(env)) {
    return {
      allowed: false,
      reason: "provider_suppression_recovery_disabled",
      detail:
        `Recovery is disabled on this service. Set ${RECOVERY_FLAG}=true to enable ` +
        `it. It is off by default even in production because the mutation is not ` +
        `reversible from inside the product.`
    };
  }

  return { allowed: true };
}
