/**
 * independentReviewNotifier.ts — email delivery for the Independent Governance Review workflow.
 *
 * Mirrors `riskAcceptanceNotifier.ts`. When a remediated finding is assigned to a closure
 * owner (independent reviewer) under separation of duties, that reviewer is told there is a
 * governance decision to make — separation of duties is only real if the person who must act
 * knows there is something to act on.
 *
 * Recipient resolution uses an explicit org-scope (`organization_id = $org`). pgElevated
 * bypasses RLS, so that WHERE clause is the ONLY tenant boundary — it must never be dropped.
 * The function checks the flag, NEVER throws, and returns a count so the caller can log
 * without failing the request. The pure content + flag live in `independentReviewEmails.ts`.
 *
 * Flag: SECURELOGIC_GOVERNANCE_REVIEW_NOTIFICATIONS_ENABLED (off by default), DELIBERATELY
 * separate from SECURELOGIC_INDEPENDENT_REVIEW_ENABLED so email stays dark while the workflow
 * validates, and so production (workflow off) sends nothing.
 */

import { pgElevated } from "../infra/postgres.js";
import { sendEmail } from "../infra/email.js";
import { logger } from "../infra/logger.js";
import {
  buildReviewAssignedEmail,
  buildFindingUrl,
  independentReviewNotificationsEnabled,
} from "./independentReviewEmails.js";

type Recipient = { id: string; email: string; name: string | null };

/** Resolve one active, verified user in an org. Explicit org scope is the only isolation. */
async function resolveUser(orgId: string, userId: string): Promise<Recipient | null> {
  const r = await pgElevated.query(
    `SELECT id, email, name FROM users
      WHERE id = $1 AND organization_id = $2
        AND status = 'active' AND email_verified = TRUE`,
    [userId, orgId]
  );
  const row = r.rows[0];
  return row
    ? { id: row.id as string, email: row.email as string, name: (row.name as string) || null }
    : null;
}

async function resolveFindingTitle(orgId: string, findingId: string): Promise<string> {
  const r = await pgElevated.query(
    `SELECT title FROM findings WHERE id = $1 AND organization_id = $2`,
    [findingId, orgId]
  );
  return (r.rows[0]?.title as string) || "a finding";
}

/**
 * Notify the assigned reviewer (closure owner) that a remediated finding needs their
 * independent governance decision. Dark unless the flag is on; never throws.
 */
export async function sendIndependentReviewAssignedNotification(args: {
  organizationId: string;
  findingId: string;
  reviewerUserId: string | null;
}): Promise<{ sent: number; skipped?: string }> {
  if (!independentReviewNotificationsEnabled()) return { sent: 0, skipped: "notifications disabled" };
  try {
    if (!args.reviewerUserId) return { sent: 0, skipped: "no reviewer to notify" };
    const reviewer = await resolveUser(args.organizationId, args.reviewerUserId);
    if (!reviewer) return { sent: 0, skipped: "reviewer not resolvable" };
    const title = await resolveFindingTitle(args.organizationId, args.findingId);
    const { subject, html, text } = buildReviewAssignedEmail(
      title,
      buildFindingUrl(args.findingId),
      reviewer.name
    );
    const r = await sendEmail({ to: reviewer.email, subject, html, text });
    logger.info(
      { event: "independent_review_assigned_email", findingId: args.findingId, ok: r.ok },
      "Independent-review assigned notification dispatched"
    );
    return { sent: r.ok ? 1 : 0 };
  } catch (err) {
    logger.warn(
      { event: "independent_review_assigned_email_failed", err },
      "Independent-review assigned notification failed (non-fatal)"
    );
    return { sent: 0, skipped: "error" };
  }
}
