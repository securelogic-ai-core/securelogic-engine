import { pg } from "./postgres.js"
import { logger } from "./logger.js"

type WorkerRunRow = {
  id: string
  started_at: string | Date
}

export async function startWorkerRun(workerName: string): Promise<WorkerRunRow> {
  const result = await pg.query(
    `
    INSERT INTO worker_runs (worker_name, status, metadata)
    VALUES ($1, 'running', '{}'::jsonb)
    RETURNING id, started_at
    `,
    [workerName]
  )

  return result.rows[0] as WorkerRunRow
}

export async function completeWorkerRun(
  id: string,
  status: "success" | "failed",
  startedAt: string | Date,
  metadata: Record<string, unknown>
): Promise<void> {
  const started =
    startedAt instanceof Date ? startedAt.getTime() : new Date(startedAt).getTime()

  const durationMs = Math.max(0, Date.now() - started)

  await pg.query(
    `
    UPDATE worker_runs
    SET status = $2,
        completed_at = NOW(),
        duration_ms = $3,
        metadata = $4::jsonb
    WHERE id = $1
    `,
    [id, status, durationMs, JSON.stringify(metadata)]
  )
}

/**
 * cleanupStaleRuns
 *
 * Marks orphaned 'running' rows as 'failed' for the given worker when they
 * are older than thresholdMinutes. Rows become orphaned when the worker
 * process crashes before it can call completeWorkerRun.
 *
 * Call this once on worker startup — before acquiring the advisory lock —
 * so the ops health dashboard never shows phantom running workers.
 *
 * Errors are logged and swallowed: stale cleanup must never block startup.
 */
export async function cleanupStaleRuns(
  workerName: string,
  thresholdMinutes = 30
): Promise<void> {
  try {
    const result = await pg.query(
      `
      UPDATE worker_runs
      SET
        status       = 'failed',
        completed_at = NOW(),
        duration_ms  = EXTRACT(EPOCH FROM (NOW() - started_at))::int * 1000,
        metadata     = jsonb_set(
                         COALESCE(metadata, '{}'::jsonb),
                         '{aborted}',
                         'true'::jsonb
                       )
      WHERE worker_name = $1
        AND status      = 'running'
        AND started_at  < NOW() - ($2 || ' minutes')::interval
      RETURNING id
      `,
      [workerName, thresholdMinutes]
    )

    const count = result.rowCount ?? 0

    if (count > 0) {
      logger.warn(
        { event: "stale_runs_cleaned", worker: workerName, count, thresholdMinutes },
        `Cleaned up ${count} stale running worker run(s)`
      )
    }
  } catch (err) {
    logger.error(
      { event: "stale_run_cleanup_failed", worker: workerName, err },
      "Failed to clean up stale worker runs (non-fatal)"
    )
  }
}
