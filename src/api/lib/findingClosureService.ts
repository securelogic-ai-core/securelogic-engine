/**
 * findingClosureService.ts — THE canonical closure service for the legacy compat axis.
 *
 * PRODUCT RULING (2026-07-14): a legacy compatibility write must never fabricate a
 * governance decision.
 *
 *   `PATCH /api/findings/:id {"status":"closed"}` is a COMPATIBILITY ENTRY POINT. It
 *   delegates here; it does not force-write closure inline. And it MUST NOT set
 *   decision_state='resolved'.
 *
 * WHY NOT decision_state='resolved'
 *
 * The two axes answer different questions:
 *   operational_status — "is operational work still required?"
 *   decision_state     — "has an authorized governance decision been made?"
 *
 * A legacy API caller cannot be assumed to have performed governance review, validation or
 * approval — it frequently has no user attached at all. Writing 'resolved' on its behalf
 * would fabricate a governance decision that never occurred, and would undermine the
 * Decision Workspace, the separation-of-duties model (which exists precisely to protect
 * 'resolved'), the governance audit trail, and the accepted-risk workflow.
 *
 * So this service closes the OPERATIONAL lifecycle and leaves decision_state exactly as it
 * found it. The canonical governance workflows remain the ONLY paths to 'resolved'.
 *
 * WHAT IT FIXES BESIDES THE GATE
 *
 * The route used to force-write `operational_status` inline, which broke two invariants:
 *
 *   1. AUDIT. finding-lifecycle-spec §7 says recomputeFindingOperationalStatus is the ONLY
 *      writer of operational_status ("never hand-set"), and it emits a lifecycle event only
 *      when the state actually CHANGES. The route wrote 'closed' itself, so by the time the
 *      recompute ran there was no change left to record — and a legacy close, THE closure
 *      path customers actually use in production, wrote NO lifecycle event and NO audit
 *      record. A closure nobody can see in the audit trail may as well not have been
 *      governed at all. The same hole swallowed the REOPEN event.
 *
 *   2. DERIVATION. The inline CASE hard-coded 'closed'/'open' instead of asking
 *      deriveOperationalStatus, so the legacy axis could contradict the very function that
 *      is supposed to own the answer.
 *
 * This service does the write, so it knows the true `fromState` and can emit exactly one
 * correct event per transition — close AND reopen, symmetrically.
 *
 * The lifecycle event and the audit record both carry the compat marker, so the audit
 * history makes it obvious that operational closure occurred, that no governance
 * resolution was inferred, and that no decision_state transition was fabricated.
 */

import { pg } from "../infra/postgres.js";
import { SQL_ACCEPTANCE_BINDING } from "./riskAcceptanceContract.js";
import { riskAcceptanceEnabled } from "./riskAcceptanceFeatureFlag.js";
import {
  deriveOperationalStatus,
  isLegacyTerminal,
  operationalAuditEvent,
} from "./findingLifecycleMachine.js";
import {
  writeFindingLifecycleEvent,
  type LifecycleActor,
} from "./findingLifecycle.js";
import {
  evaluateFindingClosure,
  findingClosureGateEnabled,
  loadClosureBlockers,
  type ClosureRefusal,
} from "./findingClosurePolicy.js";

/**
 * The audit marker. Recorded on the lifecycle event's `comment` and echoed in the audit
 * payload's `closure_path`, so an auditor reading either trail sees immediately that this
 * closure came through compatibility and NOT through governance resolution.
 */
export const LEGACY_COMPAT_CLOSURE_COMMENT =
  "Operationally closed via legacy compatibility path. No governance resolution inferred; decision_state unchanged.";

export const LEGACY_COMPAT_REOPEN_COMMENT =
  "Operationally reopened via legacy compatibility path. decision_state unchanged.";

export type LegacyStatusOutcome =
  | { kind: "not_found" }
  | { kind: "refused"; httpStatus: 409; body: ClosureRefusal }
  | {
      kind: "applied";
      changed: boolean;
      fromState: string;
      toState: string;
      /** security_audit_log event name — null when nothing moved (idempotent re-write). */
      auditEvent: string | null;
      /** Proof, returned for the caller's audit payload: governance was NOT touched. */
      decisionState: string | null;
    };

/**
 * Apply a legacy `status` write through the canonical lifecycle.
 *
 * Runs inside the caller's asTenant() transaction (the ambient `pg` routes to the tenant
 * client), so the gate read, the write, and the lifecycle append are ATOMIC — and a refusal
 * leaves no partial state because nothing is written before the gate passes.
 *
 * Org-scoped throughout: every statement carries organization_id, so a cross-org id can
 * never move a foreign Finding — it reads as not_found, exactly as it must.
 */
export async function applyLegacyStatusTransition(params: {
  organizationId: string;
  findingId: string;
  /** The requested legacy status — already validated against VALID_PATCH_STATUSES. */
  newStatus: string;
  actor: LifecycleActor;
}): Promise<LegacyStatusOutcome> {
  const { organizationId, findingId, newStatus, actor } = params;

  // FOR UPDATE: a concurrent Action write and a concurrent close cannot interleave into a
  // contradiction, and `fromState` is the state we are genuinely transitioning from.
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
  const row = current.rows[0];
  if (!row) return { kind: "not_found" };

  const fromState = String(row.operational_status ?? "open");
  const decisionState = row.decision_state ?? null;
  const closing = isLegacyTerminal(newStatus);

  // THE GATE. Flag-gated, and consulted BEFORE any mutation — so a refusal writes nothing,
  // on either axis, and cancels no Action. Flag OFF: not consulted at all, no query issued,
  // no 409 possible; the legacy permission contract is preserved byte for byte.
  if (closing && findingClosureGateEnabled()) {
    const decision = evaluateFindingClosure(
      await loadClosureBlockers(pg, organizationId, findingId, {
        acceptanceEnabled: riskAcceptanceEnabled(),
      })
    );
    if (!decision.allowed) {
      return { kind: "refused", httpStatus: decision.httpStatus, body: decision.body };
    }
  }

  // Ask the derivation what this write MEANS, rather than hard-coding it. The legacy status
  // being written is fed in as the pending closure input, so:
  //   closing  → 'closed' (the compat bridge)
  //   reopening→ the Finding's REAL state from its Actions (open / in_progress /
  //              remediated), not a provisional 'open' that a second pass has to correct.
  const actions = await pg.query<{ status: string }>(
    `SELECT status FROM actions
      WHERE organization_id = $1 AND source_type = 'finding' AND source_id = $2`,
    [organizationId, findingId]
  );
  const gateRow = await pg.query<{ enforced: boolean; has_evidence: boolean }>(
    `SELECT
       COALESCE((SELECT s.require_evidence_gate FROM risk_settings s
                  WHERE s.organization_id = $1), FALSE) AS enforced,
       EXISTS(SELECT 1 FROM evidence e
               WHERE e.organization_id = $1
                 AND e.source_type = 'finding' AND e.source_id = $2) AS has_evidence`,
    [organizationId, findingId]
  );
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
    {
      enforced: gateRow.rows[0]?.enforced === true,
      hasEvidence: gateRow.rows[0]?.has_evidence === true,
    },
    // decisionState is passed through UNCHANGED — read, never written. If a governance
    // decision already closed this Finding, the derivation still honours it; this service
    // simply never creates one.
    { decisionState, legacyStatus: newStatus, hasBindingAcceptance: acceptanceBinding }
  );

  // Both axes in ONE statement: findings_closure_axes_agree is a CHECK, CHECKs are not
  // deferrable, so `status` and `operational_status` may never disagree even for the width
  // of a single UPDATE. decision_state is absent from the SET list — by ruling.
  await pg.query(
    `UPDATE findings SET status = $1, operational_status = $2, updated_at = NOW()
      WHERE id = $3 AND organization_id = $4`,
    [newStatus, toState, findingId, organizationId]
  );

  // Nothing moved on the authoritative axis (e.g. re-closing an already-closed Finding, or
  // a legacy write that changes nothing derivable). Idempotent: no event, no audit noise.
  if (toState === fromState) {
    return {
      kind: "applied",
      changed: false,
      fromState,
      toState,
      auditEvent: null,
      decisionState,
    };
  }

  const { eventType, transition } = operationalAuditEvent(fromState, toState);
  await writeFindingLifecycleEvent({
    organizationId,
    findingId,
    axis: "operational",
    fromState,
    toState,
    transition,
    actor,
    comment: closing ? LEGACY_COMPAT_CLOSURE_COMMENT : LEGACY_COMPAT_REOPEN_COMMENT,
  });

  return {
    kind: "applied",
    changed: true,
    fromState,
    toState,
    auditEvent: eventType,
    decisionState,
  };
}
