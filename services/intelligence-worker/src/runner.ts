import "dotenv/config"
import { withAdvisoryLock } from "../../../src/api/infra/advisoryLock.js"
import { runPipeline } from "./pipeline/runPipeline.js"
import {
  startWorkerRun,
  completeWorkerRun
} from "../../../src/api/infra/workerLogger.js"
import { sendFailureAlert } from "../../../src/api/infra/alerting.js"
import { logger } from "../../../src/api/infra/logger.js"

const LOCK_KEY = 710001
const WORKER_NAME = "intelligence-worker"

export async function runWorker() {
  logger.info({ event: "worker_start", worker: WORKER_NAME }, "Intelligence worker starting")

  const run = await startWorkerRun(WORKER_NAME)

  try {
    const locked = await withAdvisoryLock(LOCK_KEY, async () => {
      const result = await runPipeline()
      return result
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

    logger.error({ event: "worker_failure", worker: WORKER_NAME, err }, "Worker failure")

    await completeWorkerRun(
      run.id,
      "failed",
      run.started_at,
      { error: errorMessage }
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
  runWorker().catch((err) => {
    logger.error({ event: "worker_bootstrap_failure", err }, "Worker bootstrap failure")
    process.exit(1)
  })
}
