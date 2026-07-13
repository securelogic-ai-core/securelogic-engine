/**
 * riskAcceptance.ts — the risk-acceptance lifecycle (product ruling 2026-07-12).
 *
 *   1. Accept Risk is PROPOSED (owner, rationale, evidence, review/expiry date).
 *   2. A DIFFERENT person approves it. Separation of duties, enforced in the DB too.
 *   3. The durable record exists: finding_risk_acceptances (append-only).
 *   4. decision_state = 'accepted_risk' AND operational_status = 'closed'.
 *   5. It leaves Active Findings and every remediation queue.
 *   6. It stays visible: accepted-risk reporting, review/expiration queues, audit.
 *   7. Expiry, withdrawal or rejection REOPENS the Finding.
 *
 * A proposal is NOT an approval. `decision_state='accepted_risk'` on its own leaves the
 * finding ACTIVE — the work is still live until governance signs it off. Only a binding
 * acceptance (approved, not past its expiry) closes anything.
 *
 * WHY REOPEN IS FIDDLY. `findings_closure_axes_agree` is a non-deferrable CHECK:
 * (operational_status='closed') = (status IN ('closed','accepted')). And
 * deriveOperationalStatus treats a terminal legacy `status` as a closure signal. So
 * clearing the acceptance alone is not enough — the compat bridge would re-close the
 * finding on the very next derivation, and it would spring shut the instant it reopened.
 * Both axes must be cleared in ONE statement, to a legal non-contradicting pair, before
 * the recompute derives the real state from the linked Actions. That is exactly what the
 * PATCH reopen path already does (findings.ts), and this mirrors it.
 */

import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { writeAuditEvent } from "./auditLog.js";
import { writeFindingLifecycleEvent, recomputeFindingOperationalStatus } from "./findingLifecycle.js";
import type { LifecycleActor } from "./findingLifecycle.js";
import { riskAcceptanceEnabled } from "./riskAcceptanceFeatureFlag.js";
import { SQL_ACCEPTANCE_BINDING, type AcceptanceState } from "./riskAcceptanceContract.js";

export { ACCEPTANCE_LIVE_STATES, SQL_ACCEPTANCE_BINDING } from "./riskAcceptanceContract.js";
export type { AcceptanceState } from "./riskAcceptanceContract.js";

export type RiskAcceptance = {
  id: string;
  organization_id: string;
  finding_id: string;
  state: AcceptanceState;
  owner_user_id: string | null;
  rationale: string | null;
  requested_by_user_id: string | null;
  approver_user_id: string | null;
  approved_at: string | null;
  decision_rationale: string | null;
  expires_at: string | null;
  withdrawn_at: string | null;
  withdrawal_reason: string | null;
  governance_review_required: boolean;
  promoted_risk_id: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * The acceptance column list, optionally table-qualified.
 *
 * `alias` is a compile-time constant at every call site — never request input — same
 * interpolation discipline as the rest of the SQL fragments in this codebase.
 */
export function acceptanceSelect(alias = ""): string {
  const p = alias ? `${alias}.` : "";
  return `
  ${p}id, ${p}organization_id, ${p}finding_id, ${p}state,
  ${p}owner_user_id, ${p}rationale, ${p}requested_by_user_id,
  ${p}approver_user_id, ${p}approved_at::text AS approved_at, ${p}decision_rationale,
  ${p}expires_at::text AS expires_at,
  ${p}withdrawn_at::text AS withdrawn_at, ${p}withdrawal_reason,
  ${p}governance_review_required, ${p}promoted_risk_id,
  ${p}created_at::text AS created_at, ${p}updated_at::text AS updated_at
`;
}

export const ACCEPTANCE_SELECT = acceptanceSelect();

/**
 * Does this finding have a binding acceptance right now?
 *
 * Always false when the enforcement flag is off — which is what makes flag-off behaviour
 * identical to the world before this package.
 */
export async function hasBindingAcceptance(
  organizationId: string,
  findingId: string
): Promise<boolean> {
  if (!riskAcceptanceEnabled()) return false;

  const r = await pg.query<{ ok: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM finding_risk_acceptances a
        WHERE a.organization_id = $1
          AND a.finding_id = $2
          AND ${SQL_ACCEPTANCE_BINDING}
     ) AS ok`,
    [organizationId, findingId]
  );
  return r.rows[0]?.ok === true;
}

/* ══════════════════════════════════════════════════════════════════════════
   Reopen — the path every ENDING of an acceptance funnels through
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Carry a finding back OUT of acceptance-closure: expiry, withdrawal, or rejection of an
 * already-closed acceptance.
 *
 * Both closure axes are cleared in ONE statement to a legal, non-contradicting pair
 * ('open'/'open'), and decision_state returns to 'needs_review' — the acceptance is gone,
 * so the finding genuinely needs a new decision. The recompute that follows derives the
 * finding's REAL operational state from its linked Actions, so a finding whose
 * remediation was half-done comes back as in_progress, not as a fresh 'open'.
 *
 * Clearing only one axis would deadlock: the compat bridge re-closes the finding
 * instantly. Clearing decision_state alone would leave it closed with no acceptance —
 * a finding closed by nothing at all.
 */
export async function reopenFindingAfterAcceptanceEnded(
  organizationId: string,
  findingId: string,
  actor: LifecycleActor,
  reason: "expired" | "withdrawn" | "rejected"
): Promise<{ reopened: boolean }> {
  const before = await pg.query<{ operational_status: string; decision_state: string | null }>(
    `SELECT operational_status, decision_state FROM findings
      WHERE id = $1 AND organization_id = $2
      FOR UPDATE`,
    [findingId, organizationId]
  );
  const row = before.rows[0];
  if (!row) return { reopened: false };

  const wasClosed = row.operational_status === "closed";

  await pg.query(
    `UPDATE findings
        SET status = CASE WHEN status IN ('closed', 'accepted') THEN 'open' ELSE status END,
            operational_status = CASE WHEN operational_status = 'closed' THEN 'open'
                                      ELSE operational_status END,
            decision_state = CASE WHEN decision_state = 'accepted_risk' THEN 'needs_review'
                                  ELSE decision_state END,
            updated_at = NOW()
      WHERE id = $1 AND organization_id = $2`,
    [findingId, organizationId]
  );

  if (row.decision_state === "accepted_risk") {
    await writeFindingLifecycleEvent({
      organizationId,
      findingId,
      axis: "decision",
      fromState: "accepted_risk",
      toState: "needs_review",
      transition: "reopen",
      actor,
    });
  }

  // Derive the finding's real state from its Actions and project the legacy axis to
  // match. The acceptance is no longer binding, so this cannot re-close it.
  await recomputeFindingOperationalStatus(organizationId, findingId, actor);

  writeAuditEvent({
    organizationId,
    actorUserId: actor.actorUserId ?? null,
    actorApiKeyId: actor.actorApiKeyId ?? null,
    eventType: "finding.risk_acceptance.reopened",
    resourceType: "finding",
    resourceId: findingId,
    payload: { reason, was_closed: wasClosed },
    ipAddress: null,
  });

  return { reopened: wasClosed };
}

/* ══════════════════════════════════════════════════════════════════════════
   Expiry sweep
   ══════════════════════════════════════════════════════════════════════════ */

export type ExpirySweepResult = { expired: number; reopened: number };

/**
 * Expire every approved acceptance whose review/expiration date has passed, and reopen
 * the finding each one was holding closed.
 *
 * The derivation is already time-aware (SQL_ACCEPTANCE_BINDING), so a lapsed acceptance
 * has ALREADY stopped closing its finding by the time this runs. What the sweep does is
 * materialise that: flip the record to 'expired' so it leaves the active-acceptance
 * population, write the audit trail, and push the finding's stored operational_status
 * back to reality so the metrics tables agree with the derivation.
 *
 * Org-scoped: the caller passes one organization, and the worker iterates. There is no
 * cross-tenant sweep — a bug in this loop must not be able to touch two customers.
 */
export async function sweepExpiredAcceptances(
  organizationId: string,
  actor: LifecycleActor
): Promise<ExpirySweepResult> {
  const due = await pg.query<{ id: string; finding_id: string }>(
    `SELECT id, finding_id
       FROM finding_risk_acceptances
      WHERE organization_id = $1
        AND state = 'approved'
        AND expires_at IS NOT NULL
        AND expires_at < CURRENT_DATE
      FOR UPDATE`,
    [organizationId]
  );

  let reopened = 0;
  for (const row of due.rows) {
    await pg.query(
      `UPDATE finding_risk_acceptances SET state = 'expired' WHERE id = $1 AND organization_id = $2`,
      [row.id, organizationId]
    );

    writeAuditEvent({
      organizationId,
      actorUserId: actor.actorUserId ?? null,
      actorApiKeyId: actor.actorApiKeyId ?? null,
      eventType: "finding.risk_acceptance.expired",
      resourceType: "finding_risk_acceptance",
      resourceId: row.id,
      payload: { finding_id: row.finding_id },
      ipAddress: null,
    });

    const r = await reopenFindingAfterAcceptanceEnded(
      organizationId,
      row.finding_id,
      actor,
      "expired"
    );
    if (r.reopened) reopened += 1;
  }

  if (due.rows.length > 0) {
    logger.info(
      {
        event: "risk_acceptance_expiry_sweep",
        organizationId,
        expired: due.rows.length,
        reopened,
      },
      "Risk acceptances expired; findings reopened"
    );
  }

  return { expired: due.rows.length, reopened };
}
