/**
 * inviteEmail.ts — deliver the vendor-portal invite link by email (VA-L1).
 *
 * Until this existed the issue route's comments claimed the invite was
 * "delivered by email" while no send site existed anywhere: the customer got
 * a shown-once copy box and mailed the credential themselves. This closes
 * that gap through the ONE shared mailer (src/api/infra/email.ts — env
 * tagging + suppression checks live there, not here).
 *
 * Dark by default: SECURELOGIC_VENDOR_INVITE_EMAIL_ENABLED must be exactly
 * "true". Deliberately NOT declared in render.yaml on this branch (R-1 §G —
 * declare "false" at merge time). While dark, issuing still works exactly as
 * before: the copy-link box remains the delivery path either way, because an
 * email failure must never strand an issued engagement.
 *
 * The email contains the SAME raw token the issue response returns once —
 * the mailbox becomes the second holder of the credential, which is the
 * entire product intent. Nothing here logs or stores the token.
 */

import { sendEmail } from "../../infra/email.js";
import { logger } from "../../infra/logger.js";

export function inviteEmailEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env["SECURELOGIC_VENDOR_INVITE_EMAIL_ENABLED"] === "true";
}

function portalBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const base = env["APP_BASE_URL"]?.trim() || "https://app.securelogicai.com";
  return base.replace(/\/$/, "");
}

/** The accept URL the vendor clicks — same shape the app's copy box shows. */
export function buildPortalAcceptUrl(
  rawToken: string,
  env: NodeJS.ProcessEnv = process.env
): string {
  return `${portalBaseUrl(env)}/portal/accept/${encodeURIComponent(rawToken)}`;
}

function htmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Pure: subject + bodies. Exported for tests — content drift should fail loudly. */
export function buildVendorInviteEmail(args: {
  contactName: string | null;
  organizationName: string;
  acceptUrl: string;
  expiresAt: Date;
}): { subject: string; html: string; text: string } {
  const greeting = args.contactName ? `Hello ${htmlEscape(args.contactName)},` : "Hello,";
  const org = htmlEscape(args.organizationName);
  const expires = args.expiresAt.toISOString().slice(0, 10);
  const url = htmlEscape(args.acceptUrl);
  return {
    subject: `${args.organizationName} has asked you to complete a security questionnaire`,
    html:
      `<p>${greeting}</p>` +
      `<p>${org} uses SecureLogic AI to assess its vendors and has asked you to ` +
      `complete a security questionnaire.</p>` +
      `<p><a href="${url}">Open the questionnaire</a></p>` +
      `<p>This secure link expires on ${expires}. It can be used by your team until then — ` +
      `treat it like a password.</p>` +
      `<p>If you were not expecting this request, you can ignore this email or contact ` +
      `${org} directly.</p>`,
    text:
      `${args.contactName ? `Hello ${args.contactName},` : "Hello,"}\n\n` +
      `${args.organizationName} uses SecureLogic AI to assess its vendors and has asked ` +
      `you to complete a security questionnaire:\n${args.acceptUrl}\n\n` +
      `This secure link expires on ${expires}. Treat it like a password.\n` +
      `If you were not expecting this request, ignore this email or contact ` +
      `${args.organizationName} directly.`,
  };
}

/**
 * Send the invite. Never throws — delivery failure must not fail the issue.
 * Returns "sent" | "failed" | "disabled" so the route can tell the customer
 * the truth about whether anything left the building.
 */
export async function sendVendorInviteEmail(args: {
  contactEmail: string;
  contactName: string | null;
  organizationName: string;
  rawToken: string;
  expiresAt: Date;
  env?: NodeJS.ProcessEnv;
}): Promise<"sent" | "failed" | "disabled"> {
  const env = args.env ?? process.env;
  if (!inviteEmailEnabled(env)) return "disabled";
  try {
    const content = buildVendorInviteEmail({
      contactName: args.contactName,
      organizationName: args.organizationName,
      acceptUrl: buildPortalAcceptUrl(args.rawToken, env),
      expiresAt: args.expiresAt,
    });
    const result = await sendEmail({
      to: args.contactEmail,
      subject: content.subject,
      html: content.html,
      text: content.text,
    });
    if (result.ok) return "sent";
    logger.warn(
      { event: "vendor_invite_email_not_sent", reason: result.reason },
      "Vendor invite email did not send — the copy-link path remains the delivery route"
    );
    return "failed";
  } catch (err) {
    logger.warn({ event: "vendor_invite_email_failed", err }, "Vendor invite email failed");
    return "failed";
  }
}
