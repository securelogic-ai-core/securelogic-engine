import { Router } from "express";
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { getProviderSuppression } from "../infra/providerSuppression.js";

/**
 * GET /admin/email-deliverability/:email
 *
 * One answer to "why can this customer not receive our mail, and what do I do
 * about it?" — read-only.
 *
 * WHY THIS EXISTS
 * ---------------
 * Clean-tenant onboarding validation found a tenant permanently stranded: it
 * signed up with an address that hard-bounced, the mail provider suppressed the
 * address about a second later, and every subsequent send was accepted and
 * silently discarded. Diagnosing that took reading the provider's API by hand,
 * because the state lives in THREE places and no surface joined them:
 *
 *   1. the provider's own account-level suppression list (invisible to this
 *      codebase until `infra/providerSuppression.ts`),
 *   2. our `email_suppressions` table, written by the bounce webhook,
 *   3. the `users` row itself, which is what "stranded" actually means —
 *      an account that exists and can never reach `email_verified`.
 *
 * An operator answering a support ticket needs all three at once. Splitting
 * them across a provider dashboard and two admin endpoints is how the knowledge
 * stayed tribal.
 *
 * DELIBERATELY READ-ONLY
 * ----------------------
 * This route diagnoses; it does not remediate. Clearing a provider suppression
 * mutates the mail account SHARED by staging and production (both environments
 * carry an identical RESEND_API_KEY), so a clear issued from staging would lift
 * a suppression production is relying on. That is a destructive
 * cross-environment write and is deliberately out of scope here — it needs
 * either environment-separated credentials or an explicit production-only
 * guard, as its own reviewed change.
 *
 * NOT AN ENUMERATION ORACLE
 * -------------------------
 * It reports whether an account exists, which the public API is careful never
 * to do. That is safe only because the whole `/admin` surface sits behind
 * `adminLockout -> requireAdminKey -> adminRateLimit -> adminAudit`: the caller
 * is already privileged and already audited. This must never be mounted
 * outside that chain.
 */

const router = Router();

type SuppressionRow = {
  id: string;
  email: string;
  reason: string | null;
  source: string | null;
  created_at: string;
};

type UserRow = {
  id: string;
  email_verified: boolean;
  created_at: string;
  organization_id: string | null;
};

/** Cheap shape check — this is an operator tool, not a signup form. */
function looksLikeEmail(value: string): boolean {
  return value.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

router.get("/email-deliverability/:email", async (req, res) => {
  const email = String(req.params.email ?? "").trim().toLowerCase();

  if (!looksLikeEmail(email)) {
    return res.status(400).json({ error: "valid_email_required" });
  }

  try {
    // Local suppression row (written by the provider bounce/complaint webhook).
    const suppression = await pg.query<SuppressionRow>(
      `SELECT id, email, reason, source, created_at
         FROM email_suppressions
        WHERE LOWER(email) = LOWER($1)
        LIMIT 1`,
      [email]
    );

    // The account, if any — "stranded" is only meaningful when one exists.
    const user = await pg.query<UserRow>(
      `SELECT id, email_verified, created_at, organization_id
         FROM users
        WHERE LOWER(email) = LOWER($1)
        LIMIT 1`,
      [email]
    );

    // The provider's own list. Fail-open by contract: `unknown` means we could
    // not find out, and must not be reported as "clear".
    const provider = await getProviderSuppression(email);

    const localRow = suppression.rows[0] ?? null;
    const userRow = user.rows[0] ?? null;

    // The verdict an operator actually acts on. `unknown` is deliberately NOT
    // folded into "mailable": we did not learn that it is deliverable, only
    // that we could not learn otherwise.
    const mailable =
      provider === "suppressed" ? false : provider === "clear" ? true : null;

    const stranded = Boolean(
      userRow && !userRow.email_verified && provider === "suppressed"
    );

    // Say what to do, so the next operator does not have to rediscover it.
    const recommendation = stranded
      ? "Account exists, is unverified, and the address is blocked at the provider. " +
        "It cannot self-recover: verification is the only path to email_verified and " +
        "every resend will be discarded. Lift the provider suppression for this address, " +
        "then trigger a resend — or move the customer to a different address."
      : provider === "suppressed"
        ? "Address is blocked at the provider; mail to it will be accepted and discarded. " +
          "No account is stranded behind it."
        : provider === "unknown"
          ? "Provider suppression could not be read (missing key, timeout, or provider error). " +
            "Deliverability is unknown — retry before concluding the address is fine."
          : "No provider suppression. Mail to this address should be deliverable.";

    logger.info(
      {
        event: "admin_email_deliverability_checked",
        provider,
        locallySuppressed: Boolean(localRow),
        accountExists: Boolean(userRow),
        stranded
      },
      "Admin email deliverability lookup"
    );

    return res.status(200).json({
      email,
      mailable,
      stranded,
      provider_suppression: {
        status: provider,
        // The provider list is authoritative for delivery; ours is a mirror
        // that only exists if our webhook saw the event.
        authoritative: true
      },
      local_suppression: localRow
        ? {
            reason: localRow.reason,
            source: localRow.source,
            created_at: localRow.created_at
          }
        : null,
      account: userRow
        ? {
            exists: true,
            email_verified: userRow.email_verified,
            organization_id: userRow.organization_id,
            created_at: userRow.created_at
          }
        : { exists: false },
      recommendation
    });
  } catch (err) {
    logger.error(
      { event: "admin_email_deliverability_failed", err },
      "GET /admin/email-deliverability/:email failed"
    );
    return res.status(500).json({ error: "admin_email_deliverability_failed" });
  }
});

export default router;
