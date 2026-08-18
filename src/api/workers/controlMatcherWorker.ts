/**
 * controlMatcherWorker.ts — asynchronous execution of LLM control-suggestion
 * work, owned by the intelligence worker.
 *
 * WHAT MOVED, AND WHAT DID NOT
 * ----------------------------
 * The LLM control matcher used to run INLINE inside `processSignal` (phase 7),
 * so the weekly Brief scheduler awaited one provider call per Critical/High
 * signal per org, strictly sequentially. Measured on staging 2026-08-18: the
 * slowest org spent 87.6% of its 3.15-hour runtime inside those calls, holding
 * the scheduler's overlap lock while every other org waited — to produce
 * `signal_match_suggestions` rows that Brief generation never reads (it queries
 * `cyber_signals` only).
 *
 * This worker executes exactly the same matcher, against the same inputs, and
 * writes the same rows. Only WHERE and WHEN changed. Brief publication no
 * longer waits for it, and a matcher failure can no longer affect a brief:
 * publication and suggestion generation are now separate transactions in
 * separate processes.
 *
 * WHY NOTHING IS LOST ACROSS A RESTART
 * ------------------------------------
 * Producers enqueue on the SAME transaction that commits the signal's
 * processing, so a job exists iff that processing committed. The claim is
 * `FOR UPDATE SKIP LOCKED` with a lock-timeout reclaim, so a job whose worker
 * died mid-flight is re-claimed once `locked_at` goes stale rather than being
 * stranded in `processing`. The queue is durable; the process is not.
 *
 * WHY DUPLICATES ARE HARMLESS
 * ---------------------------
 * `runControlMatcherWithOutcome` is fronted by the verdict cache. A second
 * invocation for the same (org, signal, control-inventory, prompt-version)
 * either replays the stored verdict — writing identical rows for zero provider
 * spend — or loses the `INSERT … ON CONFLICT` reservation race and skips the
 * call entirely. Over-enqueueing is safe; under-enqueueing is not, which is why
 * the producer-side dedup deliberately does not cover in-flight jobs.
 *
 * WHY RETRY LIVES AT THE JOB LEVEL
 * --------------------------------
 * The verdict cache already carries a retry budget that "is consumed by
 * claims" — but inline execution never re-claimed, so that budget was
 * unreachable: a failed call simply produced no suggestion, forever. The job
 * queue is the re-claim mechanism it was designed for. A retryable outcome
 * re-queues with backoff (`decideFailureState`), each attempt re-reserves and
 * consumes one unit of the verdict budget, and exhaustion dead-letters visibly
 * at both levels instead of silently yielding "no suggestions".
 *
 * PROVIDER CONCURRENCY IS DELIBERATELY NOT INCREASED. One job at a time per
 * tick, exactly as the inline path issued one call at a time. This package
 * removes the latency from the critical path; it does not hide it behind a
 * wider fan-out.
 *
 * FLAG GATE: the existing `SECURELOGIC_LLM_CONTROL_MATCHER_ENABLED` governs
 * both ends — `shouldRunControlMatcher` blocks the enqueue and this tick
 * refuses to claim. No new environment variable exists, and turning that one
 * flag off drains the feature at both ends.
 */

import { pg, pgElevated, withTenant } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import {
  LOCK_TIMEOUT_MS,
  NonRetryableJobError,
  decideFailureState
} from "../lib/dataRightsWorkerPolicy.js";
import {
  CONTROL_MATCHER_JOB_TYPE,
  parseControlMatcherPayload
} from "../lib/controlMatcherQueue.js";
import {
  runControlMatcherWithOutcome,
  llmControlMatcherEnabled,
  type SignalForControlMatch
} from "../lib/llmControlMatcher.js";

export interface JobRow {
  id: string;
  organization_id: string;
  job_type: string;
  status: string;
  attempts: number;
  max_attempts: number;
  payload: Record<string, unknown> | null;
}

export interface WorkerDeps {
  now?: () => Date;
  workerId?: string;
  /** Loop guard: runOneTick stops claiming when this returns false (shutdown). */
  shouldContinue?: () => boolean;
}

/**
 * Claim on the ELEVATED channel — a context-less poller on the tenant channel
 * would see zero rows post-RLS-flip. Everything after the claim is tenant-scoped.
 *
 * The `status = 'processing' AND locked_at < now() - timeout` arm is what makes
 * a restart non-lossy: it re-claims jobs abandoned by a dead process.
 */
const CLAIM_SQL = `
  UPDATE jobs
     SET status = 'processing',
         locked_by = $1,
         locked_at = now(),
         attempts = attempts + 1,
         updated_at = now()
   WHERE id = (
     SELECT id FROM jobs
      WHERE job_type = $2
        AND (
              (status = 'queued' AND scheduled_for <= now())
           OR (status = 'processing' AND locked_at < now() - ($3::bigint * interval '1 millisecond'))
        )
      ORDER BY scheduled_for
      FOR UPDATE SKIP LOCKED
      LIMIT 1
   )
   RETURNING id, organization_id, job_type, status, attempts, max_attempts, payload`;

export async function claimNextJob(workerId: string): Promise<JobRow | null> {
  const { rows } = await pgElevated.query(CLAIM_SQL, [
    workerId,
    CONTROL_MATCHER_JOB_TYPE,
    LOCK_TIMEOUT_MS
  ]);
  return (rows[0] as JobRow | undefined) ?? null;
}

/**
 * Load the signal the job names, inside the org's tenant scope.
 *
 * Read here rather than carried in the payload so the matcher always sees the
 * current row, and so tenant isolation is enforced by the same RLS scope that
 * governs every other read of `cyber_signals` — a payload-carried summary would
 * bypass that check entirely.
 */
async function loadSignal(
  orgId: string,
  signalId: string
): Promise<SignalForControlMatch | null> {
  return withTenant(orgId, async () => {
    const { rows } = await pg.query<{
      id: string;
      signal_type: string;
      severity: string;
      normalized_summary: string;
    }>(
      `SELECT id, signal_type, severity, normalized_summary
         FROM cyber_signals
        WHERE id = $1 AND organization_id = $2`,
      [signalId, orgId]
    );
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      signal_type: row.signal_type,
      severity: row.severity,
      normalized_summary: row.normalized_summary
    } as SignalForControlMatch;
  });
}

/**
 * Persist a failure outcome. Never throws.
 *
 * If the write itself fails the job stays 'processing', and the claim query's
 * lock-timeout arm re-claims it on a later tick — degraded but not lost. That
 * is strictly better than letting the write error escape and abort the whole
 * tick, which would leave the rest of the queue undrained for the same reason.
 */
async function recordFailure(job: JobRow, err: unknown, now: Date): Promise<void> {
  try {
    await recordFailureUnsafe(job, err, now);
  } catch (writeErr) {
    logger.error(
      {
        event: "control_matcher_job_state_write_failed",
        job_id: job.id,
        organization_id: job.organization_id,
        err: writeErr
      },
      "Could not persist control-suggestion job failure — job stays 'processing' and is re-claimed after the lock timeout"
    );
  }
}

async function recordFailureUnsafe(job: JobRow, err: unknown, now: Date): Promise<void> {
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
  });

  if (decision.status === "dead_lettered") {
    logger.error(
      {
        event: "control_matcher_job_exhausted",
        job_id: job.id,
        organization_id: job.organization_id,
        attempts: job.attempts,
        max_attempts: job.max_attempts,
        error: message
      },
      "Control-suggestion job exhausted its retry budget — dead-lettered, needs a human"
    );
    return;
  }
  if (decision.status === "queued") {
    logger.warn(
      {
        event: "control_matcher_job_retry_scheduled",
        job_id: job.id,
        organization_id: job.organization_id,
        attempts: job.attempts,
        next_attempt_at: decision.nextAttemptAt?.toISOString() ?? null,
        error: message
      },
      "Control-suggestion job will be retried"
    );
    return;
  }
  logger.error(
    {
      event: "control_matcher_job_failed",
      job_id: job.id,
      organization_id: job.organization_id,
      attempts: job.attempts,
      error: message
    },
    "Control-suggestion job failed permanently (non-retryable)"
  );
}

/**
 * Process one already-claimed job to completion. Never throws — every outcome
 * is persisted to the row (the data-rights / vendor-extraction discipline).
 */
export async function processClaimedJob(job: JobRow, deps: WorkerDeps = {}): Promise<void> {
  const now = deps.now ?? (() => new Date());
  const orgId = job.organization_id;
  const startedAt = Date.now();

  const parsed = parseControlMatcherPayload(job.payload);
  if (!parsed) {
    await recordFailure(
      job,
      new NonRetryableJobError("control_matcher_suggest job payload has no signal_id"),
      now()
    );
    return;
  }

  try {
    const signal = await loadSignal(orgId, parsed.signal_id);

    // The signal is gone (deleted, or the org was purged). There is nothing to
    // suggest against and no later attempt could change that.
    if (!signal) {
      await recordFailure(
        job,
        new NonRetryableJobError(`signal ${parsed.signal_id} not found for org ${orgId}`),
        now()
      );
      return;
    }

    const result = await runControlMatcherWithOutcome(signal, orgId);

    if (result.retryable) {
      // Surface it as a job failure so decideFailureState applies backoff and
      // the verdict cache's retry budget is actually consumed by a re-claim.
      await recordFailure(
        job,
        new Error(`control matcher outcome '${result.outcome}' is retryable`),
        now()
      );
      return;
    }

    // The matcher's rows are already committed by this point; only the job's
    // own bookkeeping remains. If that write fails the job is re-claimed later
    // and the verdict cache makes the re-execution free, so it is safe to let
    // the outer catch record it rather than escaping the tick.
    await withTenant(orgId, async () => {
      await pg.query(
        `UPDATE jobs
            SET status = 'succeeded', result = $2::jsonb, error = NULL,
                locked_by = NULL, locked_at = NULL, updated_at = now()
          WHERE id = $1`,
        [job.id, JSON.stringify({ outcome: result.outcome, written: result.written })]
      );
    });

    logger.info(
      {
        event: "control_matcher_job_completed",
        job_id: job.id,
        organization_id: orgId,
        signal_id: parsed.signal_id,
        outcome: result.outcome,
        suggestions_written: result.written,
        attempts: job.attempts,
        duration_ms: Date.now() - startedAt
      },
      "Control-suggestion job completed"
    );
  } catch (err) {
    // Reaching here means an unforeseen throw — loadSignal or the terminal
    // UPDATE, not the matcher, which swallows its own failures.
    await recordFailure(job, err, now());
  }
}

/**
 * Claim and process until the queue is empty.
 *
 * Deliberately sequential: one provider call in flight at a time, matching what
 * the inline path did. Increasing this would widen provider concurrency to mask
 * latency, which this package explicitly does not do.
 */
export async function runOneTick(deps: WorkerDeps = {}): Promise<number> {
  if (!llmControlMatcherEnabled()) return 0;

  const workerId = deps.workerId ?? `control-matcher-${process.pid}`;
  let processed = 0;
  for (;;) {
    if (deps.shouldContinue && !deps.shouldContinue()) break;
    const job = await claimNextJob(workerId);
    if (!job) break;
    await processClaimedJob(job, deps);
    processed += 1;
  }
  if (processed > 0) {
    logger.info(
      { event: "control_matcher_tick_complete", processed },
      "Control-suggestion worker tick complete"
    );
  }
  return processed;
}
