import { pg } from "../../../../src/api/infra/postgres.js";

export async function saveSignal(signal: any) {
  await pg.query(
    `
    INSERT INTO signals
    (source, title, url, published_at, normalized_score, created_at)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (url) DO NOTHING
    `,
    [
      signal.source,
      signal.title,
      signal.url,
      signal.publishedAt,
      signal.score || 0,
      new Date().toISOString()
    ]
  );
}

export async function getSignals() {
  const result = await pg.query(
    `
    SELECT *
    FROM signals
    ORDER BY created_at DESC
    `
  );

  return result.rows;
}
