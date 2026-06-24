/**
 * exportReadyEmail.ts — GDPR data-export "your export is ready" notification.
 *
 * Completes the export-delivery UX: when the data-rights-worker finishes an
 * export (recordSuccess), notify the requester with a tokenized download link
 * (GET /api/data-exports/download?token=…, the session-optional public download
 * route the token was minted for). Built on the shared sendEmail() sender.
 *
 * OFF by default behind SECURELOGIC_EXPORT_EMAIL_ENABLED — sending customer email
 * on export completion is a behavior change; enable per-env after confirming the
 * download base URL + reviewing. When off it costs nothing (no users.email query,
 * no send). Never throws — an email failure must not fail an export that succeeded.
 */

import { sendEmail, type SendEmailResult } from "../infra/email.js";
import { logger } from "../infra/logger.js";

export function exportEmailEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env["SECURELOGIC_EXPORT_EMAIL_ENABLED"] === "true";
}

/** Base URL the tokenized download route is reachable at. Operator-configurable; defaults to the app origin. */
function downloadBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const base = env["DATA_EXPORT_DOWNLOAD_BASE_URL"]?.trim() || env["APP_BASE_URL"]?.trim() || "https://app.securelogicai.com";
  return base.replace(/\/$/, "");
}

/** Build the tokenized download URL (the public, session-optional route). */
export function buildExportDownloadUrl(rawToken: string, env: NodeJS.ProcessEnv = process.env): string {
  return `${downloadBaseUrl(env)}/api/data-exports/download?token=${encodeURIComponent(rawToken)}`;
}

function htmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Pure: the subject + html body for the export-ready email. */
export function buildExportReadyEmail(downloadUrl: string, expiresAt: Date): {
  subject: string;
  html: string;
  text: string;
} {
  const expires = expiresAt.toISOString().slice(0, 10);
  const url = htmlEscape(downloadUrl);
  return {
    subject: "Your SecureLogic AI data export is ready",
    html:
      `<p>Your data export is ready to download.</p>` +
      `<p><a href="${url}">Download your export</a></p>` +
      `<p>This secure link expires on ${expires}. If it expires, you can request a new export from your account.</p>` +
      `<p>If you did not request this export, please contact support.</p>`,
    text:
      `Your data export is ready to download:\n${downloadUrl}\n\n` +
      `This secure link expires on ${expires}. If you did not request this export, contact support.`
  };
}

/**
 * Send the export-ready notification. Gated (flag) and graceful — returns the
 * sendEmail result, or a synthetic 'unavailable' when disabled/empty. Never throws.
 */
export async function sendExportReadyEmail(args: {
  to: string;
  rawToken: string;
  expiresAt: Date;
}): Promise<SendEmailResult> {
  if (!exportEmailEnabled()) return { ok: false, reason: "unavailable", detail: "export email disabled" };
  if (!args.to || !args.rawToken) return { ok: false, reason: "failed", detail: "missing recipient/token" };

  try {
    const url = buildExportDownloadUrl(args.rawToken);
    const { subject, html, text } = buildExportReadyEmail(url, args.expiresAt);
    const result = await sendEmail({ to: args.to, subject, html, text });
    logger.info(
      { event: "export_ready_email", ok: result.ok, reason: result.ok ? undefined : result.reason },
      "Export-ready email dispatched"
    );
    return result;
  } catch (err) {
    logger.warn({ event: "export_ready_email_failed", err }, "Export-ready email failed (non-fatal)");
    return { ok: false, reason: "failed", detail: err instanceof Error ? err.message : String(err) };
  }
}
