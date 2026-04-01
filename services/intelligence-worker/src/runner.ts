import "dotenv/config"
import { withAdvisoryLock } from "../../../src/api/infra/advisoryLock.js"
import { runPipeline } from "./pipeline/runPipeline.js"
import {
  startWorkerRun,
  completeWorkerRun
} from "../../../src/api/infra/workerLogger.js"
import { sendFailureAlert } from "../../../src/api/infra/alerting.js"

const LOCK_KEY = 710001
const WORKER_NAME = "intelligence-worker"

async function main() {
  console.log("Intelligence worker starting...")

  const run = await startWorkerRun(WORKER_NAME)

  try {
    const locked = await withAdvisoryLock(LOCK_KEY, async () => {
      const result = await runPipeline()
      return result
    })

    if (!locked.acquired) {
      console.log("Intelligence worker skipped: advisory lock already held")

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

    console.log("Worker completed successfully")
    console.log(locked.result)
  } catch (err) {
    const errorMessage = err instanceof Error ? err.stack ?? err.message : String(err)

    console.error("Worker failure:", errorMessage)

    await completeWorkerRun(
      run.id,
      "failed",
      run.started_at,
      { error: errorMessage }
    )

    try {
      await sendFailureAlert(WORKER_NAME, errorMessage)
    } catch (alertErr) {
      console.error("Failure alert send failed:", alertErr)
    }

    process.exit(1)
  }
}

main().catch((err) => {
  console.error("Worker bootstrap failure:", err)
  process.exit(1)
})
