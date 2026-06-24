/**
 * email.ts — the shared transactional email sender.
 *
 * GDPR export workstream needs to notify a requester that their export is ready;
 * the directive was explicitly "a shared sendEmail(), NOT a 6th Resend silo."
 * Today every email path (alertEmailService, briefEmailSender, …) instantiates
 * its own Resend client + from-address + suppression check. This is the one
 * canonical sender new paths use (and existing silos can consolidate onto).
 *
 * Contract:
 *   - Lazy Resend construction (never crashes on import; fails at call time only).
 *   - ALWAYS checks email_suppressions first (compliance) — a suppressed address
 *     is skipped, not sent. A suppression-check ERROR fails OPEN (proceeds +
 *     logs) so a transient DB hiccup never blocks a legitimate transactional
 *     email like a data-export download link.
 *   - Returns a discriminated result instead of throwing — callers handle
 *     unavailable / suppressed / failed gracefully (matches the codebase's
 *     graceful-degradation pattern). Never throws.
 */

import { Resend } from "resend";
import { pg } from "./postgres.js";
import { logger } from "./logger.js";

function getResend(): Resend | null {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) return null;
  return new Resend(key);
}

function defaultFromAddress(): string {
  return process.env.NEWSLETTER_FROM_EMAIL?.trim() ?? "SecureLogic AI <noreply@securelogicai.com>";
}

async function isSuppressed(email: string): Promise<boolean> {
  // Fail-open: if the suppression table can't be read, proceed (log) rather than
  // silently dropping a transactional email.
  try {
    const r = await pg.query<{ id: string }>(
      `SELECT id FROM email_suppressions WHERE LOWER(email) = LOWER($1) LIMIT 1`,
      [email]
    );
    return r.rows.length > 0;
  } catch (err) {
    logger.warn({ event: "send_email_suppression_check_failed", err }, "Suppression check failed — proceeding (fail-open)");
    return false;
  }
}

export type SendEmailArgs = {
  to: string;
  subject: string;
  html: string;
  text?: string;
  /** Override the default from-address. */
  from?: string;
};

export type SendEmailResult =
  | { ok: true; id: string | null }
  | { ok: false; reason: "unavailable" | "suppressed" | "failed"; detail?: string };

/**
 * Send one transactional email through the shared Resend client. Never throws.
 */
export async function sendEmail(args: SendEmailArgs): Promise<SendEmailResult> {
  const to = args.to?.trim();
  if (!to) return { ok: false, reason: "failed", detail: "missing recipient" };

  const client = getResend();
  if (client === null) {
    return { ok: false, reason: "unavailable", detail: "RESEND_API_KEY not set" };
  }

  if (await isSuppressed(to)) {
    logger.info({ event: "send_email_suppressed", subject: args.subject }, "Email skipped — recipient suppressed");
    return { ok: false, reason: "suppressed" };
  }

  try {
    const res = await client.emails.send({
      from: args.from?.trim() || defaultFromAddress(),
      to,
      subject: args.subject,
      html: args.html,
      ...(args.text ? { text: args.text } : {})
    });
    const id = (res as { data?: { id?: string } | null })?.data?.id ?? null;
    logger.info({ event: "send_email_sent", subject: args.subject, id }, "Email sent");
    return { ok: true, id };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    logger.warn({ event: "send_email_failed", subject: args.subject, err }, "Email send failed");
    return { ok: false, reason: "failed", detail };
  }
}
