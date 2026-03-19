import { pg } from "./postgres.js"

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
