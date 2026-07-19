/**
 * independentReviewAssignment.ts — auto-assign a Closure Owner / Governance Reviewer.
 *
 * When a finding reaches operational_status='remediated' in an org that enforces
 * separation of duties on closure (risk_settings.require_finding_closure_sod), the
 * remediator cannot close it — an independent reviewer must. This module routes that
 * governance work to an assigned reviewer instead of leaving the remediator to click a
 * Resolved control the close-time SoD gate will always refuse.
 *
 * INVOKED from recomputeFindingOperationalStatus (the single writer of operational_status)
 * ONLY on a real transition INTO 'remediated', and ONLY when SECURELOGIC_INDEPENDENT_REVIEW_ENABLED
 * is on — so with the flag off, recompute issues ZERO extra SQL and is byte-identical.
 *
 * Runs inside the caller's asTenant() transaction (ambient `pg`), so the assignment write is
 * atomic with the remediated transition. Every predicate is org-scoped explicitly
 * (organization_id = $org, sourced from the caller — never request input), so it is safe
 * under RLS whether the findings/users policies are enabled or not.
 *
 * Reviewer authority mirrors the platform approval model (riskApprovalAuthority: authority =
 * admin). The reviewer is an active admin who is NOT the remediator — the same counterparty
 * the close-time SoD gate uses. Re-remediation staleness is handled: if the previously
 * assigned reviewer has BECOME the new remediator, they are replaced (otherwise the close
 * gate would 409 the assigned reviewer, reintroducing the dead action this feature removes).
 *
 * Notification is fire-and-forget and dark by default (SECURELOGIC_GOVERNANCE_REVIEW_NOTIFICATIONS_ENABLED).
 * KNOWN LIMITATION (prod-enable gate, not a build gate): it dispatches from inside the still-open
 * transaction, so a subsequent rollback could announce an assignment that did not commit. That is
 * acceptable while the notification flag is OFF (staging validation sends nothing); before enabling
 * notifications in production the dispatch must move post-commit (recompute already returns the
 * assigned reviewer for that) or through an outbox.
 */

import { pg } from "../infra/postgres.js";
import { writeAuditEvent } from "./auditLog.js";
import { sendIndependentReviewAssignedNotification } from "./independentReviewNotifier.js";
import { chooseReviewer, type ReviewerCandidate } from "./independentReviewSelection.js";
import type { LifecycleActor } from "./findingLifecycle.js";

// The PURE selection rule lives in independentReviewSelection.ts (no I/O import), so it is
// unit-testable without a database. Re-exported here so existing importers are unaffected.
export { chooseReviewer, type ReviewerCandidate };

export interface AssignReviewerResult {
  /** The reviewer now assigned — null when none eligible or policy/preconditions not met. */
  assignedReviewerUserId: string | null;
  /** True when a NEW assignment (or reassignment) was written this call. */
  changed: boolean;
}

/**
 * Assign (or reassign) the independent governance reviewer for a just-remediated finding,
 * when the org enforces closure SoD. Idempotent: a finding that already has a valid reviewer
 * (one who is not the current remediator) is left untouched.
 *
 * The caller guarantees this runs only on a real transition into 'remediated' with the
 * workflow flag on. `remediatorUserId` is the actor of that transition (actor.actorUserId) —
 * identical, by construction, to the "latest operational→remediated event actor" the
 * close-time SoD gate resolves.
 */
export async function assignIndependentReviewerIfNeeded(
  organizationId: string,
  findingId: string,
  remediatorUserId: string | null,
  actor: LifecycleActor
): Promise<AssignReviewerResult> {
  // Org policy: does this org require independent (separation-of-duties) closure? Read in the
  // same transaction. When it does not, there is no independent reviewer to assign.
  const policy = await pg.query<{ enforced: boolean; review_owner_user_id: string | null }>(
    `SELECT
       COALESCE((SELECT s.require_finding_closure_sod FROM risk_settings s
                  WHERE s.organization_id = $1), FALSE) AS enforced,
       (SELECT f.review_owner_user_id FROM findings f
         WHERE f.id = $2 AND f.organization_id = $1) AS review_owner_user_id`,
    [organizationId, findingId]
  );
  const row = policy.rows[0];
  if (!row || row.enforced !== true) {
    return { assignedReviewerUserId: null, changed: false };
  }

  const currentReviewer = row.review_owner_user_id ?? null;
  // Keep a still-valid assignment: a reviewer who is NOT the current remediator can close.
  // Reassign only when unassigned OR the assigned reviewer has become the remediator (a
  // re-remediation by the prior reviewer) — otherwise the close gate would refuse the very
  // person we routed the work to.
  if (currentReviewer !== null && currentReviewer !== remediatorUserId) {
    return { assignedReviewerUserId: currentReviewer, changed: false };
  }

  // Eligible reviewers = active admins in this org (the platform approval-authority model),
  // deterministically ordered so assignment is stable and reproducible. Org-scoped.
  const candidates = await pg.query<ReviewerCandidate>(
    `SELECT id FROM users
      WHERE organization_id = $1 AND role = 'admin' AND status = 'active'
      ORDER BY created_at ASC, id ASC`,
    [organizationId]
  );
  const reviewerId = chooseReviewer(candidates.rows, remediatorUserId);
  if (reviewerId === null) {
    // No eligible reviewer. Do not fabricate one; leave the finding for the org-wide queue.
    return { assignedReviewerUserId: null, changed: false };
  }

  // Idempotent write: only claim the slot when it is still unassigned or held by the
  // now-remediator. Guards against a concurrent assignment racing this one.
  const updated = await pg.query(
    `UPDATE findings SET review_owner_user_id = $1, updated_at = NOW()
      WHERE id = $2 AND organization_id = $3
        AND (review_owner_user_id IS NULL OR review_owner_user_id = $4)`,
    [reviewerId, findingId, organizationId, remediatorUserId]
  );
  if ((updated.rowCount ?? 0) === 0) {
    // Another writer assigned first; report the finding's now-current reviewer intent.
    return { assignedReviewerUserId: null, changed: false };
  }

  // Activity timeline: "Assigned for independent review". Fire-and-forget audit projection
  // (security_audit_log — the stream the finding activity feed reads), org-scoped by param.
  writeAuditEvent({
    organizationId,
    actorUserId: actor.actorUserId,
    actorApiKeyId: actor.actorApiKeyId,
    eventType: "finding.review.assigned",
    resourceType: "finding",
    resourceId: findingId,
    payload: { reviewer_user_id: reviewerId, remediator_user_id: remediatorUserId },
  });

  // Tell the reviewer there is governance work to do. Dark by default; never fatal.
  void sendIndependentReviewAssignedNotification({
    organizationId,
    findingId,
    reviewerUserId: reviewerId,
  });

  return { assignedReviewerUserId: reviewerId, changed: true };
}
