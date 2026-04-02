import { pg } from "../../../../src/api/infra/postgres.js";
import { createIssue } from "../storage/postgresIssueStore.js";

async function getDefaultOrganizationId(): Promise<string> {
  const result = await pg.query(`
    SELECT id
    FROM organizations
    ORDER BY created_at ASC
    LIMIT 1
  `);

  const organizationId = result.rows[0]?.id as string | undefined;

  if (!organizationId) {
    throw new Error("No organization found for issue generation");
  }

  return organizationId;
}

export async function generateIssue(input: {
  title: string;
  contentHtml: string;
  contentMd: string;
  status?: string;
  audienceTier?: string;
  summary?: string | null;
  sectionsJson?: unknown;
}) {
  const organizationId = await getDefaultOrganizationId();

  return createIssue({
    organizationId,
    title: input.title,
    contentHtml: input.contentHtml,
    contentMd: input.contentMd,
    status: input.status ?? "draft",
    audienceTier: input.audienceTier ?? "free",
    summary: input.summary ?? null,
    sectionsJson: input.sectionsJson ?? {}
  });
}
