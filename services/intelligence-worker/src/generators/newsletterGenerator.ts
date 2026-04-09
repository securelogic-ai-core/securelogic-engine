import { pg } from "../../../../src/api/infra/postgres.js";
import { logger } from "../../../../src/api/infra/logger.js";
import {
  createIssue,
  getActiveIssue
} from "../storage/postgresIssueStore.js";
import { buildNewsletterIssue } from "../newsletter/newsletterBuilder.js";
import { applyExecutiveEditorialPass } from "../editorial/executiveWriter.js";
import { renderNewsletter } from "../render/renderNewsletter.js";
import { renderNewsletterHtml } from "../render/renderNewsletterHtml.js";

export async function generateNewsletter(): Promise<number> {
  const activeIssue = await getActiveIssue(null, ["draft", "queued"]);

  if (activeIssue) {
    logger.info({ event: "newsletter_generation_skip", issueId: activeIssue.id, status: activeIssue.status }, "Newsletter generation skipped: active issue already exists");
    return 0;
  }

  // Build structured brief from platform insights (intelligence layer)
  const rawIssue = await buildNewsletterIssue(null);

  // Apply editorial pass (intelligence layer — sharpens language and structure)
  const issue = applyExecutiveEditorialPass(rawIssue);

  // Render to markdown + HTML
  const contentMd = await renderNewsletter(issue);
  const contentHtml = await renderNewsletterHtml(issue);

  await createIssue({
    organizationId: null,
    title: issue.title ?? "SecureLogic Cyber Risk Intelligence Brief",
    status: "draft",
    audienceTier: "standard",
    summary: issue.executiveSummary ?? null,
    sectionsJson: issue.sections ?? {},
    contentMd,
    contentHtml,
    thesisHeadline: issue.thesisHeadline ?? null,
    crossDomainAnalysis: issue.crossDomainAnalysis ?? null,
    actionSummaryJson: issue.actionSummary ?? null
  });

  logger.info({ event: "newsletter_issue_created" }, "Newsletter issue created (platform, insight-based)");
  return 1;
}

export { pg }; // Re-export to satisfy any legacy imports — remove when no longer needed
