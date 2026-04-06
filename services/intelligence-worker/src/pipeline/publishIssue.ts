import { markIssueSent } from "../storage/postgresIssueStore.js";
import { logger } from "../../../../src/api/infra/logger.js";

export async function publishIssue(issueId: string) {
  await markIssueSent(issueId);
  logger.info({ event: "issue_published", issueId }, "Issue published");
}