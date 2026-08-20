/**
 * billingDunningEmail.ts — what the customer actually receives when a payment
 * fails, and when it is fixed.
 *
 * Extracted from the webhook because it has TWO callers with different clocks:
 * the webhook sends Day 0 the moment Stripe reports the failure, and the
 * reconciling sweep sends Day 7 and Day 14 from elapsed time. One set of
 * templates, one recipient rule, one grace-aware wording decision — the
 * alternative is two implementations that drift, and the one that drifts is
 * always the one the customer reads.
 *
 * THE COPY IS DERIVED, NOT WRITTEN. Whether these emails may say "your access
 * continues until DATE" is decided by graceState() — the same function that
 * enforces grace at request time in attachOrganizationContext — rather than by
 * the template author. If the grace mechanism is not deployed or its flag is
 * off, graceState returns `lapsed` and the wording switches to "access has been
 * suspended" automatically. The promise cannot outrun the mechanism, and no
 * future edit to these templates can make it.
 *
 * Sends are never fatal to the caller. In the webhook a non-2xx would make
 * Stripe retry the whole event and re-run entitlement writes to fix a mail
 * problem; in the sweep a throw would abandon the rest of the batch.
 */

import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { sendEmail } from "../infra/email.js";
import { graceState, graceEndsAt } from "./graceWindow.js";

/**
 * The org's verified admins — the people who lose the product when billing
 * lapses. Mirrors sendTrialWillEndEmails' recipient rule deliberately: Stripe's
 * own emails go to the BILLING contact, who is often finance and often not the
 * person who will hit a 403 tomorrow. The two audiences are complementary, not
 * duplicative.
 */
export async function orgAdminRecipients(
  orgId: string
): Promise<{ orgName: string; admins: Array<{ email: string; name: string | null }> } | null> {
  const orgResult = await pg.query<{ name: string }>(
    `SELECT name FROM organizations WHERE id = $1 LIMIT 1`,
    [orgId]
  );
  const orgName = orgResult.rows[0]?.name;
  if (!orgName) return null;

  const admins = await pg.query<{ email: string; name: string | null }>(
    `SELECT email, name FROM users
      WHERE organization_id = $1 AND role = 'admin' AND email_verified = TRUE
      ORDER BY created_at ASC`,
    [orgId]
  );
  if (admins.rows.length === 0) return null;

  return { orgName, admins: admins.rows };
}

function emailShell(heading: string, body: string, cta: string, footnote: string): string {
  const appBase = (process.env.APP_BASE_URL ?? "https://app.securelogicai.com").replace(/\/$/, "");
  return `
    <div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 560px; margin: 0 auto; color: #0f172a;">
      <h2 style="margin-bottom: 8px;">${heading}</h2>
      ${body}
      <p>
        <a href="${appBase}/account"
           style="display: inline-block; background: #0d9488; color: #ffffff; text-decoration: none; font-weight: 600; padding: 10px 24px; border-radius: 8px;">
          ${cta}
        </a>
      </p>
      <p style="color: #64748b; font-size: 13px;">${footnote}</p>
    </div>`;
}

/**
 * The dunning notice.
 *
 * THE COPY IS DERIVED, NOT WRITTEN. Whether this email may say "your access
 * continues until DATE" is decided by graceState() — the same function that
 * enforces grace at request time — rather than by the template author. That is
 * structural, not stylistic: if the grace mechanism (PR-F) is not deployed or
 * its flag is off, graceState returns `lapsed` and the wording switches to
 * "access has been suspended" automatically. **The promise cannot outrun the
 * mechanism**, and no future edit to this file can make it.
 */
export async function sendDunningEmails(args: {
  orgId: string;
  cycleStartedAt: Date | string;
  subscriptionStatus: string | null;
  stage: 0 | 7 | 14;
}): Promise<void> {
  const recipients = await orgAdminRecipients(args.orgId);
  if (!recipients) {
    logger.warn(
      { event: "stripe_dunning_email_no_recipients", orgId: args.orgId, stage: args.stage },
      "dunning email: org missing or has no verified admins — skipping"
    );
    return;
  }

  const inputs = {
    paymentFailedAt: args.cycleStartedAt,
    subscriptionStatus: args.subscriptionStatus,
  };
  const state = graceState(inputs);
  const endsAt = state === "in_grace" ? graceEndsAt(inputs) : null;
  const endsLabel = endsAt
    ? endsAt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
    : null;

  const { orgName, admins } = recipients;

  // Two vocabularies, one per grace state. Nothing here interpolates a date
  // unless graceState says the access it describes is real.
  const subject =
    state === "in_grace"
      ? args.stage === 0
        ? `Payment failed for ${orgName} — action needed`
        : args.stage === 7
          ? `Still unpaid: ${orgName} access ends ${endsLabel ?? "soon"}`
          : `Final notice: ${orgName} access ends ${endsLabel ?? "tomorrow"}`
      : `Payment failed for ${orgName} — access suspended`;

  const heading =
    state === "in_grace" ? "We couldn't process your payment" : "Your SecureLogic access is suspended";

  const accessLine =
    state === "in_grace" && endsLabel
      ? `<p style="color: #334155; line-height: 1.6;">Your access to SecureLogic continues until <strong>${endsLabel}</strong>. Update your payment method before then and nothing will be interrupted.</p>`
      : `<p style="color: #334155; line-height: 1.6;">Access for <strong>${orgName}</strong> has been suspended until payment is resolved. Your data is intact and returns as soon as the payment goes through.</p>`;

  const urgency =
    args.stage === 14
      ? `<p style="color: #b91c1c; line-height: 1.6; font-weight: 600;">This is the last reminder before access ends.</p>`
      : "";

  const html = emailShell(
    heading,
    `<p style="color: #334155; line-height: 1.6;">The most recent payment for <strong>${orgName}</strong> could not be processed. This is usually an expired or replaced card.</p>${accessLine}${urgency}`,
    "Update Payment Method",
    "Your data is never deleted for a failed payment. If you have already updated your card, you can ignore this."
  );

  for (const admin of admins) {
    const result = await sendEmail({ to: admin.email, subject, html });
    logger.info(
      {
        event: "billing_dunning_notified",
        orgId: args.orgId,
        stage: args.stage,
        graceState: state,
        to: admin.email,
        ok: result.ok,
        reason: result.ok ? null : result.reason,
      },
      "dunning email attempted"
    );
  }
}

/**
 * The recovery confirmation. Without it, a customer who fixed their card has no
 * signal that access is back — they are left guessing whether the last email
 * they received still applies.
 */
export async function sendPaymentRecoveredEmails(orgId: string): Promise<void> {
  const recipients = await orgAdminRecipients(orgId);
  if (!recipients) return;

  const { orgName, admins } = recipients;
  const html = emailShell(
    "You're all set",
    `<p style="color: #334155; line-height: 1.6;">We received the payment for <strong>${orgName}</strong> and full access has been restored. No further action is needed.</p>`,
    "Open SecureLogic",
    "This confirms the earlier payment-failure notice is resolved."
  );

  for (const admin of admins) {
    const result = await sendEmail({
      to: admin.email,
      subject: `Payment received — ${orgName} access restored`,
      html,
    });
    logger.info(
      {
        event: "stripe_payment_recovered_email",
        orgId,
        to: admin.email,
        ok: result.ok,
        reason: result.ok ? null : result.reason,
      },
      "payment recovered email attempted"
    );
  }
}

