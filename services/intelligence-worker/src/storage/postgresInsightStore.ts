import { pgElevated } from "../../../../src/api/infra/postgres.js";

export type PostgresInsightInput = {
  organizationId: string | null;
  signalId: string;
  category?: string;
  title: string;
  analysis: string;
  riskImplication?: string | null;
  recommendation?: string | null;
  riskLevel?: string | null;
  audience?: string | null;
  published?: boolean;
  linkedSources?: unknown[];
};

export async function saveInsight(insight: PostgresInsightInput): Promise<string | null> {
  const result = await pgElevated.query(
    `
    INSERT INTO insights (
      organization_id,
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
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    ON CONFLICT (organization_id, signal_id)
    WHERE organization_id IS NOT NULL
    DO UPDATE SET
      title          = EXCLUDED.title,
      analysis       = EXCLUDED.analysis,
      risk_implication = EXCLUDED.risk_implication,
      recommendation = EXCLUDED.recommendation,
      risk_level     = EXCLUDED.risk_level,
      audience       = EXCLUDED.audience,
      category       = EXCLUDED.category,
      published      = EXCLUDED.published,
      linked_sources = EXCLUDED.linked_sources,
      updated_at     = NOW()
    RETURNING id
    `,
    [
      insight.organizationId,
      insight.signalId,
      insight.title ?? "",
      insight.analysis ?? "",
      insight.riskImplication ?? null,
      insight.recommendation ?? null,
      insight.riskLevel ?? null,
      Array.isArray(insight.audience)
        ? (insight.audience as string[]).join(", ")
        : insight.audience ?? null,
      insight.category ?? "GENERAL",
      insight.published ?? false,
      JSON.stringify(insight.linkedSources ?? [])
    ]
  );

  return result.rows[0]?.id ?? null;
}

export async function getInsights(organizationId: string | null, limit = 100) {
  const result = await pgElevated.query(
    `
    SELECT *
    FROM insights
    WHERE (organization_id = $1 OR organization_id IS NULL)
      AND (published = FALSE OR published IS NULL)
    ORDER BY created_at DESC
    LIMIT $2
    `,
    [organizationId, limit]
  );

  return result.rows;
}
