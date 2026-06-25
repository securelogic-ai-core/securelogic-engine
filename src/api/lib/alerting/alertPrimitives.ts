/**
 * alertPrimitives.ts — shared low-level primitives for the alerting layer.
 *
 * These were previously private to alertEmailService.ts. They are relocated here
 * (behavior-identical) so multiple producers — the per-finding sender, the
 * coalescing alert service, and future producers (staleness, action-engine) —
 * share one implementation of transport, suppression, and the send ledger
 * instead of each rebuilding them.
 *
 * No behavior change vs. the originals: same env vars, same SQL, same tables
 * (email_suppressions, alert_sends).
 */
import { Resend } from "resend";
import { pg } from "../../infra/postgres.js";

let _resend: Resend | null = null;

/**
 * Returns the Resend SDK instance. Lazy: throws at call time (not import) when
 * RESEND_API_KEY is unset, so createApp() builds in any environment.
 */
export function getResend(): Resend {
  if (_resend) return _resend;
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) {
    throw new Error("RESEND_API_KEY is not configured");
  }
  _resend = new Resend(key);
  return _resend;
}

export function getFromAddress(): string {
  return process.env.NEWSLETTER_FROM_EMAIL?.trim() ?? "SecureLogic AI <noreply@securelogicai.com>";
}

export function getAppBaseUrl(): string {
  return (process.env.APP_BASE_URL ?? "https://app.securelogicai.com").replace(/\/$/, "");
}

export function htmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** True when the email is on the suppression list (bounce/complaint/unsubscribe). */
export async function isSuppressed(email: string): Promise<boolean> {
  const r = await pg.query<{ id: string }>(
    `SELECT id FROM email_suppressions WHERE LOWER(email) = LOWER($1) LIMIT 1`,
    [email]
  );
  return r.rows.length > 0;
}

/** True when (user, alertType, referenceId) was already recorded in alert_sends. */
export async function isDuplicate(userId: string, alertType: string, referenceId: string): Promise<boolean> {
  const r = await pg.query<{ id: string }>(
    `SELECT id FROM alert_sends WHERE user_id = $1 AND alert_type = $2 AND reference_id = $3 LIMIT 1`,
    [userId, alertType, referenceId]
  );
  return r.rows.length > 0;
}

/** Record a send in the dedupe ledger. Idempotent (ON CONFLICT DO NOTHING). */
export async function recordSend(userId: string, alertType: string, referenceId: string): Promise<void> {
  await pg.query(
    `INSERT INTO alert_sends (user_id, alert_type, reference_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [userId, alertType, referenceId]
  );
}
