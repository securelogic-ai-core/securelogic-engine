import { pg } from "../../../../src/api/infra/postgres.js";

export async function startRun() {
  const result = await pg.query(
    `
    INSERT INTO worker_runs (started_at, status)
    VALUES ($1, $2)
    RETURNING id
    `,
    [new Date().toISOString(), "running"]
  );

  return result.rows[0]?.id ?? null;
}

export async function completeRun(
  id: number,
  signals: number,
  insights: number
) {
  await pg.query(
    `
    UPDATE worker_runs
    SET completed_at = $1,
        status = $2,
        signals_fetched = $3,
        insights_generated = $4
    WHERE id = $5
    `,
    [new Date().toISOString(), "success", signals, insights, id]
  );
}

export async function failRun(id: number, error: string) {
  await pg.query(
    `
    UPDATE worker_runs
    SET completed_at = $1,
        status = $2,
        error_message = $3
    WHERE id = $4
    `,
    [new Date().toISOString(), "failed", error, id]
  );
}
