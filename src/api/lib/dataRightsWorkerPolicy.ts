/**
 * dataRightsWorkerPolicy.ts — DB-free policy for the data-rights worker (PR #3).
 *
 * The retry/backoff/dead-letter decision and the worker's constants live here,
 * with NO import of infra/postgres, so they are unit-testable without a database
 * (infra/postgres throws at module-eval when DATABASE_URL is unset — the same
 * reason the export executor is split from its pure query builders). The
 * DB-touching executor (claim / process / record) lives in dataRightsWorker.ts
 * and re-exports this surface.
 */

/** The job types this worker claims. Deletion-reap + export-purge are out of scope. */
export const EXPORT_JOB_TYPES = ["data_export_self", "data_export_org"] as const;

/** Visibility timeout (Decision D-5): a 'processing' job whose lock is older
 *  than this is presumed crashed and is reclaimed by the next claim poll. */
export const LOCK_TIMEOUT_MS = 15 * 60 * 1000;

/** Backoff is capped so a permanently-failing job still retries on a sane cadence. */
export const MAX_BACKOFF_MS = 60 * 60 * 1000;

/** A failure that must NOT be retried — the job goes straight to 'failed'. */
export class NonRetryableJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NonRetryableJobError";
  }
}

/**
 * Exponential backoff for the given (post-claim) attempt count, 1-based:
 * attempt 1 → 1m, 2 → 2m, 3 → 4m, … capped at MAX_BACKOFF_MS.
 */
export function backoffMs(attempts: number): number {
  const exp = Math.max(0, attempts - 1);
  return Math.min(60_000 * 2 ** exp, MAX_BACKOFF_MS);
}

/**
 * Pure retry decision (Decisions D-4/D-5). `attempts` is the value AFTER the
 * claim incremented it (i.e. how many times this job has now been tried):
 *  • NonRetryableJobError  → 'failed'        (terminal, no backoff)
 *  • attempts >= max       → 'dead_lettered' (terminal, needs a human)
 *  • otherwise             → 'queued'        (requeue at now + backoff)
 */
export function decideFailureState(
  job: { attempts: number; max_attempts: number },
  err: unknown,
  now: Date,
): { status: "failed" | "dead_lettered" | "queued"; nextAttemptAt: Date | null } {
  if (err instanceof NonRetryableJobError) {
    return { status: "failed", nextAttemptAt: null };
  }
  if (job.attempts >= job.max_attempts) {
    return { status: "dead_lettered", nextAttemptAt: null };
  }
  return { status: "queued", nextAttemptAt: new Date(now.getTime() + backoffMs(job.attempts)) };
}
