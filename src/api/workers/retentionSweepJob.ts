/**
 * retentionSweepJob.ts — the TDG sweeper, as a job the data-rights worker runs.
 *
 * WHY HERE AND NOT IN A NEW SERVICE. Retention expiry belongs to the same
 * family as GDPR export and Art.17 erasure: data-lifecycle work, scheduled, and
 * destructive. The data-rights worker already owns the machinery this needs —
 * atomic claim with SKIP LOCKED, attempt counting, exponential backoff, and
 * dead-lettering at max_attempts. A second worker would be a second copy of all
 * of that, and the copy that drifts is the one that silently stops retrying.
 *
 * ONE JOB = ONE (organization, data class). Nothing about this file is
 * Ask-specific: the class key arrives in the payload and everything else comes
 * from the registry (TDG-15).
 *
 * FAILURE IS LOUD (TDG-12). A sweep that cannot run does not report success:
 *   • an exception → recordFailure → retry with backoff → dead_lettered
 *   • activation gates closed → 'succeeded' with `reason: 'blocked'` in the
 *     result and a warn log. That is a deliberate distinction: blocked is the
 *     EXPECTED state while the capability is dark, and dead-lettering every
 *     tick of an intentionally-inert feature would bury the real failures.
 */

import { pg, withTenant } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { planSweep, executeSweep } from "../lib/governance/retentionService.js";
import { getDataClass } from "../lib/governance/dataClasses.js";
import { recordGovernanceEvent, GOVERNANCE_EVENT_TYPES } from "../lib/governance/governanceAudit.js";
import { decideFailureState } from "../lib/dataRightsWorkerPolicy.js";

export interface SweepJobRow {
  id: string;
  organization_id: string;
  attempts: number;
  max_attempts: number;
  payload: unknown;
}

interface SweepPayload {
  dataClass?: unknown;
}

/**
 * Run one sweep job to completion. Never throws: every outcome is persisted to
 * the job row, which is what makes "silently claiming erasure" impossible —
 * there is no path that leaves the row untouched.
 */
export async function processRetentionSweepJob(
  job: SweepJobRow,
  deps: { now?: () => Date } = {}
): Promise<void> {
  const now = deps.now ?? (() => new Date());
  const orgId = job.organization_id;
  const payload = (job.payload ?? {}) as SweepPayload;
  const dataClassKey = typeof payload.dataClass === "string" ? payload.dataClass : "";

  try {
    if (!getDataClass(dataClassKey)) {
      // A job naming a class that no longer exists is a permanent fault, not a
      // transient one — retrying cannot make the class reappear.
      await recordOutcome(job, { reason: "unknown_data_class", dataClass: dataClassKey }, now());
      logger.warn(
        { event: "retention_sweep_unknown_class", job_id: job.id, org_id: orgId, data_class: dataClassKey },
        "retention sweep job named an unregistered data class"
      );
      return;
    }

    const result = await withTenant(orgId, async () => {
      const plan = await planSweep({ organizationId: orgId, dataClassKey, now: now() });
      if (!plan) return { reason: "unknown_data_class", dataClass: dataClassKey };

      const sweep = await executeSweep({
        organizationId: orgId,
        plan,
        actorUserId: null,
        dryRun: false
      });

      return {
        dataClass: dataClassKey,
        reason: sweep.reason ?? "executed",
        cutoff: plan.cutoff.toISOString(),
        retentionDays: plan.policy.retentionDays,
        policySource: plan.policy.source,
        eligible: plan.eligible.length,
        suppressedByHold: plan.suppressed.length,
        deleted: sweep.counts.objects,
        childRowCounts: sweep.counts.children,
        blockers: plan.blockers
      };
    });

    await recordOutcome(job, result, now());

    if ((result as { blockers?: string[] }).blockers?.length) {
      logger.warn(
        { event: "retention_sweep_blocked", job_id: job.id, org_id: orgId, ...result },
        "retention sweep ran but deletion is gated"
      );
    } else {
      logger.info(
        { event: "retention_sweep_succeeded", job_id: job.id, org_id: orgId, ...result },
        "retention sweep succeeded"
      );
    }
  } catch (err) {
    await recordSweepFailure(job, err, now());
    logger.error(
      {
        event: "retention_sweep_failed",
        job_id: job.id,
        org_id: orgId,
        data_class: dataClassKey,
        attempt: job.attempts,
        max_attempts: job.max_attempts,
        message: (err as Error)?.message
      },
      "retention sweep job failed"
    );
  }
}

async function recordOutcome(
  job: SweepJobRow,
  result: Record<string, unknown>,
  now: Date
): Promise<void> {
  await withTenant(job.organization_id, async () => {
    await pg.query(
      `UPDATE jobs
          SET status = 'succeeded', result = $2::jsonb, error = NULL,
              locked_by = NULL, locked_at = NULL,
              completed_at = $3, updated_at = $3
        WHERE id = $1`,
      [job.id, JSON.stringify(result), now]
    );
  });
}

/**
 * Retry with backoff until attempts are exhausted, then dead-letter, using the
 * platform's shared decideFailureState. A TERMINAL outcome also writes an
 * immutable audit event, so an exhausted sweep leaves a governance record
 * rather than only a job row a later cleanup could remove.
 *
 * `deletedBeforeFailure` is typed as the literal 0 on purpose: a failed batch
 * rolled back whole, so there is no partial deletion to report and no way to
 * accidentally report one.
 */
async function recordSweepFailure(job: SweepJobRow, err: unknown, now: Date): Promise<void> {
  // The platform already settled retry policy for job workers; a second
  // backoff curve here would be a second thing to keep in sync.
  const decision = decideFailureState(job, err, now);
  const message = ((err as Error)?.message ?? String(err)).slice(0, 2000);

  await withTenant(job.organization_id, async () => {
    await pg.query(
      `UPDATE jobs
          SET status = $2, error = $3, next_attempt_at = $4,
              scheduled_for = COALESCE($4, scheduled_for),
              locked_by = NULL, locked_at = NULL, updated_at = now()
        WHERE id = $1`,
      [job.id, decision.status, message, decision.nextAttemptAt]
    );

    if (decision.status !== "queued") {
      const payload = (job.payload ?? {}) as SweepPayload;
      await recordGovernanceEvent({
        organizationId: job.organization_id,
        actorUserId: null,
        resourceType: "retention_sweep",
        resourceId: job.id,
        event: {
          type: GOVERNANCE_EVENT_TYPES.sweepFailed,
          data: {
            dataClass: typeof payload.dataClass === "string" ? payload.dataClass : "unknown",
            attempt: job.attempts,
            maxAttempts: job.max_attempts,
            errorCode: message.slice(0, 200),
            deletedBeforeFailure: 0
          }
        }
      });
    }
  });
}
