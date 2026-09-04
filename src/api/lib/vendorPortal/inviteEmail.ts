/**
 * inviteEmail.ts — SecureLogic sends the vendor-portal invitation itself
 * (goal §B, 2026-09-04; lineage: the held VA-L1 branch of 2026-08-23).
 *
 * ── The product intent ───────────────────────────────────────────────────────
 * The customer chooses a contact, reviews a professional default message,
 * optionally sets a due date, and clicks Send. SecureLogic binds the secure
 * portal credential, inserts the access link, and sends through the ONE shared
 * transactional mailer (`src/api/infra/email.ts`) — never a parallel email
 * system. Environment tagging, suppression checks, the test-runner guard and
 * the `email_sends` ledger all live in that choke point, not here.
 *
 * ── The credential ───────────────────────────────────────────────────────────
 * The email carries the SAME raw token the issue response returns once. The
 * mailbox becomes the second holder of the credential, which is the point.
 * Nothing here logs or stores the token; the `purpose` / `correlationId` the
 * ledger records are the invite ROW id, not the secret.
 *
 * ── Dark by default ──────────────────────────────────────────────────────────
 * `SECURELOGIC_VENDOR_INVITE_EMAIL_ENABLED` must be exactly "true". While
 * dark, issuing still works exactly as before — the customer's shown-once
 * link remains the recovery path, and the invite row records `disabled` so
 * the UI tells the truth rather than implying an email went out.
 *
 * ── Never throws ─────────────────────────────────────────────────────────────
 * A delivery failure must not fail the issuance: the credential exists, the
 * engagement is issued, and the customer is told to resend or copy the link.
 */

import { sendEmail } from "../../infra/email.js";
import { logger } from "../../infra/logger.js";

export const VENDOR_INVITE_EMAIL_PURPOSE = "vendor.invite" as const;

export type InviteEmailDeliveryState = "sent" | "failed" | "suppressed" | "disabled";

export function inviteEmailEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env["SECURELOGIC_VENDOR_INVITE_EMAIL_ENABLED"] === "true";
}

function portalBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const base = env["APP_BASE_URL"]?.trim() || "https://app.securelogicai.com";
  return base.replace(/\/$/, "");
}

/** The accept URL the vendor clicks — the same shape the app's copy box shows. */
export function buildPortalAcceptUrl(rawToken: string, env: NodeJS.ProcessEnv = process.env): string {
  return `${portalBaseUrl(env)}/portal/accept/${encodeURIComponent(rawToken)}`;
}

function htmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Render a plain-text message as escaped paragraphs. Never trusts markup. */
function paragraphs(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map((p) => `<p>${htmlEscape(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function formatDueDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/**
 * The professional default message the customer reviews and may edit. Pure,
 * exported so the app can render the same default the engine would send.
 */
export function defaultInviteMessage(args: {
  contactName: string | null;
  organizationName: string;
  vendorName: string;
  dueDate?: string | null;
}): string {
  const greeting = args.contactName ? `Hello ${args.contactName.split(" ")[0]},` : "Hello,";
  const due = args.dueDate ? ` We would appreciate your response by ${formatDueDate(args.dueDate)}.` : "";
  return (
    `${greeting}\n\n` +
    `${args.organizationName} assesses the security and governance posture of its vendors, and ` +
    `${args.vendorName} has been selected for an assessment. SecureLogic AI has assembled a ` +
    `questionnaire tailored to the service you provide us; it asks only what applies to this ` +
    `relationship, and you can attach supporting evidence where it helps.${due}\n\n` +
    `Please use the secure link below to open the questionnaire. If someone else at ` +
    `${args.vendorName} is better placed to respond, please let us know.\n\n` +
    `Thank you,\n${args.organizationName}`
  );
}

/** Pure: subject + bodies. Exported for tests — content drift should fail loudly. */
export function buildVendorInviteEmail(args: {
  organizationName: string;
  vendorName: string;
  message: string;
  acceptUrl: string;
  expiresAt: Date;
  dueDate?: string | null;
}): { subject: string; html: string; text: string } {
  const org = htmlEscape(args.organizationName);
  const expires = args.expiresAt.toISOString().slice(0, 10);
  const url = htmlEscape(args.acceptUrl);
  const due = args.dueDate ? `Requested response date: ${formatDueDate(args.dueDate)}.` : "";
  return {
    subject: `${args.organizationName} has asked ${args.vendorName} to complete a security assessment`,
    html:
      paragraphs(args.message) +
      `<p><a href="${url}" style="display:inline-block;padding:10px 18px;background:#1d4ed8;color:#ffffff;` +
      `text-decoration:none;border-radius:6px;font-weight:600">Open the secure questionnaire</a></p>` +
      `<p style="font-size:13px;color:#4b5563">Or paste this link into your browser:<br>` +
      `<a href="${url}">${url}</a></p>` +
      (due ? `<p style="font-size:13px;color:#4b5563">${htmlEscape(due)}</p>` : "") +
      `<p style="font-size:13px;color:#4b5563">This secure link expires on ${expires}. It can be used by ` +
      `your team until then — treat it like a password and do not forward it outside ${org}'s ` +
      `assessment.</p>` +
      `<p style="font-size:13px;color:#4b5563">If you were not expecting this request, you can ignore ` +
      `this email or contact ${org} directly. Sent by SecureLogic AI on behalf of ${org}.</p>`,
    text:
      `${args.message}\n\n` +
      `Open the secure questionnaire:\n${args.acceptUrl}\n\n` +
      (due ? `${due}\n` : "") +
      `This secure link expires on ${expires}. Treat it like a password.\n` +
      `If you were not expecting this request, ignore this email or contact ` +
      `${args.organizationName} directly.\n\nSent by SecureLogic AI on behalf of ${args.organizationName}.`,
  };
}

export type InviteEmailResult = {
  state: InviteEmailDeliveryState;
  /** The provider's message id for an accepted send — the join to `email_sends` and its webhook events. */
  providerMessageId: string | null;
  /** Short transport reason on failure; never the address, subject or body. */
  detail: string | null;
};

/**
 * Send the invitation. Never throws — delivery failure must not fail the
 * issuance. The caller records the returned state on the invite row.
 */
export async function sendVendorInviteEmail(args: {
  organizationId: string;
  inviteId: string;
  contactEmail: string;
  organizationName: string;
  vendorName: string;
  message: string;
  rawToken: string;
  expiresAt: Date;
  dueDate?: string | null;
  env?: NodeJS.ProcessEnv;
}): Promise<InviteEmailResult> {
  const env = args.env ?? process.env;
  if (!inviteEmailEnabled(env)) return { state: "disabled", providerMessageId: null, detail: null };
  try {
    const content = buildVendorInviteEmail({
      organizationName: args.organizationName,
      vendorName: args.vendorName,
      message: args.message,
      acceptUrl: buildPortalAcceptUrl(args.rawToken, env),
      expiresAt: args.expiresAt,
      dueDate: args.dueDate ?? null,
    });
    const result = await sendEmail({
      to: args.contactEmail,
      subject: content.subject,
      html: content.html,
      text: content.text,
      purpose: VENDOR_INVITE_EMAIL_PURPOSE,
      orgId: args.organizationId,
      correlationId: args.inviteId,
    });
    if (result.ok) return { state: "sent", providerMessageId: result.id, detail: null };
    if (result.reason === "suppressed") {
      logger.warn(
        { event: "vendor_invite_email_suppressed", organizationId: args.organizationId, inviteId: args.inviteId },
        "Vendor invite email skipped — recipient is suppressed"
      );
      return { state: "suppressed", providerMessageId: null, detail: "recipient is on the suppression list" };
    }
    logger.warn(
      { event: "vendor_invite_email_not_sent", organizationId: args.organizationId, inviteId: args.inviteId, reason: result.reason },
      "Vendor invite email did not send — the copy-link path remains the recovery route"
    );
    return { state: "failed", providerMessageId: null, detail: `${result.reason}${result.detail ? `: ${result.detail}` : ""}`.slice(0, 500) };
  } catch (err) {
    logger.warn(
      { event: "vendor_invite_email_failed", organizationId: args.organizationId, inviteId: args.inviteId, err },
      "Vendor invite email failed"
    );
    return { state: "failed", providerMessageId: null, detail: "transport error" };
  }
}
