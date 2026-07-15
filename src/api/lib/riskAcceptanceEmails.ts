/**
 * riskAcceptanceEmails.ts — the PURE content + flag for risk-acceptance notifications.
 *
 * Deliberately free of any I/O import (no postgres, no mail transport) so the wording,
 * escaping and flag gate are unit-testable without a database or a mail server. The
 * impure half — recipient resolution and delivery — lives in `riskAcceptanceNotifier.ts`,
 * which imports these builders.
 */

export function riskAcceptanceNotificationsEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env["SECURELOGIC_RISK_ACCEPTANCE_NOTIFICATIONS_ENABLED"] === "true";
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

export function buildAcceptanceProposedEmail(
  findingTitle: string,
  findingUrl: string,
  requesterName: string | null,
  expiresAt: string | null
): { subject: string; html: string; text: string } {
  const who = requesterName ? htmlEscape(requesterName) : "A colleague";
  const review = expiresAt ? htmlEscape(expiresAt) : "not set";
  const subject = `Risk acceptance awaiting your approval: ${findingTitle}`;
  const html = `<p>${greeting(null)}</p>
<p><strong>${who}</strong> has proposed accepting the risk of the finding <strong>${htmlEscape(findingTitle)}</strong>, and it needs your approval.</p>
<p>Accepting a risk is a governed decision. Separation of duties means the person who proposed it cannot approve it — so this is waiting on a different authorized approver. The finding stays active until you approve.</p>
<ul>
  <li>Proposed by: ${who}</li>
  <li>Review / expiration date: ${review}</li>
</ul>
<p><a href="${findingUrl}">Review and approve or reject this risk acceptance</a></p>`;
  const text = `${greeting(null)}

${requesterName || "A colleague"} has proposed accepting the risk of the finding "${findingTitle}", and it needs your approval.

Accepting a risk is a governed decision. Separation of duties means the proposer cannot approve it — this is waiting on a different authorized approver. The finding stays active until you approve.

Proposed by: ${requesterName || "A colleague"}
Review / expiration date: ${expiresAt || "not set"}

Review it here: ${findingUrl}`;
  return { subject, html, text };
}

export function buildAcceptanceDecidedEmail(
  findingTitle: string,
  findingUrl: string,
  requesterName: string | null,
  decision: "approved" | "rejected",
  rationale: string | null
): { subject: string; html: string; text: string } {
  const verb = decision === "approved" ? "approved" : "rejected";
  const outcome =
    decision === "approved"
      ? "The risk is now accepted and binding until its review date; the finding is closed and stays governed."
      : "The finding remains active — it was never closed by this proposal.";
  const note = rationale ? `<p>Decision note: ${htmlEscape(rationale)}</p>` : "";
  const noteText = rationale ? `\nDecision note: ${rationale}\n` : "";
  const subject = `Your risk acceptance was ${verb}: ${findingTitle}`;
  const html = `<p>${greeting(requesterName)}</p>
<p>Your proposal to accept the risk of the finding <strong>${htmlEscape(findingTitle)}</strong> was <strong>${verb}</strong>.</p>
<p>${outcome}</p>
${note}
<p><a href="${findingUrl}">View the finding</a></p>`;
  const text = `${greeting(requesterName)}

Your proposal to accept the risk of the finding "${findingTitle}" was ${verb}.

${outcome}
${noteText}
View it here: ${findingUrl}`;
  return { subject, html, text };
}
