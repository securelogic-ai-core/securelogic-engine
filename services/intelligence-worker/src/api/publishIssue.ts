import { markIssueSent } from "../storage/postgresIssueStore.js";

export async function publishIssue(issueId: string) {
  await markIssueSent(issueId);
}