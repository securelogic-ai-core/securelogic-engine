import { pg } from "../../../../src/api/infra/postgres.js";

export async function startRun(workerName = "intelligence-worker") {
  const result = await pg.query(
    `
    INSERT INTO worker_runs (worker_name, status)
    VALUES ($1, 'running')
    RETURNING id
    `,
    [workerName]
  );

  return result.rows[0].id as string;
}

export async function completeRun(
  id: string,
  signalsFetched: number,
  insightsGenerated: number,
  issuesGenerated = 0
) {
  await pg.query(
    `
    UPDATE worker_runs
    SET completed_at = NOW(),
        status = 'success',
        signals_fetched = $2,
        insights_generated = $3,
        issues_generated = $4
    WHERE id = $1
    `,
    [id, signalsFetched, insightsGenerated, issuesGenerated]
  );
}

export async function failRun(id: string, errorMessage: string) {
  await pg.query(
    `
    UPDATE worker_runs
    SET completed_at = NOW(),
        status = 'failed',
        error_message = $2
    WHERE id = $1
    `,
    [id, errorMessage]
  );
}
