/**
 * retentionService.ts — planning and execution for TDG.
 *
 * ONE deletion path serves all three triggers (TDG-10): an owner deleting their
 * own thread, an administrator deleting one they cannot read, and the sweeper
 * expiring one nobody looked at. They differ in who selects the ids and how the
 * outcome is reported — never in what deletion means, and never in whether a
 * legal hold is honoured. A second delete implementation is how a hold gets
 * forgotten, so there isn't one.
 *
 * Every function assumes it is running inside `withTenant(organizationId, …)`,
 * which is also the transaction that the audit write joins (TDG-12).
 */

import { getDataClass, type GovernedDataClass } from "./dataClasses.js";
import { getClassHandler, type DeletionCounts, type GovernedObject } from "./classHandlers.js";
import {
  listPolicyVersions,
  listActiveHolds,
  type LegalHoldRecord
} from "./governanceStore.js";
import { resolveEffectivePolicy, type EffectivePolicy } from "./retentionPolicy.js";
import { holdCovering } from "./holdPredicate.js";
import { activationBlockers, retentionCutoff } from "./tdgPolicy.js";
import {
  recordGovernanceEvent,
  GOVERNANCE_EVENT_TYPES,
  type DeletionTrigger
} from "./governanceAudit.js";

/** Bound on one sweep batch. A run may plan more; it deletes at most this many. */
export const SWEEP_BATCH_LIMIT = 500;

export interface SuppressedObject {
  objectId: string;
  holdId: string;
}

export interface SweepPlan {
  dataClass: GovernedDataClass;
  policy: EffectivePolicy;
  cutoff: Date;
  /** Objects past the cutoff, before holds are applied. */
  eligible: GovernedObject[];
  /** Eligible objects a hold protects, with the hold that protects them. */
  suppressed: SuppressedObject[];
  /** Eligible minus suppressed — what a non-dry run would destroy. */
  deletable: string[];
  /** Non-empty means this plan can never delete anything as configured. */
  blockers: string[];
  totalGoverned: number;
}

/**
 * Deterministic and side-effect free: the same (org, class, now) always yields
 * the same plan, and planning NEVER writes — which is what makes dry-run
 * trustworthy as a pre-activation report rather than a rehearsal that mutates.
 */
export async function planSweep(input: {
  organizationId: string;
  dataClassKey: string;
  now?: Date;
  limit?: number;
  env?: NodeJS.ProcessEnv;
}): Promise<SweepPlan | null> {
  const dataClass = getDataClass(input.dataClassKey);
  const handler = getClassHandler(input.dataClassKey);
  if (!dataClass || !handler) return null;

  const now = input.now ?? new Date();
  const limit = input.limit ?? SWEEP_BATCH_LIMIT;

  const versions = await listPolicyVersions(input.organizationId, dataClass.key);
  const policy = resolveEffectivePolicy(dataClass, versions, now);
  const cutoff = retentionCutoff(now, policy.retentionDays);

  const eligible = await handler.selectExpired(input.organizationId, cutoff, limit);

  // Read the hold set ONCE and judge the whole batch against it, so a hold
  // placed mid-run cannot leave a batch half-protected.
  const holds: LegalHoldRecord[] = await listActiveHolds(input.organizationId);

  const suppressed: SuppressedObject[] = [];
  const deletable: string[] = [];
  for (const obj of eligible) {
    const holdId = holdCovering(holds, {
      dataClass: dataClass.key,
      objectId: obj.id,
      ownerUserId: obj.ownerUserId
    });
    if (holdId) suppressed.push({ objectId: obj.id, holdId });
    else deletable.push(obj.id);
  }

  return {
    dataClass,
    policy,
    cutoff,
    eligible,
    suppressed,
    deletable,
    blockers: activationBlockers(input.env ?? process.env, now),
    totalGoverned: await handler.countGoverned(input.organizationId)
  };
}

export interface SweepResult {
  plan: SweepPlan;
  executed: boolean;
  counts: DeletionCounts;
  /** Why nothing was deleted, when nothing was. */
  reason?: "dry_run" | "blocked" | "nothing_eligible";
}

/**
 * Execute a plan. Refuses — visibly, never silently — when the activation gates
 * are not open, and reports `blocked` so the caller says so rather than
 * reporting a successful sweep of zero rows.
 *
 * The deletion and its audit event are the same transaction. If the audit write
 * throws, the deletion rolls back with it, which is the only construction under
 * which "we deleted it" and "we recorded deleting it" cannot diverge.
 */
export async function executeSweep(input: {
  organizationId: string;
  plan: SweepPlan;
  actorUserId: string | null;
  dryRun: boolean;
  ipAddress?: string | null;
}): Promise<SweepResult> {
  const { plan } = input;
  const handler = getClassHandler(plan.dataClass.key);
  if (!handler) throw new Error(`no handler for class '${plan.dataClass.key}'`);

  const emptyCounts: DeletionCounts = { objects: 0, children: {} };

  if (input.dryRun) return { plan, executed: false, counts: emptyCounts, reason: "dry_run" };
  if (plan.blockers.length > 0) {
    return { plan, executed: false, counts: emptyCounts, reason: "blocked" };
  }
  if (plan.deletable.length === 0) {
    // Still worth an event when holds suppressed something: "the sweep ran and
    // deleted nothing because everything was held" is a governance fact.
    if (plan.suppressed.length > 0) {
      await recordSweepEvent(input.organizationId, input.actorUserId, plan, emptyCounts, false,
        GOVERNANCE_EVENT_TYPES.sweepSuppressed, input.ipAddress);
    }
    return { plan, executed: false, counts: emptyCounts, reason: "nothing_eligible" };
  }

  const counts = await handler.deleteObjects(input.organizationId, plan.deletable);

  await recordSweepEvent(input.organizationId, input.actorUserId, plan, counts, false,
    GOVERNANCE_EVENT_TYPES.expiryExecuted, input.ipAddress);

  return { plan, executed: true, counts };
}

async function recordSweepEvent(
  organizationId: string,
  actorUserId: string | null,
  plan: SweepPlan,
  counts: DeletionCounts,
  dryRun: boolean,
  type: typeof GOVERNANCE_EVENT_TYPES.expiryExecuted | typeof GOVERNANCE_EVENT_TYPES.sweepSuppressed,
  ipAddress?: string | null
): Promise<void> {
  await recordGovernanceEvent({
    organizationId,
    actorUserId,
    resourceType: "retention_sweep",
    resourceId: null,
    ipAddress: ipAddress ?? null,
    event: {
      type,
      data: {
        dataClass: plan.dataClass.key,
        cutoff: plan.cutoff.toISOString(),
        retentionDays: plan.policy.retentionDays,
        policyVersionId: plan.policy.policyVersionId,
        policySource: plan.policy.source,
        eligibleCount: plan.eligible.length,
        deletedCount: counts.objects,
        suppressedByHoldCount: plan.suppressed.length,
        childRowCounts: counts.children,
        dryRun
      }
    }
  });
}

/* ──────────────────── single-object deletion (owner / administrator) ──────── */

export type DeleteOutcome =
  | { outcome: "deleted"; counts: DeletionCounts }
  | { outcome: "not_found" }
  | { outcome: "not_owner" }
  | { outcome: "held"; holdId: string };

/**
 * Delete one object on request. `requireOwnerUserId` is set for the owner path
 * and null for the administrator path — an administrator may destroy a thread
 * they have no right to READ, which is the whole point of separating the
 * lifecycle plane from the content plane.
 *
 * A held object is REFUSED, not skipped. An owner told "deleted" whose data was
 * retained under a hold has been misled about their own data; a 409 is honest.
 */
export async function deleteGovernedObject(input: {
  organizationId: string;
  dataClassKey: string;
  objectId: string;
  actorUserId: string | null;
  /** Non-null restricts deletion to objects owned by this user. */
  requireOwnerUserId: string | null;
  trigger: DeletionTrigger;
  ipAddress?: string | null;
  now?: Date;
}): Promise<DeleteOutcome> {
  const dataClass = getDataClass(input.dataClassKey);
  const handler = getClassHandler(input.dataClassKey);
  if (!dataClass || !handler) return { outcome: "not_found" };

  const object = await handler.findObject(input.organizationId, input.objectId);
  if (!object) return { outcome: "not_found" };

  if (input.requireOwnerUserId != null && object.ownerUserId !== input.requireOwnerUserId) {
    return { outcome: "not_owner" };
  }

  const holds = await listActiveHolds(input.organizationId);
  const holdId = holdCovering(holds, {
    dataClass: dataClass.key,
    objectId: object.id,
    ownerUserId: object.ownerUserId
  });
  if (holdId) return { outcome: "held", holdId };

  const counts = await handler.deleteObjects(input.organizationId, [object.id]);
  if (counts.objects === 0) return { outcome: "not_found" };

  // The policy in force is recorded as CONTEXT, not as the basis: an owner
  // deletion is not taken "under" a retention policy, and `trigger` is what
  // distinguishes the two stories in the ledger.
  const versions = await listPolicyVersions(input.organizationId, dataClass.key);
  const policy = resolveEffectivePolicy(dataClass, versions, input.now ?? new Date());

  await recordGovernanceEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    resourceType: dataClass.key,
    resourceId: object.id,
    ipAddress: input.ipAddress ?? null,
    event: {
      type: GOVERNANCE_EVENT_TYPES.objectDeleted,
      data: {
        dataClass: dataClass.key,
        objectId: object.id,
        ownerUserId: object.ownerUserId,
        childRowCounts: counts.children,
        ageAnchor: object.ageAnchor ? object.ageAnchor.toISOString() : null,
        trigger: input.trigger,
        policyVersionId: policy.policyVersionId,
        retentionDays: policy.retentionDays
      }
    }
  });

  return { outcome: "deleted", counts };
}
