import { pg } from "../../../../src/api/infra/postgres.js";

export type PostgresInsightInput = {
  signalId: string;
  category?: string | null;
  title: string;
  analysis: string;
  riskImplication?: string | null;
  recommendation?: string | null;
  riskLevel?: string | null;
  audience?: string | null;
  published?: boolean;
  linkedSources?: string[];
};

export async function saveInsight(insight: PostgresInsightInput) {
  const result = await pg.query(
    `
    INSERT INTO insights (
      signal_id,
      category,
      title,
      analysis,
      risk_implication,
      recommendation,
      risk_level,
      audience,
      published,
      linked_sources
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
    RETURNING id
    `,
    [
      insight.signalId,
      insight.category ?? "GENERAL",
      insight.title,
      insight.analysis,
      insight.riskImplication ?? null,
      insight.recommendation ?? null,
      insight.riskLevel ?? null,
      insight.audience ?? null,
      insight.published ?? false,
      JSON.stringify(insight.linkedSources ?? [])
    ]
  );

  return result.rows[0].id as string;
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