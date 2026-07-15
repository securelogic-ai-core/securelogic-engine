/**
 * riskAcceptanceNotifier.ts — email delivery for the Finding risk-acceptance workflow.
 *
 * Mirrors `riskLifecycleNotifier.ts` (the Risk-Register lifecycle) for the Finding
 * risk-acceptance subsystem. Separation of duties is only REAL if the person who must act
 * knows there is something to act on — so a proposal reaches the org's approvers, and a
 * decision reaches the requester. Recipient resolution uses an explicit org-scope
 * (pgElevated bypasses RLS, so the WHERE clause is the only isolation). Every function
 * checks the flag, NEVER throws, and returns a count so the caller can log without failing
 * the request. The pure content + flag live in `riskAcceptanceEmails.ts` (unit-tested).
 *
 *   proposed          → the org's eligible approvers (role='admin', excluding the requester)
 *   approved/rejected → the requester (proposer)
 *
 * Flag: SECURELOGIC_RISK_ACCEPTANCE_NOTIFICATIONS_ENABLED (off by default), DELIBERATELY
 * separate from SECURELOGIC_RISK_ACCEPTANCE_ENABLED so email stays dark while the workflow
 * validates, and so production (workflow off) sends nothing.
 */

import { pgElevated } from "../infra/postgres.js";
import { sendEmail, type SendEmailResult } from "../infra/email.js";
import { logger } from "../infra/logger.js";
import {
  buildAcceptanceProposedEmail,
  buildAcceptanceDecidedEmail,
  buildFindingUrl,
  riskAcceptanceNotificationsEnabled,
} from "./riskAcceptanceEmails.js";

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
  return row ? { id: row.id as string, email: row.email as string, name: (row.name as string) || null } : null;
}

/** Eligible approvers = active, verified admins (the R2/R3 approval-authority model). */
async function resolveOrgApprovers(orgId: string): Promise<Recipient[]> {
  const r = await pgElevated.query(
    `SELECT id, email, name FROM users
      WHERE organization_id = $1 AND role = 'admin'
        AND status = 'active' AND email_verified = TRUE`,
    [orgId]
  );
  return r.rows.map((row) => ({
    id: row.id as string,
    email: row.email as string,
    name: (row.name as string) || null,
  }));
}

async function resolveFindingTitle(orgId: string, findingId: string): Promise<string> {
  const r = await pgElevated.query(
    `SELECT title FROM findings WHERE id = $1 AND organization_id = $2`,
    [findingId, orgId]
  );
  return (r.rows[0]?.title as string) || "a finding";
}

/** Notify eligible approvers (admins ≠ the requester) that an acceptance awaits approval. */
export async function sendAcceptanceProposedNotification(args: {
  organizationId: string;
  findingId: string;
  requesterUserId: string | null;
  expiresAt: string | null;
}): Promise<{ sent: number; skipped?: string }> {
  if (!riskAcceptanceNotificationsEnabled()) return { sent: 0, skipped: "notifications disabled" };
  try {
    const approvers = (await resolveOrgApprovers(args.organizationId)).filter(
      (a) => a.id !== args.requesterUserId // the proposer cannot approve their own — don't ask them to
    );
    if (approvers.length === 0) return { sent: 0, skipped: "no eligible approvers" };
    const requester = args.requesterUserId
      ? await resolveUser(args.organizationId, args.requesterUserId)
      : null;
    const title = await resolveFindingTitle(args.organizationId, args.findingId);
    const { subject, html, text } = buildAcceptanceProposedEmail(
      title,
      buildFindingUrl(args.findingId),
      requester?.name ?? null,
      args.expiresAt
    );
    let sent = 0;
    for (const a of approvers) {
      const r = await sendEmail({ to: a.email, subject, html, text });
      if (r.ok) sent += 1;
    }
    logger.info(
      { event: "risk_acceptance_proposed_email", findingId: args.findingId, approvers: approvers.length, sent },
      "Risk-acceptance proposed notifications dispatched"
    );
    return { sent };
  } catch (err) {
    logger.warn(
      { event: "risk_acceptance_proposed_email_failed", err },
      "Risk-acceptance proposed notification failed (non-fatal)"
    );
    return { sent: 0, skipped: "error" };
  }
}

/** Notify the requester (proposer) that their acceptance was approved or rejected. */
export async function sendAcceptanceDecidedNotification(args: {
  organizationId: string;
  findingId: string;
  requesterUserId: string | null;
  decision: "approved" | "rejected";
  rationale: string | null;
}): Promise<SendEmailResult> {
  if (!riskAcceptanceNotificationsEnabled()) {
    return { ok: false, reason: "unavailable", detail: "notifications disabled" };
  }
  try {
    if (!args.requesterUserId) return { ok: false, reason: "failed", detail: "no requester to notify" };
    const requester = await resolveUser(args.organizationId, args.requesterUserId);
    if (!requester) return { ok: false, reason: "failed", detail: "requester not resolvable" };
    const title = await resolveFindingTitle(args.organizationId, args.findingId);
    const { subject, html, text } = buildAcceptanceDecidedEmail(
      title,
      buildFindingUrl(args.findingId),
      requester.name,
      args.decision,
      args.rationale
    );
    const result = await sendEmail({ to: requester.email, subject, html, text });
    logger.info(
      { event: "risk_acceptance_decided_email", findingId: args.findingId, decision: args.decision, ok: result.ok },
      "Risk-acceptance decided notification dispatched"
    );
    return result;
  } catch (err) {
    logger.warn(
      { event: "risk_acceptance_decided_email_failed", err },
      "Risk-acceptance decided notification failed (non-fatal)"
    );
    return { ok: false, reason: "failed", detail: err instanceof Error ? err.message : String(err) };
  }
}
