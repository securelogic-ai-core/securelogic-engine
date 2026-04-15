import "dotenv/config"
import { withAdvisoryLock } from "../../../src/api/infra/advisoryLock.js"
import { runPipeline } from "./pipeline/runPipeline.js"
import {
  startWorkerRun,
  completeWorkerRun,
  cleanupStaleRuns
} from "../../../src/api/infra/workerLogger.js"
import { sendFailureAlert } from "../../../src/api/infra/alerting.js"
import { logger } from "../../../src/api/infra/logger.js"

/**
 * Fail-fast env check for the intelligence worker.
 *
 * NEWSLETTER_FROM_EMAIL is required for newsletter delivery. Without it,
 * sendNewsletter.ts throws mid-send after the pipeline has already run.
 * Check here so the process exits cleanly before doing any work.
 *
 * Skipped in test mode so unit tests can import runner.ts freely.
 */
export function validateWorkerEnv(): void {
  if (process.env.NODE_ENV === "test") return;

  const from = process.env.NEWSLETTER_FROM_EMAIL?.trim();
  if (!from) {
    if (process.env.NODE_ENV === "production") {
      logger.fatal(
        { event: "worker_env_invalid", missing: "NEWSLETTER_FROM_EMAIL" },
        "NEWSLETTER_FROM_EMAIL is not set — intelligence worker cannot deliver newsletters"
      );
      process.exit(1);
    }
    logger.warn(
      { event: "worker_env_missing", missing: "NEWSLETTER_FROM_EMAIL" },
      "NEWSLETTER_FROM_EMAIL is not set — newsletter delivery will fail if triggered"
    );
  }
}

const LOCK_KEY = 710001
const WORKER_NAME = "intelligence-worker"

// Stale run threshold: runs still 'running' after this many minutes are orphaned
const STALE_THRESHOLD_MINUTES = 30

// Retry policy: up to MAX_ATTEMPTS total, with delays between each
const MAX_ATTEMPTS = 3
const RETRY_DELAYS_MS = [5_000, 15_000] // delay before attempt 2, then attempt 3

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * runPipelineWithRetry
 *
 * Attempts runPipeline() up to MAX_ATTEMPTS times. On each failure, waits
 * the corresponding delay before retrying. If all attempts fail, re-throws
 * the last error so the caller can record the failure and alert.
 *
 * Retries are appropriate for transient issues (network blips, DB connection
 * hiccups, rate limits). Systemic failures will fail all attempts and surface
 * correctly as a failed worker run with an alert.
 */
async function runPipelineWithRetry() {
  let lastErr: unknown

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      if (attempt > 1) {
        const delayMs = RETRY_DELAYS_MS[attempt - 2] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1]
        logger.warn(
          { event: "pipeline_retry", attempt, delayMs, worker: WORKER_NAME },
          `Pipeline attempt ${attempt - 1} failed — retrying in ${delayMs}ms`
        )
        await sleep(delayMs)
      }

      const result = await runPipeline()

      if (attempt > 1) {
        logger.info(
          { event: "pipeline_retry_success", attempt, worker: WORKER_NAME },
          `Pipeline succeeded on attempt ${attempt}`
        )
      }

      return result
    } catch (err) {
      lastErr = err
      logger.error(
        { event: "pipeline_attempt_failed", attempt, maxAttempts: MAX_ATTEMPTS, err, worker: WORKER_NAME },
        `Pipeline attempt ${attempt} of ${MAX_ATTEMPTS} failed`
      )
    }
  }

  throw lastErr
}

export async function runWorker() {
  logger.info({ event: "worker_start", worker: WORKER_NAME }, "Intelligence worker starting")

  // Self-heal: mark orphaned 'running' rows from prior crashed processes as failed
  await cleanupStaleRuns(WORKER_NAME, STALE_THRESHOLD_MINUTES)

  const run = await startWorkerRun(WORKER_NAME)

  try {
    const locked = await withAdvisoryLock(LOCK_KEY, async () => {
      return await runPipelineWithRetry()
    })

    if (!locked.acquired) {
      logger.info({ event: "worker_skipped", worker: WORKER_NAME }, "Intelligence worker skipped: advisory lock already held")

      await completeWorkerRun(
        run.id,
        "success",
        run.started_at,
        { skipped: true }
      )

      return
    }

    await completeWorkerRun(
      run.id,
      "success",
      run.started_at,
      locked.result ?? {}
    )

    logger.info({ event: "worker_complete", worker: WORKER_NAME, result: locked.result }, "Worker completed successfully")
  } catch (err) {
    const errorMessage = err instanceof Error ? err.stack ?? err.message : String(err)

    logger.error({ event: "worker_failure", worker: WORKER_NAME, err }, "Worker failure — all retry attempts exhausted")

    await completeWorkerRun(
      run.id,
      "failed",
      run.started_at,
      { error: errorMessage, attempts: MAX_ATTEMPTS }
    )

    try {
      await sendFailureAlert(WORKER_NAME, errorMessage)
    } catch (alertErr) {
      logger.error({ event: "alert_send_failed", err: alertErr }, "Failure alert send failed")
    }

    throw err
  }
}

// Entry point when executed directly (e.g., cron / one-shot run)
if (process.argv[1]?.endsWith("runner.js") || process.argv[1]?.endsWith("runner.ts")) {
  validateWorkerEnv();
  runWorker().catch((err) => {
    logger.error({ event: "worker_bootstrap_failure", err }, "Worker bootstrap failure")
    process.exit(1)
  })
}
