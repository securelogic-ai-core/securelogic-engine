import { pg } from "../../../../src/api/infra/postgres.js";

export type PostgresIssueInput = {
  title: string;
  publishDate?: string | null;
  status?: string;
  audienceTier?: string;
  summary?: string | null;
  sectionsJson?: unknown[];
  contentHtml?: string | null;
  contentMd?: string | null;
};

export async function createIssue(issue: PostgresIssueInput) {
  const result = await pg.query(
    `
    INSERT INTO newsletter_issues (
      title,
      publish_date,
      status,
      audience_tier,
      summary,
      sections_json,
      content_html,
      content_md
    )
    VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)
    RETURNING id
    `,
    [
      issue.title,
      issue.publishDate ?? null,
      issue.status ?? "draft",
      issue.audienceTier ?? "free",
      issue.summary ?? null,
      JSON.stringify(issue.sectionsJson ?? []),
      issue.contentHtml ?? null,
      issue.contentMd ?? null
    ]
  );

  return result.rows[0].id as string;
}

export async function getLatestDraftIssue() {
  const result = await pg.query(
    `
    SELECT *
    FROM newsletter_issues
    WHERE status = 'draft'
    ORDER BY created_at DESC
    LIMIT 1
    `
  );

  return result.rows[0] ?? null;
}

export async function getRecentDraftIssue(minutes = 60) {
  const result = await pg.query(
    `
    SELECT *
    FROM newsletter_issues
    WHERE status = 'draft'
      AND created_at >= NOW() - ($1::text || ' minutes')::interval
    ORDER BY created_at DESC
    LIMIT 1
    `,
    [String(minutes)]
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

export async function getLatestSentIssue() {
  const result = await pg.query(`
    SELECT *
    FROM newsletter_issues
    WHERE status = 'sent'
    ORDER BY publish_date DESC NULLS LAST, created_at DESC
    LIMIT 1
  `);

  return result.rows[0] ?? null;
}