/**
 * findingLifecycle.ts — in-transaction appliers for the Finding two-axis
 * lifecycle (C6). The pure decision core lives in findingLifecycleMachine.ts
 * (I/O-free, unit-testable — same split as riskLifecycleStateMachine.ts).
 *
 * Authority: docs/specs/finding-lifecycle-spec.md (RATIFIED 2026-07-10).
 *
 * Both appliers run inside the caller's asTenant() transaction (the ambient
 * `pg` routes to the tenant client via AsyncLocalStorage), so the triggering
 * write, the state change, and the finding_lifecycle_events append are atomic
 * (spec §5, §6.2). `recomputeFindingOperationalStatus` is the ONLY writer of
 * findings.operational_status (§7: never hand-set).
 */

import { pg } from "../infra/postgres.js";
import { SQL_ACCEPTANCE_BINDING } from "./riskAcceptanceContract.js";
import { riskAcceptanceEnabled } from "./riskAcceptanceFeatureFlag.js";
import { independentReviewEnabled } from "./independentReviewFeatureFlag.js";
import { assignIndependentReviewerIfNeeded } from "./independentReviewAssignment.js";
import {
  deriveOperationalStatus,
  legacyStatusFor,
  operationalAuditEvent,
  projectLegacyStatusOnClosureChange,
  type FindingOperationalStatus,
} from "./findingLifecycleMachine.js";

export interface LifecycleActor {
  actorUserId: string | null;
  actorApiKeyId: string | null;
}

/** One appended finding_lifecycle_events row (same tenant transaction). */
export async function writeFindingLifecycleEvent(params: {
  organizationId: string;
  findingId: string;
  axis: "operational" | "decision";
  fromState: string | null;
  toState: string;
  transition: string;
  actor: LifecycleActor;
  comment?: string | null;
}): Promise<void> {
  await pg.query(
    `INSERT INTO finding_lifecycle_events
       (organization_id, finding_id, axis, from_state, to_state, transition,
        actor_user_id, actor_api_key_id, comment)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      params.organizationId,
      params.findingId,
      params.axis,
      params.fromState,
      params.toState,
      params.transition,
      params.actor.actorUserId,
      params.actor.actorApiKeyId,
      params.comment ?? null,
    ]
  );
}

export interface RecomputeResult {
  changed: boolean;
  fromState?: string;
  toState?: FindingOperationalStatus;
  /** security_audit_log event name for the caller's projection */
  auditEvent?: string;
  /**
   * The independent governance reviewer assigned by this recompute, when the finding
   * transitioned INTO 'remediated' under an SoD-enforcing org with the workflow flag on.
   * Null on every other path. Informational for callers/telemetry; the reviewer
   * notification is dispatched POST-COMMIT by the assignment itself (registerAfterCommit),
   * so callers need not — and must not — dispatch it again from this value.
   */
  assignedReviewerUserId?: string | null;
}

export interface RecomputeOptions {
  /**
   * Re-derive the legacy `status` wholesale from the recomputed operational state
   * (spec §3), instead of only un-closing it.
   *
   * Set ONLY by a caller that has just carried a finding OUT of closure. Reopening
   * is the one case where the legacy axis cannot be left as it is: it still reads
   * 'closed', and if it survived, the compat bridge would immediately re-derive
   * `closed` and the finding would spring shut again the instant it was reopened.
   * The reopening caller therefore clears both axes provisionally, and this flag
   * tells the recompute to write the legacy axis the finding's REAL state
   * ('in_progress' for remediated, per §3) rather than leave it at the provisional
   * 'open'.
   */
  projectLegacy?: boolean;
}

/**
 * The child→parent cascade (spec §5): recompute the parent Finding's
 * operational_status from its linked Actions, its governance decision, and the
 * legacy compat axis, inside the caller's asTenant() transaction. The ONLY writer
 * of findings.operational_status.
 *
 * Org-scoped throughout: both the Action read and the Finding write carry
 * `organization_id = $org`, so a cross-org source_id can never move a foreign
 * finding. Returns what changed so the route can project the audit event.
 */
export async function recomputeFindingOperationalStatus(
  organizationId: string,
  findingId: string,
  actor: LifecycleActor,
  options: RecomputeOptions = {}
): Promise<RecomputeResult> {
  // The governance axis and the legacy compat axis are read here alongside the
  // operational one, because closure now derives from all three (spec §1.1 as
  // amended 2026-07-12). FOR UPDATE so a concurrent Action write and a
  // concurrent close cannot interleave into a contradiction.
  const current = await pg.query<{
    operational_status: string;
    status: string | null;
    decision_state: string | null;
  }>(
    `SELECT operational_status, status, decision_state FROM findings
      WHERE id = $1 AND organization_id = $2
      FOR UPDATE`,
    [findingId, organizationId]
  );
  const currentRow = current.rows[0];
  if (!currentRow) return { changed: false };
  const fromState = String(currentRow.operational_status ?? "open");
  const legacyStatus = currentRow.status ?? null;
  const decisionState = currentRow.decision_state ?? null;

  const actions = await pg.query(
    `SELECT status FROM actions
      WHERE organization_id = $1 AND source_type = 'finding' AND source_id = $2`,
    [organizationId, findingId]
  );

  // Evidence gate (spec §1.1): the SAME org policy the Risk lifecycle enforces
  // (risk_settings.require_evidence_gate, default false). Resolved in this
  // transaction; when enforced, remediation requires attached evidence.
  const gateRow = await pg.query<{ enforced: boolean; has_evidence: boolean }>(
    `SELECT
       COALESCE((SELECT s.require_evidence_gate FROM risk_settings s
                  WHERE s.organization_id = $1), FALSE) AS enforced,
       EXISTS(SELECT 1 FROM evidence e
               WHERE e.organization_id = $1
                 AND e.source_type = 'finding' AND e.source_id = $2) AS has_evidence`,
    [organizationId, findingId]
  );
  const gate = {
    enforced: gateRow.rows[0]?.enforced === true,
    hasEvidence: gateRow.rows[0]?.has_evidence === true,
  };

  // A BINDING risk acceptance (approved, not past its expiry) is the third closure
  // signal — ruling 2026-07-12. Resolved here rather than in the pure machine because
  // expiry is a function of TODAY. Always false while the enforcement flag is off, so
  // flag-off derivation is byte-identical to before this package.
  //
  // Read inside the same transaction as the FOR UPDATE above, so an approval and a
  // concurrent Action write cannot interleave into a contradiction.
  const acceptanceBinding = riskAcceptanceEnabled()
    ? (
        await pg.query<{ ok: boolean }>(
          `SELECT EXISTS (
             SELECT 1 FROM finding_risk_acceptances a
              WHERE a.organization_id = $1 AND a.finding_id = $2
                AND ${SQL_ACCEPTANCE_BINDING}
           ) AS ok`,
          [organizationId, findingId]
        )
      ).rows[0]?.ok === true
    : false;

  const toState = deriveOperationalStatus(
    actions.rows.map((r) => String(r.status ?? "")),
    gate,
    { decisionState, legacyStatus, hasBindingAcceptance: acceptanceBinding }
  );

  if (toState === fromState) return { changed: false };

  // Crossing the closure boundary drags the legacy axis with it, in the SAME
  // statement — the database's findings_closure_axes_agree CHECK is not
  // deferrable, so the two columns may never be inconsistent even for the width
  // of one UPDATE. Null means "no legacy write needed" and leaves `status`
  // exactly as the caller set it.
  const legacyProjection = options.projectLegacy
    ? legacyStatusFor(toState)
    : projectLegacyStatusOnClosureChange(toState, legacyStatus);

  await pg.query(
    legacyProjection === null
      ? `UPDATE findings SET operational_status = $1, updated_at = NOW()
          WHERE id = $2 AND organization_id = $3`
      : `UPDATE findings SET operational_status = $1, status = $4, updated_at = NOW()
          WHERE id = $2 AND organization_id = $3`,
    legacyProjection === null
      ? [toState, findingId, organizationId]
      : [toState, findingId, organizationId, legacyProjection]
  );

  const { eventType, transition } = operationalAuditEvent(fromState, toState);
  await writeFindingLifecycleEvent({
    organizationId,
    findingId,
    axis: "operational",
    fromState,
    toState,
    transition,
    actor,
  });

  // Independent Governance Review: on a real transition INTO 'remediated', route the
  // governance decision to an assigned closure owner (admin ≠ remediator) when the org
  // enforces closure SoD. Fully guarded by the workflow flag FIRST — with it off this
  // branch issues ZERO extra SQL, so flag-off recompute is byte-identical. The remediator
  // is the actor of this very transition (the person who completed the last Action), which
  // is the same counterparty the close-time SoD gate resolves.
  let assignedReviewerUserId: string | null = null;
  if (toState === "remediated" && independentReviewEnabled()) {
    const assignment = await assignIndependentReviewerIfNeeded(
      organizationId,
      findingId,
      actor.actorUserId,
      actor
    );
    assignedReviewerUserId = assignment.assignedReviewerUserId;
  }

  return { changed: true, fromState, toState, auditEvent: eventType, assignedReviewerUserId };
}
