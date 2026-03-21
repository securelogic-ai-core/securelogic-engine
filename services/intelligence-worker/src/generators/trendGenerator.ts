import { pg } from "../../../../src/api/infra/postgres.js";

type Insight = {
  id: string
  organization_id: string | null
  signal_id: string
  title: string
  risk_level: string
}

type SignalScoreRow = {
  priority: string | number | null
}

function toNumber(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0.5
  const n = Number(value)
  return Number.isFinite(n) ? n : 0.5
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
    throw new Error("No organization found")
  }

  return organizationId
}

export async function generateTrends(): Promise<number> {
  const defaultOrganizationId = await getDefaultOrganizationId()

  const insightResult = await pg.query(`
    SELECT
      id,
      organization_id,
      signal_id,
      title,
      risk_level
    FROM insights
    WHERE published = true
    ORDER BY created_at DESC
    LIMIT 50
  `)

  const insights = insightResult.rows as Insight[]
  let createdOrUpdated = 0

  for (const insight of insights) {
    const organizationId = insight.organization_id ?? defaultOrganizationId

    const signalScoreResult = await pg.query(
      `
      SELECT priority
      FROM signals
      WHERE id = $1
      LIMIT 1
      `,
      [insight.signal_id]
    )

    const signalScoreRow = signalScoreResult.rows[0] as SignalScoreRow | undefined
    const score = signalScoreRow ? toNumber(signalScoreRow.priority) : 0.5

    await pg.query(
      `
      INSERT INTO trends (
        organization_id,
        name,
        category,
        description,
        score,
        window_start,
        window_end,
        metadata,
        created_at
      )
      VALUES ($1,$2,$3,$4,$5,NOW(),NOW(),$6::jsonb,NOW())
      ON CONFLICT (organization_id, name)
      DO UPDATE SET
        category = EXCLUDED.category,
        description = EXCLUDED.description,
        score = EXCLUDED.score,
        window_end = NOW(),
        metadata = EXCLUDED.metadata
      `,
      [
        organizationId,
        insight.title,
        "cybersecurity",
        insight.title,
        score.toFixed(2),
        JSON.stringify({
          source: "insight_engine",
          signal_id: insight.signal_id,
          insight_id: insight.id,
          risk_level: insight.risk_level
        })
      ]
    )

    createdOrUpdated++
  }

  return createdOrUpdated
}
