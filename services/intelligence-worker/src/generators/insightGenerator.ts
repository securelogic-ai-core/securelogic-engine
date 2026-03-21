import { pg } from "../../../../src/api/infra/postgres.js";

type Signal = {
  id: string
  organization_id: string | null
  title: string
  summary: string | null
  source: string
  source_url: string
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

export async function generateInsights(): Promise<number> {
  const defaultOrganizationId = await getDefaultOrganizationId()

  const signalResult = await pg.query(`
    SELECT
      id,
      organization_id,
      title,
      summary,
      source,
      source_url
    FROM signals
    ORDER BY created_at DESC
    LIMIT 50
  `)

  const signals = signalResult.rows as Signal[]
  let createdOrUpdated = 0

  for (const signal of signals) {
    const organizationId = signal.organization_id ?? defaultOrganizationId

    await pg.query(
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
        published,
        linked_sources,
        created_at,
        updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,NOW(),NOW())
      ON CONFLICT (organization_id, signal_id)
      DO UPDATE SET
        title = EXCLUDED.title,
        analysis = EXCLUDED.analysis,
        risk_implication = EXCLUDED.risk_implication,
        recommendation = EXCLUDED.recommendation,
        risk_level = EXCLUDED.risk_level,
        audience = EXCLUDED.audience,
        published = EXCLUDED.published,
        linked_sources = EXCLUDED.linked_sources,
        updated_at = NOW()
      `,
      [
        organizationId,
        signal.id,
        signal.title,
        "",
        "This advisory may affect organizations using impacted technologies and should be reviewed by security teams.",
        "Review the advisory and apply any recommended mitigations or patches.",
        "medium",
        "security",
        true,
        JSON.stringify([signal.source_url])
      ]
    )

    createdOrUpdated++
  }

  return createdOrUpdated
}
