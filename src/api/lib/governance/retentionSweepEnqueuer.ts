/**
 * retentionSweepEnqueuer.ts — the SOLE producer of retention_sweep jobs.
 *
 * Shaped exactly like accountDeletionEnqueuer: a cross-org scan on the ELEVATED
 * channel, de-duped against any in-flight job for the same (org, class), and
 * INERT while the flag is off — it returns 0 without touching the database, so
 * a disabled feature cannot strand work in the queue for a worker that will
 * never claim it.
 *
 * ONE JOB PER (organization, data class). The fan-out is a cross product of
 * orgs and registered classes, computed here rather than in the worker, so a
 * failing class for one tenant cannot starve another tenant's sweep.
 *
 * Classes are enqueued in dependency order (content before the ledger its
 * deletion orphans), so a single pass reclaims both instead of leaving orphaned
 * provenance rows waiting a day for the next tick.
 *
 * It produces jobs even while `SECURELOGIC_TDG_EFFECTIVE_FROM` is unset. That
 * is deliberate: those runs plan, find the activation gate closed, and record a
 * blocked outcome with counts — which is exactly the evidence needed to answer
 * "what WOULD this delete" before anyone authorizes it.
 */

import { schedule } from "node-cron";
import { pgElevated } from "../../infra/postgres.js";
import { logger } from "../../infra/logger.js";
import { listDataClasses, sweepOrder } from "./dataClasses.js";
import { tenantDataGovernanceEnabled, RETENTION_SWEEP_JOB_TYPE } from "./tdgPolicy.js";

/**
 * Enqueue one sweep job per (organization, registered class). A single
 * INSERT..SELECT per class with a NOT EXISTS de-dup, so concurrent ticks cannot
 * double-enqueue. Returns the number of jobs created. Never throws on the
 * disabled path.
 */
export async function enqueueRetentionSweeps(): Promise<number> {
  if (!tenantDataGovernanceEnabled()) return 0;

  let enqueued = 0;
  for (const dataClass of sweepOrder(listDataClasses())) {
    const { rows } = await pgElevated.query<{ id: string }>(
      `INSERT INTO jobs (organization_id, job_type, payload)
       SELECT o.id, $1, jsonb_build_object('dataClass', $2::text)
         FROM organizations o
        WHERE NOT EXISTS (
          SELECT 1 FROM jobs j
           WHERE j.job_type = $1
             AND j.organization_id = o.id
             AND j.payload->>'dataClass' = $2::text
             AND j.status IN ('queued', 'processing')
        )
       RETURNING id`,
      [RETENTION_SWEEP_JOB_TYPE, dataClass.key]
    );
    enqueued += rows.length;
  }

  if (enqueued > 0) {
    logger.info(
      { event: "retention_sweeps_enqueued", count: enqueued },
      "retention sweep jobs enqueued"
    );
  }
  return enqueued;
}

/**
 * Daily at 03:20 UTC — off-peak, and deliberately not on the hour so it does not
 * pile onto every other scheduled job. Registering the cron is safe while the
 * flag is off: the tick calls a function that returns 0 without a query.
 */
export function startRetentionSweepEnqueuer(): void {
  schedule("20 3 * * *", () => {
    void enqueueRetentionSweeps().catch((err: unknown) => {
      logger.error({ event: "retention_sweep_enqueue_failed", err }, "retention sweep enqueue failed");
    });
  });
  logger.info(
    { event: "retention_sweep_enqueuer_registered", enabled: tenantDataGovernanceEnabled() },
    "retention sweep enqueuer registered"
  );
}
