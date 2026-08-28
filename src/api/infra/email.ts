/**
 * email.ts — the shared transactional email sender.
 *
 * GDPR export workstream needs to notify a requester that their export is ready;
 * the directive was explicitly "a shared sendEmail(), NOT a 6th Resend silo."
 * This is the canonical sender new transactional paths use. The provider call
 * itself goes through `emailTransport.sendViaProvider()` — the one choke point
 * every send site in the codebase now shares (EMAIL-OBS-1) — so this module's
 * only job is the suppression check and the caller-facing result shape.
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
 *   - A provider REJECTION is `failed`, never `ok` — the transport checks the
 *     SDK's `{ error }`.
 *   - Logs carry purpose / org / correlation / recipient domain only. Never
 *     the address, subject or body.
 */

import { pg } from "./postgres.js";
import { logger } from "./logger.js";
import { logEmailSkipped, sendViaProvider } from "./emailTransport.js";

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
  /**
   * Stable purpose key for observability (`billing.dunning`, `export.ready`…).
   * Defaults to `transactional` for callers that predate EMAIL-OBS-1.
   */
  purpose?: string;
  /** Tenant the send belongs to, when known. */
  orgId?: string | null;
  /** Domain correlation id (finding id, risk id, export id…), when known. */
  correlationId?: string | null;
};

export type SendEmailResult =
  | { ok: true; id: string | null }
  | { ok: false; reason: "unavailable" | "suppressed" | "failed" | "blocked_test_env"; detail?: string };

const DEFAULT_PURPOSE = "transactional";

/**
 * Send one transactional email through the shared Resend client. Never throws.
 */
export async function sendEmail(args: SendEmailArgs): Promise<SendEmailResult> {
  const to = args.to?.trim();
  if (!to) return { ok: false, reason: "failed", detail: "missing recipient" };

  const ctx = {
    purpose: args.purpose ?? DEFAULT_PURPOSE,
    orgId: args.orgId ?? null,
    correlationId: args.correlationId ?? null
  };

  if (!process.env.RESEND_API_KEY?.trim()) {
    logEmailSkipped({ ...ctx, to, outcome: "skipped_unconfigured", reason: "RESEND_API_KEY not set" });
    return { ok: false, reason: "unavailable", detail: "RESEND_API_KEY not set" };
  }

  if (await isSuppressed(to)) {
    logEmailSkipped({ ...ctx, to, outcome: "suppressed", reason: "email_suppressions" });
    return { ok: false, reason: "suppressed" };
  }

  const res = await sendViaProvider({
    ...ctx,
    to,
    from: args.from?.trim() || defaultFromAddress(),
    subject: args.subject,
    html: args.html,
    ...(args.text ? { text: args.text } : {})
  });

  if (res.ok) return { ok: true, id: res.providerMessageId };
  if (res.outcome === "blocked_test_env") {
    return { ok: false, reason: "blocked_test_env", detail: res.errorMessage };
  }
  if (res.outcome === "skipped_unconfigured") {
    return { ok: false, reason: "unavailable", detail: res.errorMessage };
  }
  return { ok: false, reason: "failed", detail: res.errorMessage };
}
