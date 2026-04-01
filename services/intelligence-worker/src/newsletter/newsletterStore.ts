import {
  createIssue as createPostgresIssue,
  getLatestSentIssue,
  markIssueSent
} from "../storage/postgresIssueStore.js";

export async function createIssue(title: string, md: string, html: string) {
  return await createPostgresIssue({
    title,
    contentMd: md,
    contentHtml: html,
    status: "draft",
    audienceTier: "free"
  });
}

export async function getLatestIssue() {
  return await getLatestSentIssue();
}

export async function markNewsletterIssueSent(id: string) {
  await markIssueSent(id);
}