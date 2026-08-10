import { Router } from "express";
import type { Request } from "express";
import { logger } from "../infra/logger.js";
import {
  lookupProviderSuppressionRecord,
  deleteProviderSuppression
} from "../infra/providerSuppression.js";
import { recoveryAuthorization } from "../lib/providerSuppressionRecoveryPolicy.js";
import { writeAuditEventAwaited } from "../lib/auditLog.js";

/**
 * Provider-suppression recovery — the remediation half of
 * `GET /admin/email-deliverability/:email`.
 *
 * THE PROBLEM IT CLOSES
 * ---------------------
 * The diagnosis route can now tell an operator that a customer is stranded: an
 * unverified account behind an address the mail provider has blocked, where
 * every resend is accepted and silently discarded. It could not tell them how
 * to fix it, because the fix is a DELETE against the provider's account-level
 * suppression list — state shared by production, staging and demo. Recovery was
 * therefore an out-of-band operator action against the ESP, performed by hand,
 * with no confirmation step, no record of who did it, and nothing stopping it
 * being run from the wrong environment.
 *
 * WHY IT IS A SEPARATE FILE
 * -------------------------
 * `adminEmailDeliverability.ts` states in its header, and asserts in its test,
 * that it is read-only. That guarantee is worth keeping intact and cheaply
 * checkable, so the mutation lives here rather than being appended to it. The
 * diagnosis route is unchanged by this work.
 *
 * THE SHAPE OF THE ACTION
 * -----------------------
 * Deliberately narrow. It clears ONE provider suppression and does nothing
 * else. It does not rotate a verification token, does not resend anything, does
 * not touch `users`, `subscribers` or any tenant data, and does not remove our
 * own `email_suppressions` row (see "app-side state" below). Recovery of an
 * account is a sequence of decisions an operator should make one at a time; a
 * single endpoint that did all of them would be impossible to reason about when
 * one step half-succeeded.
 *
 * APP-SIDE STATE IS LEFT ALONE, ON PURPOSE
 * ----------------------------------------
 * `email_suppressions` is our mirror, and `docs/DATA_CLASSIFICATION.md` (O-8)
 * requires suppressions be KEPT rather than deleted — an opt-out we drop is an
 * opt-out we have lost. A separate, already-reviewed endpoint
 * (`DELETE /admin/email-suppressions/:id`) exists for the case where an
 * operator has decided that row should go. Clearing it implicitly from here
 * would bury a second policy decision inside the first.
 *
 * NOT REVERSIBLE FROM INSIDE THE PRODUCT
 * --------------------------------------
 * There is no "re-suppress" call here. Once cleared, the address is mailable
 * again and will only be re-suppressed by the provider if it bounces again.
 * That asymmetry is why the confirmation and the audit row are mandatory rather
 * than advisory.
 */

const router = Router();

/** Cheap shape check — an operator tool, not a signup form. */
function looksLikeEmail(value: string): boolean {
  return value.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

const AUDIT_RESOURCE = "provider_email_suppression";

/**
 * Record the attempt. Platform-level: provider suppressions have no
 * `organization_id` — the list is account-wide and email-keyed, exactly like
 * the `email_suppressions` table it mirrors (TENANT_ROUTE_CLASSIFICATION.md
 * classifies these surfaces as tenant-irrelevant).
 *
 * Awaited, unlike almost every other caller: this is an irreversible mutation
 * of state that lives outside our database, so the audit row is the only
 * durable evidence it happened, and the operator is told if it did not land.
 */
async function audit(
  req: Request,
  eventType: string,
  suppressionId: string | null,
  payload: Record<string, unknown>
): Promise<boolean> {
  return writeAuditEventAwaited({
    organizationId: null,
    actorApiKeyId: (req as { apiKey?: { id?: string } }).apiKey?.id ?? null,
    actorUserId: (req as { userId?: string }).userId ?? null,
    eventType,
    resourceType: AUDIT_RESOURCE,
    resourceId: suppressionId,
    payload,
    ipAddress: req.ip ?? null
  });
}

/**
 * GET /admin/email-deliverability/:email/provider-suppression
 *
 * Read-only preview: the current provider record INCLUDING its identifier,
 * which the clear call requires. Available in every environment and regardless
 * of the recovery flag — reading the shared list mutates nothing, and an
 * operator diagnosing from staging should not be blocked from looking.
 */
router.get("/email-deliverability/:email/provider-suppression", async (req, res) => {
  const email = String(req.params.email ?? "").trim().toLowerCase();

  if (!looksLikeEmail(email)) {
    return res.status(400).json({ error: "valid_email_required" });
  }

  const authorization = recoveryAuthorization();
  const lookup = await lookupProviderSuppressionRecord(email);

  if (lookup.outcome === "unavailable") {
    return res.status(503).json({
      email,
      result: "provider_unavailable",
      detail: lookup.detail,
      // Say nothing about whether it is suppressed — we do not know.
      clear_permitted_here: authorization.allowed
    });
  }

  if (lookup.outcome === "clear") {
    return res.status(200).json({
      email,
      suppressed: false,
      provider_suppression: null,
      clear_permitted_here: authorization.allowed,
      recommendation: "No provider suppression to clear for this address."
    });
  }

  return res.status(200).json({
    email,
    suppressed: true,
    provider_suppression: {
      id: lookup.record.id,
      origin: lookup.record.origin,
      created_at: lookup.record.createdAt
    },
    clear_permitted_here: authorization.allowed,
    ...(authorization.allowed
      ? {}
      : { clear_blocked_reason: authorization.reason, detail: authorization.detail }),
    recommendation:
      "To clear it, POST to this path + /clear with " +
      `{ \"confirm_email\": \"${email}\", \"provider_suppression_id\": \"${lookup.record.id}\" }. ` +
      "Clearing does not resend anything or change the account — do that as a separate step."
  });
});

/**
 * POST /admin/email-deliverability/:email/provider-suppression/clear
 *
 * Body: { confirm_email: string, provider_suppression_id: string }
 *
 * Checks run in this order, and the order is part of the design:
 *   1. address shape  — first only so that an unbounded path segment can never
 *      reach the audit payload; rejecting it leaks nothing;
 *   2. environment boundary  — the wrong environment is told so before it is
 *      invited to go and turn a flag on, which is the mistake to prevent;
 *   3. operator intent flag;
 *   4. explicit confirmation  — the body must repeat the address in the path;
 *   5. FRESH read from the provider  — never trust the id the caller supplied;
 *   6. compare-and-swap on the id  — a suppression replaced since the operator
 *      looked is a different decision, and is refused;
 *   7. delete, then audit.
 */
router.post(
  "/email-deliverability/:email/provider-suppression/clear",
  async (req, res) => {
    const email = String(req.params.email ?? "").trim().toLowerCase();

    // ── 1. Address shape, so nothing unbounded reaches the audit payload ───
    if (!looksLikeEmail(email)) {
      return res.status(400).json({ error: "valid_email_required" });
    }

    // ── 2 + 3. The environment boundary, before any provider contact ───────
    const authorization = recoveryAuthorization();
    if (!authorization.allowed) {
      // Audited: an attempt to clear shared provider state from the wrong
      // place is a near-miss worth being able to find later.
      const recorded = await audit(req, "email.provider_suppression.refused", null, {
        email,
        reason: authorization.reason
      });
      logger.warn(
        {
          event: "provider_suppression_clear_refused",
          reason: authorization.reason
        },
        "Refused a provider suppression clear"
      );
      return res.status(403).json({
        email,
        result: "refused",
        error: authorization.reason,
        detail: authorization.detail,
        audit_recorded: recorded
      });
    }

    // ── 4. Explicit confirmation ───────────────────────────────────────────
    const body = (req.body ?? {}) as Record<string, unknown>;
    const confirmEmail = String(body["confirm_email"] ?? "").trim().toLowerCase();
    const suppliedId = String(body["provider_suppression_id"] ?? "").trim();

    if (!confirmEmail || confirmEmail !== email) {
      return res.status(400).json({
        email,
        result: "refused",
        error: "confirmation_required",
        detail:
          "Body must include `confirm_email` exactly matching the address in the " +
          "path. This is an irreversible change to shared provider state."
      });
    }

    // Bounded because it is echoed into the audit payload, which
    // `AuditEventInput` asks to keep under 1KB for operational queries. Provider
    // identifiers are UUID-length; anything near this is not one.
    if (!suppliedId || suppliedId.length > 200) {
      return res.status(400).json({
        email,
        result: "refused",
        error: "provider_suppression_id_required",
        detail:
          "Body must include `provider_suppression_id`, taken from a GET of this " +
          "path. It is checked against a fresh read so a suppression created since " +
          "you looked is not cleared by mistake."
      });
    }

    try {
      // ── 5. Fresh read — the supplied id is an assertion, not an input ────
      const lookup = await lookupProviderSuppressionRecord(email);

      if (lookup.outcome === "unavailable") {
        // Fail closed. Not knowing must never resolve to "go ahead".
        return res.status(503).json({
          email,
          result: "provider_unavailable",
          detail:
            `${lookup.detail} Nothing was changed. Retry once the provider is ` +
            `reachable — do not assume the address is clear.`
        });
      }

      if (lookup.outcome === "clear") {
        return res.status(200).json({
          email,
          result: "already_absent",
          detail:
            "The provider holds no suppression for this address; nothing to clear. " +
            "It may have been cleared already, or the address may never have been " +
            "blocked.",
          audit_recorded: await audit(
            req,
            "email.provider_suppression.already_absent",
            suppliedId,
            { email, supplied_id: suppliedId }
          )
        });
      }

      // ── 6. Compare-and-swap ──────────────────────────────────────────────
      if (lookup.record.id !== suppliedId) {
        logger.warn(
          { event: "provider_suppression_clear_stale" },
          "Refused a provider suppression clear: record changed since it was read"
        );
        return res.status(409).json({
          email,
          result: "refused",
          error: "provider_suppression_changed",
          detail:
            "The suppression on this address is not the one you confirmed — it has " +
            "been replaced since you read it, most likely because the address " +
            "bounced again. Nothing was changed. Re-read before deciding.",
          confirmed_id: suppliedId,
          current_id: lookup.record.id,
          current_origin: lookup.record.origin,
          current_created_at: lookup.record.createdAt,
          audit_recorded: await audit(
            req,
            "email.provider_suppression.stale_conflict",
            lookup.record.id,
            { email, supplied_id: suppliedId, current_id: lookup.record.id }
          )
        });
      }

      // ── 7. Delete, then audit ────────────────────────────────────────────
      const deletion = await deleteProviderSuppression(lookup.record.id);

      if (deletion.outcome === "already_absent") {
        return res.status(200).json({
          email,
          result: "already_absent",
          detail:
            "The record was gone by the time the delete was issued; someone or " +
            "something else cleared it. The address is not suppressed.",
          audit_recorded: await audit(
            req,
            "email.provider_suppression.already_absent",
            lookup.record.id,
            { email, supplied_id: suppliedId }
          )
        });
      }

      if (deletion.outcome === "failed") {
        logger.error(
          { event: "provider_suppression_clear_failed" },
          "Provider suppression clear failed"
        );
        return res.status(502).json({
          email,
          result: "failed",
          detail: deletion.detail,
          audit_recorded: await audit(
            req,
            "email.provider_suppression.clear_failed",
            lookup.record.id,
            { email, detail: deletion.detail }
          )
        });
      }

      const recorded = await audit(
        req,
        "email.provider_suppression.cleared",
        lookup.record.id,
        {
          email,
          origin: lookup.record.origin,
          suppression_created_at: lookup.record.createdAt
        }
      );

      logger.info(
        { event: "provider_suppression_cleared" },
        "Cleared a provider suppression"
      );

      return res.status(200).json({
        email,
        result: "cleared",
        provider_suppression_id: lookup.record.id,
        audit_recorded: recorded,
        // The operator's next decisions, stated rather than implied — this
        // endpoint deliberately performs none of them.
        detail:
          "The address is mailable again at the provider. Nothing else was changed: " +
          "no verification token was rotated, no mail was resent, and our own " +
          "email_suppressions row (if any) is untouched. If an account is stranded " +
          "behind this address, trigger a resend as a separate, deliberate step.",
        ...(recorded
          ? {}
          : {
              warning:
                "The suppression WAS cleared but the audit row failed to write. " +
                "Record this action manually."
            })
      });
    } catch (err) {
      logger.error(
        { event: "admin_provider_suppression_clear_failed", err },
        "POST /admin/email-deliverability/:email/provider-suppression/clear failed"
      );
      return res
        .status(500)
        .json({ email, result: "failed", error: "provider_suppression_clear_failed" });
    }
  }
);

export default router;
