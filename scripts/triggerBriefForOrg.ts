/**
 * triggerBriefForOrg.ts — Manually generate and store an Intelligence Brief
 * for a specific org (or platform-wide) outside the scheduled 8AM window.
 *
 * Usage:
 *   npx tsx scripts/triggerBriefForOrg.ts [orgId]
 *
 * If orgId is omitted, generates a platform-level brief (organization_id = NULL).
 * The brief is saved to newsletter_issues as a draft.
 * Included insights are marked published so they are excluded from the next run.
 *
 * Requires:
 *   DATABASE_URL — Postgres connection string
 *   ANTHROPIC_API_KEY — Anthropic API key (LLM enrichment; falls back to raw content if absent)
 *
 * Run from repo root:
 *   DATABASE_URL=... ANTHROPIC_API_KEY=... npx tsx scripts/triggerBriefForOrg.ts
 */

import { config } from "dotenv";
import { resolve } from "path";

// Load .env.local first (local dev), then .env as fallback
config({ path: resolve(process.cwd(), ".env.local") });
config({ path: resolve(process.cwd(), ".env") });

import { buildNewsletterIssue, toBriefItem } from "../services/intelligence-worker/src/newsletter/newsletterBuilder.js";
import { applyExecutiveEditorialPass } from "../services/intelligence-worker/src/editorial/executiveWriter.js";
import { renderNewsletter } from "../services/intelligence-worker/src/render/renderNewsletter.js";
import { renderNewsletterHtml } from "../services/intelligence-worker/src/render/renderNewsletterHtml.js";
import { createIssue } from "../services/intelligence-worker/src/storage/postgresIssueStore.js";
import { pg } from "../src/api/infra/postgres.js";

async function main() {
  const orgId = process.argv[2] ?? null;

  console.log("=".repeat(72));
  console.log(`SecureLogic AI — Manual Brief Trigger`);
  console.log(`Org ID : ${orgId ?? "(platform-level)"}`);
  console.log(`Time   : ${new Date().toISOString()}`);
  console.log(`LLM    : ${process.env.ANTHROPIC_API_KEY ? "ANTHROPIC_API_KEY set ✓" : "ANTHROPIC_API_KEY NOT SET — fallback content only"}`);
  console.log("=".repeat(72));
  console.log();

  // Build the issue from unpublished insights
  console.log("Building newsletter issue from insights...");
  const rawIssue = await buildNewsletterIssue(orgId);

  console.log(`Signals included : ${rawIssue.signalCount}`);
  console.log(`Insight IDs      : ${rawIssue.includedInsightIds.length}`);

  // Apply editorial pass
  const issue = applyExecutiveEditorialPass(rawIssue);

  // Render to markdown
  const contentMd = await renderNewsletter(issue);
  const contentHtml = await renderNewsletterHtml(issue);

  // Print full markdown output
  console.log();
  console.log("─".repeat(72));
  console.log("GENERATED BRIEF (MARKDOWN)");
  console.log("─".repeat(72));
  console.log();
  console.log(contentMd);
  console.log();
  console.log("─".repeat(72));

  // Save to DB as a draft
  const sections = issue.sections ?? {};
  const briefSections = {
    aiGovernance:      (sections.aiGovernance     ?? []).map(toBriefItem),
    securityIncidents: (sections.securityIncidents ?? []).map(toBriefItem),
    regulations:       (sections.regulations      ?? []).map(toBriefItem),
    vendorRisk:        (sections.vendorRisk        ?? []).map(toBriefItem),
    compliance:        (sections.compliance        ?? []).map(toBriefItem),
  };

  const issueId = await createIssue({
    organizationId: orgId,
    title: issue.title ?? "SecureLogic AI Intelligence Brief",
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

  console.log(`Saved to newsletter_issues : ${issueId}`);

  // Mark included insights as published
  const insightIds = (rawIssue.includedInsightIds ?? []).filter(Boolean) as string[];
  if (insightIds.length > 0) {
    await pg.query(
      `UPDATE insights SET published = TRUE WHERE id = ANY($1::uuid[])`,
      [insightIds]
    );
    console.log(`Marked ${insightIds.length} insights as published`);
  }

  console.log();
  console.log("Done.");
  await pg.end();
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
