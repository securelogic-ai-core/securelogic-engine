import { pg } from "../../../../src/api/infra/postgres.js";
import {
  createIssue,
  getLatestDraftIssue
} from "./postgresIssueStore.js";

async function getDefaultOrganizationId(): Promise<string> {
  const result = await pg.query(`
    SELECT id
    FROM organizations
    ORDER BY created_at ASC
    LIMIT 1
  `);

  const organizationId = result.rows[0]?.id as string | undefined;

  if (!organizationId) {
    throw new Error("No organization found for test store execution");
  }

  return organizationId;
}

async function main() {
  const organizationId = await getDefaultOrganizationId();

  const issueId = await createIssue({
    organizationId,
    title: "Test Newsletter Issue",
    summary: "Test summary",
    contentHtml: "<p>test html</p>",
    contentMd: "test md",
    status: "draft",
    audienceTier: "free",
    sectionsJson: {}
  });

  console.log("created issue:", issueId);

  const latestDraft = await getLatestDraftIssue(organizationId);
  console.log("latest draft:", latestDraft);
}

void main();
