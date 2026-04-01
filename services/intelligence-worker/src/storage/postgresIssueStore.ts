import { pg } from "../../../../src/api/infra/postgres.js";

export type PostgresIssueInput = {
  organizationId: string;
  title: string;
  publishDate?: string | null;
  status?: string;
  audienceTier?: string;
  summary?: string | null;
  sectionsJson?: unknown;
  contentHtml?: string | null;
  contentMd?: string | null;
};

export async function createIssue(issue: PostgresIssueInput) {
  const result = await pg.query(
    `
    INSERT INTO newsletter_issues (
      organization_id,
      title,
      publish_date,
      status,
      audience_tier,
      summary,
      sections_json,
      content_html,
      content_md,
      created_at,
      updated_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,NOW(),NOW())
    RETURNING id
    `,
    [
      issue.organizationId,
      issue.title,
      issue.publishDate ?? null,
      issue.status ?? "draft",
      issue.audienceTier ?? "free",
      issue.summary ?? null,
      JSON.stringify(issue.sectionsJson ?? {}),
      issue.contentHtml ?? null,
      issue.contentMd ?? null
    ]
  );

  return result.rows[0].id as string;
}

export async function getLatestDraftIssue(organizationId: string) {
  const result = await pg.query(
    `
    SELECT *
    FROM newsletter_issues
    WHERE organization_id = $1
      AND status = 'draft'
    ORDER BY created_at DESC, id DESC
    LIMIT 1
    `,
    [organizationId]
  );

  return result.rows[0] ?? null;
}

export async function getRecentDraftIssue(
  organizationId: string,
  minutes = 60
) {
  const result = await pg.query(
    `
    SELECT *
    FROM newsletter_issues
    WHERE organization_id = $1
      AND status = 'draft'
      AND created_at >= NOW() - ($2::text || ' minutes')::interval
    ORDER BY created_at DESC, id DESC
    LIMIT 1
    `,
    [organizationId, String(minutes)]
  );

  return result.rows[0] ?? null;
}

export async function getActiveIssue(
  organizationId: string,
  statuses: string[] = ["draft", "queued"]
) {
  const result = await pg.query(
    `
    SELECT *
    FROM newsletter_issues
    WHERE organization_id = $1
      AND status = ANY($2::text[])
    ORDER BY created_at DESC, id DESC
    LIMIT 1
    `,
    [organizationId, statuses]
  );

  return result.rows[0] ?? null;
}

export async function markIssueSent(issueId: string) {
  await pg.query(
    `
    UPDATE newsletter_issues
    SET status = 'sent',
        publish_date = COALESCE(publish_date, NOW()),
        updated_at = NOW()
    WHERE id = $1
    `,
    [issueId]
  );
}

export async function getLatestSentIssue(organizationId: string) {
  const result = await pg.query(
    `
    SELECT *
    FROM newsletter_issues
    WHERE organization_id = $1
      AND status = 'sent'
    ORDER BY publish_date DESC NULLS LAST, created_at DESC, id DESC
    LIMIT 1
    `,
    [organizationId]
  );

  return result.rows[0] ?? null;
}
