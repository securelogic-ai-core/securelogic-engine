/**
 * governanceAudit.ts — immutable audit events for governance actions.
 *
 * TWO deliberate departures from lib/auditLog.ts, each closing an invariant:
 *
 * 1. TRANSACTIONAL, NOT FIRE-AND-FORGET (TDG-12). auditLog.ts writes on the
 *    ELEVATED pool and swallows failures, which is right when a lost audit row
 *    must never fail a customer's business operation. It is wrong here: the
 *    business operation IS the destruction of data, and "we deleted it but the
 *    record of deleting it did not land" is precisely the failure this
 *    programme exists to prevent. These writes therefore go on the TENANT
 *    channel (`pg`), which inside withTenant() is the same transaction as the
 *    delete, and they THROW on failure so the delete rolls back with them. A
 *    deletion and its record cannot diverge because they are the same commit.
 *
 * 2. CONTENT CANNOT BE EXPRESSED (TDG-14). Payloads are built from closed
 *    interfaces with no free-form field. There is no `content`, no `title`, no
 *    `text`, and no `Record<string, unknown>` escape hatch — a caller wanting
 *    to log a conversation's contents would have to change this file, which is
 *    the review surface where that gets caught. Titles count as content: they
 *    are model-generated FROM the conversation.
 *
 * The table is security_audit_log, unchanged: it is already append-only at the
 * database level (20260614), and its organization_id is ON DELETE SET NULL, so
 * the record of an erasure survives the erasure it describes — which a new
 * org-FK'd governance table would not.
 */

import { pg } from "../../infra/postgres.js";

export const GOVERNANCE_EVENT_TYPES = {
  policyChanged: "governance.retention_policy_changed",
  holdPlaced: "governance.legal_hold_placed",
  holdReleased: "governance.legal_hold_released",
  objectDeleted: "governance.object_deleted",
  expiryExecuted: "governance.retention_expiry_executed",
  sweepSuppressed: "governance.retention_sweep_suppressed",
  sweepFailed: "governance.retention_sweep_failed",
  erasureSuppressed: "governance.erasure_suppressed"
} as const;

export type GovernanceEventType =
  (typeof GOVERNANCE_EVENT_TYPES)[keyof typeof GOVERNANCE_EVENT_TYPES];

/** Who deletion came from. Owner and expiry share a code path but not a story. */
export type DeletionTrigger = "owner_request" | "administrator" | "retention_expiry";

/* ── Payload shapes. Every field is metadata about governance, never content. ── */

export interface PolicyChangedPayload {
  dataClass: string;
  previousDays: number | null;
  previousSource: string;
  newDays: number | null;
  newSource: string;
  cleared: boolean;
  version: number;
}

export interface HoldPayload {
  scopeType: string;
  dataClass: string | null;
  subjectUserId: string | null;
  objectId: string | null;
  /** The stated reason — operator-authored governance text, not customer content. */
  reason: string;
  placedByUserId: string | null;
}

export interface ObjectDeletedPayload {
  dataClass: string;
  objectId: string;
  ownerUserId: string | null;
  /** How much was destroyed, never what it said. */
  childRowCounts: Record<string, number>;
  ageAnchor: string | null;
  trigger: DeletionTrigger;
  policyVersionId: string | null;
  retentionDays: number | null;
}

export interface SweepRunPayload {
  dataClass: string;
  cutoff: string;
  retentionDays: number;
  policyVersionId: string | null;
  policySource: string;
  eligibleCount: number;
  deletedCount: number;
  suppressedByHoldCount: number;
  childRowCounts: Record<string, number>;
  dryRun: boolean;
}

export interface SweepFailedPayload {
  dataClass: string;
  attempt: number;
  maxAttempts: number;
  errorCode: string;
  deletedBeforeFailure: 0;
}

/**
 * An erasure the platform declined to perform because a hold covers the
 * subject. Records that the request was received and NOT actioned — the absence
 * of an erasure is exactly the thing a regulator or an opposing party will ask
 * us to evidence.
 */
export interface ErasureSuppressedPayload {
  lifecycleEvent: string;
  subjectUserId: string;
  holdId: string;
  /** What would have happened had the hold not been there. */
  suppressedAction: string;
}

export type GovernancePayload =
  | { type: typeof GOVERNANCE_EVENT_TYPES.policyChanged; data: PolicyChangedPayload }
  | { type: typeof GOVERNANCE_EVENT_TYPES.holdPlaced; data: HoldPayload }
  | { type: typeof GOVERNANCE_EVENT_TYPES.holdReleased; data: HoldPayload & { releaseReason: string } }
  | { type: typeof GOVERNANCE_EVENT_TYPES.objectDeleted; data: ObjectDeletedPayload }
  | { type: typeof GOVERNANCE_EVENT_TYPES.expiryExecuted; data: SweepRunPayload }
  | { type: typeof GOVERNANCE_EVENT_TYPES.sweepSuppressed; data: SweepRunPayload }
  | { type: typeof GOVERNANCE_EVENT_TYPES.sweepFailed; data: SweepFailedPayload }
  | { type: typeof GOVERNANCE_EVENT_TYPES.erasureSuppressed; data: ErasureSuppressedPayload };

export interface GovernanceEventInput {
  organizationId: string;
  actorUserId: string | null;
  actorApiKeyId?: string | null;
  resourceType: string;
  resourceId?: string | null;
  ipAddress?: string | null;
  event: GovernancePayload;
}

/**
 * Write one governance event on the TENANT channel — i.e. inside the caller's
 * withTenant transaction. THROWS if the row cannot be written; callers must not
 * catch it, because the whole point is that the surrounding destructive
 * transaction dies with it.
 */
export async function recordGovernanceEvent(input: GovernanceEventInput): Promise<void> {
  await pg.query(
    `INSERT INTO security_audit_log (
       organization_id, actor_api_key_id, actor_user_id,
       event_type, resource_type, resource_id, payload, ip_address
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      input.organizationId,
      input.actorApiKeyId ?? null,
      input.actorUserId,
      input.event.type,
      input.resourceType,
      input.resourceId ?? null,
      JSON.stringify(input.event.data),
      input.ipAddress ?? null
    ]
  );
}
