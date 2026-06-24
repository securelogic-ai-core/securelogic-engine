/**
 * accountDeletionEnqueuer.ts — D-10: the SOLE producer of account_deletion_reap
 * jobs. A cron scans `users` whose 30-day grace window has elapsed
 * (status='pending_deletion' AND deletion_scheduled_at <= now()) and enqueues
 * one reap job each, de-duped against any in-flight reap job for the same user.
 *
 * Cross-org scan on the ELEVATED channel (same shape as the brief/digest
 * schedulers). INERT while the reaper flag is off — returns 0 without touching
 * the DB, so the request endpoint (also gated) can never strand a user in
 * 'pending_deletion' with no reaper to collect them.
 *
 * The request endpoint sets `deletion_scheduled_at = now() + 30 days` (the reap
 * time); there is no separate grace column.
 */

import { schedule } from "node-cron";
import { pgElevated } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import {
  accountDeletionReaperEnabled,
  ACCOUNT_DELETION_REAP_JOB_TYPE,
} from "./accountDeletionReaperPolicy.js";

/**
 * Enqueue a reap job for every user past their grace window. Single elevated
 * INSERT..SELECT with a NOT EXISTS de-dup, so concurrent enqueuer ticks and
 * the per-job idempotency gate can never double-reap. Returns the count
 * enqueued. Never throws on the empty/disabled path.
 */
export async function enqueueDueAccountDeletions(): Promise<number> {
  if (!accountDeletionReaperEnabled()) return 0;

  const { rows } = await pgElevated.query<{ id: string }>(
    `INSERT INTO jobs (organization_id, requested_by_user_id, job_type, payload)
     SELECT u.organization_id,
            u.deletion_requested_by_user_id,
            $1,
            jsonb_build_object('userId', u.id, 'organizationId', u.organization_id)
       FROM users u
      WHERE u.status = 'pending_deletion'
        AND u.deletion_scheduled_at IS NOT NULL
        AND u.deletion_scheduled_at <= now()
        AND NOT EXISTS (
          SELECT 1 FROM jobs j
           WHERE j.job_type = $1
             AND j.payload->>'userId' = u.id::text
             AND j.status IN ('queued', 'processing')
        )
     RETURNING id`,
    [ACCOUNT_DELETION_REAP_JOB_TYPE]
  );

  if (rows.length > 0) {
    logger.info(
      { event: "account_deletion_reap_enqueued", count: rows.length },
      `Enqueued ${rows.length} account-deletion reap job(s)`
    );
  }
  return rows.length;
}

/**
 * Register the hourly enqueuer cron (engine side). Always registered; each tick
 * self-gates on the reaper flag inside enqueueDueAccountDeletions, so a flag
 * flip takes effect on the next tick with no redeploy, and the tick is a pure
 * no-op (no DB access) while the flag is off.
 */
export function startAccountDeletionReaperEnqueuer(): void {
  schedule("17 * * * *", () => {
    void enqueueDueAccountDeletions().catch((err) => {
      logger.error(
        { event: "account_deletion_enqueuer_error", err },
        "Account-deletion reaper enqueuer tick failed"
      );
    });
  });
  logger.info(
    { event: "account_deletion_enqueuer_registered", schedule: "17 * * * * (hourly, UTC)" },
    "Account-deletion reaper enqueuer registered"
  );
}
