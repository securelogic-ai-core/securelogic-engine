import { pg } from "../../../../src/api/infra/postgres.js";
import { logger } from "../../../../src/api/infra/logger.js";
import {
  createIssue,
  getActiveIssue
} from "../storage/postgresIssueStore.js";
import { buildNewsletterIssue, toBriefItem } from "../newsletter/newsletterBuilder.js";
import { applyExecutiveEditorialPass } from "../editorial/executiveWriter.js";
import { renderNewsletter } from "../render/renderNewsletter.js";
import { renderNewsletterHtml } from "../render/renderNewsletterHtml.js";

export async function generateNewsletter(): Promise<number> {
  const activeIssue = await getActiveIssue(null, ["draft", "queued"]);

  if (activeIssue) {
    logger.info({ event: "newsletter_generation_skip", issueId: activeIssue.id, status: activeIssue.status }, "Newsletter generation skipped: active issue already exists");
    return 0;
  }

  // Guard against creating a duplicate issue when one was already sent this calendar week.
  const thisWeekResult = await pg.query<{ id: string }>(
    `SELECT id FROM newsletter_issues
     WHERE organization_id IS NULL
       AND created_at >= date_trunc('day', NOW())
       AND status IN ('draft', 'queued', 'sent')
     LIMIT 1`
  );

  if (thisWeekResult.rows.length > 0) {
    logger.info(
      { event: "newsletter_generation_skip", existingId: thisWeekResult.rows[0]!.id },
      "Newsletter generation skipped: issue already exists for this calendar week"
    );
    return 0;
  }

  // Build structured brief from platform insights (intelligence layer)
  const rawIssue = await buildNewsletterIssue(null);

  // Apply editorial pass (intelligence layer — sharpens language and structure)
  const issue = applyExecutiveEditorialPass(rawIssue);

  // Render to markdown + HTML
  const contentMd = await renderNewsletter(issue);
  const contentHtml = await renderNewsletterHtml(issue);

  // Project each section item to the canonical BriefItem shape before storage.
  // This ensures sections_json contains clean, stable output fields rather than
  // the full internal pipeline shape (which includes rawContent, DB timestamps, etc.)
  const sections = issue.sections ?? {};
  const briefSections = {
    aiGovernance:     (sections.aiGovernance     ?? []).map(toBriefItem),
    securityIncidents:(sections.securityIncidents ?? []).map(toBriefItem),
    regulations:      (sections.regulations      ?? []).map(toBriefItem),
    vendorRisk:       (sections.vendorRisk        ?? []).map(toBriefItem),
    compliance:       (sections.compliance        ?? []).map(toBriefItem),
  };

  await createIssue({
    organizationId: null,
    title: issue.title ?? "SecureLogic Cyber Risk Intelligence Brief",
    status: "draft",
    audienceTier: "standard",
    summary: issue.executiveSummary ?? null,
    sectionsJson: briefSections,
    contentMd,
    contentHtml,
    thesisHeadline: issue.thesisHeadline ?? null,
    crossDomainAnalysis: issue.crossDomainAnalysis ?? null,
    actionSummaryJson: issue.actionSummary ?? null
  });

  // Mark all included insights as published so they are excluded from future briefs.
  const insightIds = (rawIssue.includedInsightIds ?? []).filter(Boolean) as string[];
  if (insightIds.length > 0) {
    await pg.query(
      `UPDATE insights SET published = TRUE WHERE id = ANY($1::uuid[])`,
      [insightIds]
    );
    logger.info(
      { event: "insights_marked_published", count: insightIds.length },
      `Marked ${insightIds.length} insights as published`
    );
  }

  logger.info({ event: "newsletter_issue_created" }, "Newsletter issue created (platform, insight-based)");
  return 1;
}

export { pg }; // Re-export to satisfy any legacy imports — remove when no longer needed
