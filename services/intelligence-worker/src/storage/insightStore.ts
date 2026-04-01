import { pg } from "../../../../src/api/infra/postgres.js";

export async function saveInsight(
  signalId: number,
  insight: string,
  riskScore: number
) {
  await pg.query(
    `
    INSERT INTO insights
    (signal_id, analysis, risk_level, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5)
    `,
    [
      signalId,
      insight,
      String(riskScore),
      new Date().toISOString(),
      new Date().toISOString()
    ]
  );
}

export async function getInsights() {
  const result = await pg.query(
    `
    SELECT *
    FROM insights
    ORDER BY created_at DESC
    `
  );

  return result.rows;
}
