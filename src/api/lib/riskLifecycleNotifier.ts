/**
 * riskLifecycleNotifier.ts — Risk lifecycle (Epic R4) transactional notifications.
 *
 * Emails the humans a lifecycle event actually concerns:
 *   - owner assigned      → the new risk owner
 *   - approval requested  → the org's eligible approvers (role='admin')
 *   - approval decided     → the proposer who requested it
 *
 * Built on the shared transactional sender sendEmail() (NEWSLETTER_FROM_EMAIL
 * family) — NOT the Intelligence Brief bulk sender. Mirrors exportReadyEmail.ts:
 * pure body builders + flag-gated, never-throws send functions.
 *
 * DECOUPLED FROM THE TRANSITION TRANSACTION (spec §10): recipient lookups use
 * pgElevated (the owner pool, outside any tenant/withTenant scope, exactly as
 * writeAuditEvent does) with EXPLICIT organization_id scoping on every query, and
 * callers invoke these fire-and-forget (`void send…().catch(…)`) AFTER their DB
 * work. A notification failure can never roll back or fail a committed transition.
 *
 * OFF by default behind SECURELOGIC_RISK_LIFECYCLE_NOTIFICATIONS_ENABLED — a
 * dedicated sibling to the epic flag so that turning the lifecycle on does NOT by
 * itself start sending customer email. When off it costs nothing (no users query,
 * no send). Never throws.
 */

import { pgElevated } from "../infra/postgres.js";
import { sendEmail, type SendEmailResult } from "../infra/email.js";
import { logger } from "../infra/logger.js";

export function riskLifecycleNotificationsEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env["SECURELOGIC_RISK_LIFECYCLE_NOTIFICATIONS_ENABLED"] === "true";
}

/** Base URL the risk detail page is reachable at (operator-configurable). */
function appBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const base =
    env["APP_BASE_URL"]?.trim() || "https://app.securelogicai.com";
  return base.replace(/\/$/, "");
}

export function buildRiskUrl(riskId: string, env: NodeJS.ProcessEnv = process.env): string {
  return `${appBaseUrl(env)}/risks/${encodeURIComponent(riskId)}`;
}

function htmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

type Recipient = { email: string; name: string | null };

/** Resolve one active, verified user in an org. Explicit org scope (pgElevated
 *  bypasses RLS, so the WHERE clause is the only isolation — keep it). */
async function resolveUser(orgId: string, userId: string): Promise<Recipient | null> {
  const r = await pgElevated.query(
    `SELECT email, name FROM users
      WHERE id = $1 AND organization_id = $2
        AND status = 'active' AND email_verified = TRUE`,
    [userId, orgId]
  );
  const row = r.rows[0];
  return row ? { email: row.email, name: (row.name as string) || null } : null;
}

/** Eligible approvers for an org = active, verified admins (the R2/R3 model). */
async function resolveOrgApprovers(orgId: string): Promise<Recipient[]> {
  const r = await pgElevated.query(
    `SELECT email, name FROM users
      WHERE organization_id = $1 AND role = 'admin'
        AND status = 'active' AND email_verified = TRUE`,
    [orgId]
  );
  return r.rows.map((row) => ({ email: row.email as string, name: (row.name as string) || null }));
}

function greeting(name: string | null): string {
  return name ? `Hi ${htmlEscape(name)},` : "Hello,";
}

// ── Pure body builders (exported for tests) ─────────────────────────────────

export function buildOwnerAssignedEmail(riskTitle: string, riskUrl: string, ownerName: string | null): {
  subject: string;
  html: string;
  text: string;
} {
  const t = htmlEscape(riskTitle);
  const url = htmlEscape(riskUrl);
  return {
    subject: `You've been assigned as owner of a risk: ${riskTitle}`,
    html:
      `<p>${greeting(ownerName)}</p>` +
      `<p>You have been assigned as the owner of the risk <strong>${t}</strong>.</p>` +
      `<p>As owner you're responsible for driving it through assessment, treatment, and review.</p>` +
      `<p><a href="${url}">Open the risk</a></p>`,
    text:
      `You have been assigned as the owner of the risk "${riskTitle}".\n` +
      `Open it here: ${riskUrl}`,
  };
}

export function buildApprovalRequestedEmail(riskTitle: string, riskUrl: string, requesterName: string | null): {
  subject: string;
  html: string;
  text: string;
} {
  const t = htmlEscape(riskTitle);
  const url = htmlEscape(riskUrl);
  const by = requesterName ? ` by ${htmlEscape(requesterName)}` : "";
  return {
    subject: `Approval requested: risk treatment for ${riskTitle}`,
    html:
      `<p>Hello,</p>` +
      `<p>Executive approval has been requested${by} for the treatment plan on the risk <strong>${t}</strong>.</p>` +
      `<p>Review the treatment plan and record your decision in the approvals queue.</p>` +
      `<p><a href="${url}">Review the risk</a></p>`,
    text:
      `Executive approval has been requested for the treatment plan on the risk "${riskTitle}".\n` +
      `Review it here: ${riskUrl}`,
  };
}

export function buildApprovalDecidedEmail(
  riskTitle: string,
  riskUrl: string,
  proposerName: string | null,
  decision: "approved" | "rejected",
  comment: string | null
): { subject: string; html: string; text: string } {
  const t = htmlEscape(riskTitle);
  const url = htmlEscape(riskUrl);
  const verb = decision === "approved" ? "approved" : "rejected";
  const note = comment ? `<p>Reviewer note: ${htmlEscape(comment)}</p>` : "";
  const noteText = comment ? `\nReviewer note: ${comment}` : "";
  return {
    subject: `Your approval request was ${verb}: ${riskTitle}`,
    html:
      `<p>${greeting(proposerName)}</p>` +
      `<p>Your approval request for the treatment plan on the risk <strong>${t}</strong> was <strong>${verb}</strong>.</p>` +
      note +
      `<p><a href="${url}">Open the risk</a></p>`,
    text:
      `Your approval request for the treatment plan on the risk "${riskTitle}" was ${verb}.${noteText}\n` +
      `Open it here: ${riskUrl}`,
  };
}

// ── Flag-gated, never-throws senders (fire these fire-and-forget) ────────────

/** Notify the newly assigned owner. Resolves nothing / sends nothing when the
 *  flag is off. Returns the send result for tests; never throws. */
export async function sendOwnerAssignedNotification(args: {
  organizationId: string;
  riskId: string;
  riskTitle: string;
  ownerUserId: string;
}): Promise<SendEmailResult> {
  if (!riskLifecycleNotificationsEnabled()) {
    return { ok: false, reason: "unavailable", detail: "notifications disabled" };
  }
  try {
    const owner = await resolveUser(args.organizationId, args.ownerUserId);
    if (!owner) return { ok: false, reason: "failed", detail: "owner not resolvable" };
    const { subject, html, text } = buildOwnerAssignedEmail(
      args.riskTitle,
      buildRiskUrl(args.riskId),
      owner.name
    );
    const result = await sendEmail({ to: owner.email, subject, html, text });
    logger.info(
      { event: "risk_owner_assigned_email", riskId: args.riskId, ok: result.ok },
      "Owner-assigned notification dispatched"
    );
    return result;
  } catch (err) {
    logger.warn({ event: "risk_owner_assigned_email_failed", err }, "Owner-assigned notification failed (non-fatal)");
    return { ok: false, reason: "failed", detail: err instanceof Error ? err.message : String(err) };
  }
}

/** Notify eligible approvers (admins) that approval was requested. Returns how
 *  many sends were attempted. Never throws. */
export async function sendApprovalRequestedNotification(args: {
  organizationId: string;
  riskId: string;
  riskTitle: string;
  requesterName: string | null;
}): Promise<{ sent: number; skipped?: string }> {
  if (!riskLifecycleNotificationsEnabled()) return { sent: 0, skipped: "notifications disabled" };
  try {
    const approvers = await resolveOrgApprovers(args.organizationId);
    if (approvers.length === 0) return { sent: 0, skipped: "no eligible approvers" };
    const { subject, html, text } = buildApprovalRequestedEmail(
      args.riskTitle,
      buildRiskUrl(args.riskId),
      args.requesterName
    );
    let sent = 0;
    for (const a of approvers) {
      const r = await sendEmail({ to: a.email, subject, html, text });
      if (r.ok) sent += 1;
    }
    logger.info(
      { event: "risk_approval_requested_email", riskId: args.riskId, approvers: approvers.length, sent },
      "Approval-requested notifications dispatched"
    );
    return { sent };
  } catch (err) {
    logger.warn({ event: "risk_approval_requested_email_failed", err }, "Approval-requested notification failed (non-fatal)");
    return { sent: 0, skipped: "error" };
  }
}

/** Notify the proposer that their approval request was decided. Never throws. */
export async function sendApprovalDecidedNotification(args: {
  organizationId: string;
  riskId: string;
  riskTitle: string;
  proposerUserId: string;
  decision: "approved" | "rejected";
  comment: string | null;
}): Promise<SendEmailResult> {
  if (!riskLifecycleNotificationsEnabled()) {
    return { ok: false, reason: "unavailable", detail: "notifications disabled" };
  }
  try {
    const proposer = await resolveUser(args.organizationId, args.proposerUserId);
    if (!proposer) return { ok: false, reason: "failed", detail: "proposer not resolvable" };
    const { subject, html, text } = buildApprovalDecidedEmail(
      args.riskTitle,
      buildRiskUrl(args.riskId),
      proposer.name,
      args.decision,
      args.comment
    );
    const result = await sendEmail({ to: proposer.email, subject, html, text });
    logger.info(
      { event: "risk_approval_decided_email", riskId: args.riskId, decision: args.decision, ok: result.ok },
      "Approval-decided notification dispatched"
    );
    return result;
  } catch (err) {
    logger.warn({ event: "risk_approval_decided_email_failed", err }, "Approval-decided notification failed (non-fatal)");
    return { ok: false, reason: "failed", detail: err instanceof Error ? err.message : String(err) };
  }
}
