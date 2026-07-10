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
import {
  deriveOperationalStatus,
  operationalAuditEvent,
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
}

/**
 * The child→parent cascade (spec §5): recompute the parent Finding's
 * operational_status from ALL its linked Actions, inside the caller's
 * asTenant() transaction. The ONLY writer of findings.operational_status.
 *
 * Org-scoped throughout: both the Action read and the Finding write carry
 * `organization_id = $org`, so a cross-org source_id can never move a foreign
 * finding. Returns what changed so the route can project the audit event.
 */
export async function recomputeFindingOperationalStatus(
  organizationId: string,
  findingId: string,
  actor: LifecycleActor
): Promise<RecomputeResult> {
  const current = await pg.query(
    `SELECT operational_status FROM findings
      WHERE id = $1 AND organization_id = $2
      FOR UPDATE`,
    [findingId, organizationId]
  );
  if ((current.rowCount ?? 0) === 0) return { changed: false };
  const fromState = String(current.rows[0].operational_status ?? "open");

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

  const toState = deriveOperationalStatus(
    actions.rows.map((r) => String(r.status ?? "")),
    gate
  );

  if (toState === fromState) return { changed: false };

  await pg.query(
    `UPDATE findings SET operational_status = $1, updated_at = NOW()
      WHERE id = $2 AND organization_id = $3`,
    [toState, findingId, organizationId]
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

  return { changed: true, fromState, toState, auditEvent: eventType };
}
