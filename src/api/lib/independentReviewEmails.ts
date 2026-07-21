/**
 * independentReviewEmails.ts — PURE content + flag for independent-governance-review
 * notifications.
 *
 * Free of any I/O import (no postgres, no mail transport) so the wording, escaping and flag
 * gate are unit-testable without a database or mail server. The impure half — recipient
 * resolution and delivery — lives in `independentReviewNotifier.ts`, which imports these
 * builders. Mirrors `riskAcceptanceEmails.ts`.
 */

export function independentReviewNotificationsEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env["SECURELOGIC_GOVERNANCE_REVIEW_NOTIFICATIONS_ENABLED"] === "true";
}

/** Base URL the finding detail page is reachable at (operator-configurable). */
function appBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const base = env["APP_BASE_URL"]?.trim() || "https://app.securelogicai.com";
  return base.replace(/\/$/, "");
}

export function buildFindingUrl(findingId: string, env: NodeJS.ProcessEnv = process.env): string {
  return `${appBaseUrl(env)}/findings/${encodeURIComponent(findingId)}`;
}

function htmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function greeting(name: string | null): string {
  return name ? `Hi ${name},` : "Hi,";
}

/**
 * Email to the assigned reviewer: remediation is complete and your independent governance
 * decision is required. Separation of duties is only real if the person who must act knows
 * there is something to act on.
 */
export function buildReviewAssignedEmail(
  findingTitle: string,
  findingUrl: string,
  reviewerName: string | null
): { subject: string; html: string; text: string } {
  const title = htmlEscape(findingTitle);
  const subject = `Independent review required: ${findingTitle}`;
  const html = `<p>${greeting(reviewerName)}</p>
<p>Remediation is complete on the finding <strong>${title}</strong>, and it now needs an independent governance decision from you.</p>
<p>Your organization requires separation of duties on closure: the person who performed the remediation cannot close the finding, so it has been assigned to you as the closure owner. The finding stays active until you record a decision — <strong>Resolved</strong> or <strong>Accepted Risk</strong>.</p>
<p><a href="${findingUrl}">Review the remediation and record your decision</a></p>`;
  const text = `${greeting(reviewerName)}

Remediation is complete on the finding "${findingTitle}", and it now needs an independent governance decision from you.

Your organization requires separation of duties on closure: the person who performed the remediation cannot close the finding, so it has been assigned to you as the closure owner. The finding stays active until you record a decision — Resolved or Accepted Risk.

Review it here: ${findingUrl}`;
  return { subject, html, text };
}
