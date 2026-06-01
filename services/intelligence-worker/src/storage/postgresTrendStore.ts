import { pgElevated } from "../../../../src/api/infra/postgres.js";

export type PostgresTrendInput = {
  organizationId?: string | null;
  name: string;
  category: string;
  description?: string | null;
  score: number;
  metadata?: Record<string, unknown>;
};

export async function saveTrend(trend: PostgresTrendInput): Promise<string | null> {
  const organizationId = trend.organizationId ?? null;

  const result = await pgElevated.query(
    `
    INSERT INTO trends (
      organization_id,
      name,
      category,
      description,
      score,
      metadata,
      created_at
    )
    VALUES ($1, $2, $3, $4, $5, $6::jsonb, NOW())
    RETURNING id
    `,
    [
      organizationId,
      trend.name,
      trend.category,
      trend.description ?? null,
      trend.score,
      JSON.stringify(trend.metadata ?? {})
    ]
  );

  return result.rows[0]?.id ?? null;
}
