import { pg } from "../../../../src/api/infra/postgres.js";

export async function saveInsight(insight: any) {
  const result = await pg.query(
    `
    INSERT INTO insights (
      signal_id,
      title,
      analysis,
      risk_implication,
      recommendation,
      risk_level,
      audience,
      category,
      published,
      linked_sources
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    RETURNING id
    `,
    [
      insight.signalId,
      insight.title ?? "",
      insight.analysis ?? "",
      insight.riskImplication ?? null,
      insight.recommendation ?? null,
      insight.riskLevel ?? "low",
      Array.isArray(insight.audience)
        ? insight.audience.join(", ")
        : insight.audience ?? null,
      insight.category ?? "GENERAL",
      insight.published ?? false,
      insight.linkedSources ?? []
    ]
  );

  return result.rows[0]?.id ?? null;
}

export async function getInsights(limit = 100) {
  const result = await pg.query(
    `
    SELECT *
    FROM insights
    ORDER BY created_at DESC
    LIMIT $1
    `,
    [limit]
  );

  return result.rows;
}
