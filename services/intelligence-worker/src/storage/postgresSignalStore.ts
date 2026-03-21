import { pg } from "../../../../src/api/infra/postgres.js";

export type PostgresSignalInput = {
  organizationId?: string | null
  category: string
  title: string
  source: string
  sourceUrl: string
  summary?: string | null
  rawContent?: string | null
  tags?: string[]
  externalId?: string
  sourceSystem?: string
  publishedAt?: string
  processed?: boolean
  impactScore?: number | null
  noveltyScore?: number | null
  relevanceScore?: number | null
  priority?: number | null
}

function normalizeTags(tags?: string[]): string[] {
  if (!Array.isArray(tags)) return []
  return tags.filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0)
}

async function getDefaultOrganizationId(): Promise<string> {
  const result = await pg.query(`
    SELECT id
    FROM organizations
    ORDER BY created_at ASC
    LIMIT 1
  `)

  const organizationId = result.rows[0]?.id as string | undefined

  if (!organizationId) {
    throw new Error("No organization found for signal storage")
  }

  return organizationId
}

export async function saveSignal(signal: PostgresSignalInput) {
  const normalizedTags = normalizeTags(signal.tags)
  const organizationId = signal.organizationId ?? await getDefaultOrganizationId()

  if (signal.externalId) {
    const existing = await pg.query(
      `
      SELECT id
      FROM signals
      WHERE external_id = $1
      LIMIT 1
      `,
      [signal.externalId]
    )

    if (existing.rows.length > 0) {
      const existingId = existing.rows[0].id as string

      await pg.query(
        `
        UPDATE signals
        SET
          organization_id = $2,
          category = $3,
          title = $4,
          source = $5,
          source_url = $6,
          summary = $7,
          raw_content = $8,
          tags = $9::jsonb,
          source_system = $10,
          published_at = $11,
          processed = $12,
          impact_score = $13,
          novelty_score = $14,
          relevance_score = $15,
          priority = $16
        WHERE id = $1
        `,
        [
          existingId,
          organizationId,
          signal.category,
          signal.title,
          signal.source,
          signal.sourceUrl,
          signal.summary ?? null,
          signal.rawContent ?? null,
          JSON.stringify(normalizedTags),
          signal.sourceSystem ?? null,
          signal.publishedAt ?? null,
          signal.processed ?? false,
          signal.impactScore ?? null,
          signal.noveltyScore ?? null,
          signal.relevanceScore ?? null,
          signal.priority ?? null
        ]
      )

      return existingId
    }
  }

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
    RETURNING id
    `,
    [
      organizationId,
      signal.category,
      signal.title,
      signal.source,
      signal.sourceUrl,
      signal.summary ?? null,
      signal.rawContent ?? null,
      JSON.stringify(normalizedTags),
      signal.externalId ?? null,
      signal.sourceSystem ?? null,
      signal.publishedAt ?? null,
      signal.processed ?? false,
      signal.impactScore ?? null,
      signal.noveltyScore ?? null,
      signal.relevanceScore ?? null,
      signal.priority ?? null
    ]
  )

  return result.rows[0]?.id ?? null
}
