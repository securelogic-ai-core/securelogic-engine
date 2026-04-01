import { pg } from "../../../../src/api/infra/postgres.js";

export type PostgresSignalInput = {
  organizationId?: string | null;
  category: string;
  title: string;
  source: string;
  sourceUrl: string;
  summary?: string | null;
  rawContent?: string | null;
  tags?: string[];
  externalId?: string;
  sourceSystem?: string;
  publishedAt?: string;
  processed?: boolean;
  impactScore?: number | null;
  noveltyScore?: number | null;
  relevanceScore?: number | null;
  priority?: number | null;
};

function normalizeTags(tags?: string[]): string[] {
  if (!Array.isArray(tags)) return [];
  return tags.filter(
    (tag): tag is string => typeof tag === "string" && tag.trim().length > 0
  );
}

function normalizeText(value?: string | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function getDefaultOrganizationId(): Promise<string> {
  const result = await pg.query(`
    SELECT id
    FROM organizations
    ORDER BY created_at ASC
    LIMIT 1
  `);

  const organizationId = result.rows[0]?.id as string | undefined;

  if (!organizationId) {
    throw new Error("No organization found for signal storage");
  }

  return organizationId;
}

export async function saveSignal(signal: PostgresSignalInput) {
  const normalizedTags = normalizeTags(signal.tags);
  const organizationId = signal.organizationId ?? (await getDefaultOrganizationId());

  const externalId = normalizeText(signal.externalId);
  const sourceUrl = normalizeText(signal.sourceUrl);
  const sourceSystem = normalizeText(signal.sourceSystem);
  const publishedAt = normalizeText(signal.publishedAt);

  const result = await pg.query(
    `
    INSERT INTO signals (
      organization_id,
      category,
      title,
      source,
      source_url,
      summary,
      raw_content,
      tags,
      external_id,
      source_system,
      published_at,
      processed,
      impact_score,
      novelty_score,
      relevance_score,
      priority
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14,$15,$16)
    ON CONFLICT (source, COALESCE(external_id, ''), COALESCE(source_url, ''))
    DO UPDATE SET
      organization_id = EXCLUDED.organization_id,
      category = EXCLUDED.category,
      title = EXCLUDED.title,
      summary = EXCLUDED.summary,
      raw_content = EXCLUDED.raw_content,
      tags = EXCLUDED.tags,
      source_system = EXCLUDED.source_system,
      published_at = EXCLUDED.published_at,
      processed = EXCLUDED.processed,
      impact_score = EXCLUDED.impact_score,
      novelty_score = EXCLUDED.novelty_score,
      relevance_score = EXCLUDED.relevance_score,
      priority = EXCLUDED.priority
    RETURNING id
    `,
    [
      organizationId,
      signal.category,
      signal.title,
      signal.source,
      sourceUrl,
      signal.summary ?? null,
      signal.rawContent ?? null,
      JSON.stringify(normalizedTags),
      externalId,
      sourceSystem,
      publishedAt,
      signal.processed ?? false,
      signal.impactScore ?? null,
      signal.noveltyScore ?? null,
      signal.relevanceScore ?? null,
      signal.priority ?? null
    ]
  );

  return result.rows[0]?.id ?? null;
}

export async function getSignals(limit = 100) {
  const result = await pg.query(
    `
    SELECT *
    FROM signals
    ORDER BY created_at DESC
    LIMIT $1
    `,
    [limit]
  );

  return result.rows;
}