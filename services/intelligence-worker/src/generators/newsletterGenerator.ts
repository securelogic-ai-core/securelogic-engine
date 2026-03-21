import { pg } from "../../../../src/api/infra/postgres.js";

type Trend = {
  id: string
  organization_id: string
  name: string
  category: string
  description: string
  score: string | number | null
}

function toNumber(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
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
    throw new Error("No organization found for newsletter generation")
  }

  return organizationId
}

export async function generateNewsletter(): Promise<number> {
  const organizationId = await getDefaultOrganizationId()

  const existingIssueResult = await pg.query(
    `
    SELECT id, status
    FROM newsletter_issues
    WHERE organization_id = $1
      AND status IN ('draft', 'queued')
    ORDER BY created_at DESC, id DESC
    LIMIT 1
    `,
    [organizationId]
  )

  if ((existingIssueResult.rowCount ?? 0) > 0) {
    const existingIssue = existingIssueResult.rows[0]
    console.log(
      "Newsletter generation skipped: active issue already exists",
      existingIssue.id,
      existingIssue.status
    )
    return 0
  }

  const result = await pg.query(
    `
    SELECT id, organization_id, name, category, description, score
    FROM trends
    WHERE organization_id = $1
    ORDER BY score DESC, created_at DESC
    LIMIT 10
    `,
    [organizationId]
  )

  const trends = result.rows as Trend[]

  const sections = trends.map((trend) => ({
    trendId: trend.id,
    title: trend.name,
    category: trend.category,
    score: toNumber(trend.score),
    summary: trend.description
  }))

  const summary =
    trends.length > 0
      ? `Top ${trends.length} cyber risk items generated for the current intelligence window.`
      : "No significant trend items were available for this issue."

  const contentMd =
    trends.length > 0
      ? trends
          .map(
            (trend, index) =>
              `## ${index + 1}. ${trend.name}\n\nCategory: ${trend.category}\nScore: ${toNumber(trend.score).toFixed(2)}\n\n${trend.description}`
          )
          .join("\n\n")
      : "No trend items were available."

  const contentHtml =
    trends.length > 0
      ? trends
          .map(
            (trend, index) =>
              `<h2>${index + 1}. ${trend.name}</h2><p><strong>Category:</strong> ${trend.category}<br/><strong>Score:</strong> ${toNumber(trend.score).toFixed(2)}</p><p>${trend.description}</p>`
          )
          .join("")
      : "<p>No trend items were available.</p>"

  await pg.query(
    `
    INSERT INTO newsletter_issues (
      organization_id,
      title,
      summary,
      sections_json,
      content_md,
      content_html,
      status,
      audience_tier,
      publish_date,
      created_at,
      updated_at
    )
    VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,NOW(),NOW(),NOW())
    `,
    [
      organizationId,
      "SecureLogic Cyber Risk Intelligence Brief",
      summary,
      JSON.stringify(sections),
      contentMd,
      contentHtml,
      "draft",
      "standard"
    ]
  )

  console.log("Newsletter issue created for organization:", organizationId)
  return 1
}
