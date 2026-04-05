import { pg } from "../../../src/api/infra/postgres.js";

import { normalizeSignal } from "./pipeline/normalizeSignal.js";
import { scoreSignal } from "./pipeline/scoreSignal.js";
import { generateInsight } from "./pipeline/generateInsight.js";

import { sendNewsletter } from "./delivery/sendNewsletter.js";

import { saveSignal } from "./storage/postgresSignalStore.js";
import { saveInsight } from "./storage/postgresInsightStore.js";
import { startRun, completeRun, failRun } from "./storage/postgresRunStore.js";

import { publishInsight } from "./publishers/publishInsight.js";
import { assessSignal } from "./pipeline/assessSignal.js";

import { fetchRegulatorySignals } from "./sources/regulatoryFeed.js";
import { fetchSecuritySignals } from "./sources/securityNewsFeed.js";
import { fetchAIGovernanceSignals } from "./sources/aiGovernanceFeed.js";

import { isDuplicateSignal } from "./utils/dedupe.js";

import { buildNewsletterIssue } from "./newsletter/newsletterBuilder.js";
import {
  createIssue,
  getRecentDraftIssue
} from "./storage/postgresIssueStore.js";

import { renderNewsletter } from "./render/renderNewsletter.js";
import { renderNewsletterHtml } from "./render/renderNewsletterHtml.js";

import { applyExecutiveEditorialPass } from "./editorial/executiveWriter.js";

async function getDefaultOrganizationId(): Promise<string> {
  const result = await pg.query(`
    SELECT id
    FROM organizations
    ORDER BY created_at ASC
    LIMIT 1
  `);

  const orgId = result.rows[0]?.id as string | undefined;

  if (!orgId) {
    throw new Error("No organization found for worker execution");
  }

  return orgId;
}

async function processSignal(event: any, organizationId: string) {
  const signal = normalizeSignal(event) as any;

  const signalId = await saveSignal({
    organizationId,
    category: signal.category ?? "general",
    title: signal.title,
    source: signal.source ?? "unknown",
    sourceUrl: signal.url ?? null,
    summary: signal.summary ?? null,
    rawContent: signal.rawContent ?? null,
    tags: signal.tags ?? [],
    externalId: signal.url ?? undefined,
    sourceSystem: signal.source ?? null,
    publishedAt: signal.published_at ?? signal.publishedAt ?? null,
    processed: true,
    impactScore: signal.impactScore ?? signal.score ?? null,
    noveltyScore: signal.noveltyScore ?? null,
    relevanceScore: signal.relevanceScore ?? null,
    priority: signal.priority ?? null
  });

  if (!signalId) {
    throw new Error("Failed to persist signal before saving insight");
  }

  const scored = scoreSignal(signal);
  const insight = (await generateInsight(scored)) as any;

  await saveInsight({
    organizationId,
    signalId: String(signalId),
    category: insight.category ?? signal.category ?? "GENERAL",
    title: insight.title ?? signal.title,
    analysis: insight.analysis ?? "",
    riskImplication: insight.riskImplication ?? insight.executiveImpact ?? null,
    recommendation: insight.recommendation ?? insight.recommendedAction ?? null,
    riskLevel: insight.riskLevel ?? null,
    audience: Array.isArray(insight.audience)
      ? insight.audience.join(", ")
      : insight.audience ?? null,
    published: false,
    linkedSources: insight.linkedSources ?? []
  });

  await publishInsight(insight);

  // Run the core engine against the scored signal and persist the
  // resulting risk assessment. Fail-open — one bad assessment never
  // stops the rest of the signal batch from being processed.
  await assessSignal(organizationId, scored);
}

export async function runWorker() {
  console.log("SecureLogic Intelligence Worker starting...");

  const runId = await startRun("intelligence-worker");

  try {
    const organizationId = await getDefaultOrganizationId();

    const regulatorySignals = await fetchRegulatorySignals();
    const securitySignals = await fetchSecuritySignals();
    const aiSignals = await fetchAIGovernanceSignals();

    const signals = [
      ...regulatorySignals,
      ...securitySignals,
      ...aiSignals
    ];

    console.log(`Signals fetched: ${signals.length}`);

    let processedCount = 0;
    let skippedCount = 0;

    for (const event of signals) {
      if (await isDuplicateSignal(event)) {
        skippedCount += 1;
        continue;
      }

      await processSignal(event, organizationId);
      processedCount += 1;
    }

    console.log(`Signals processed: ${processedCount}`);
    console.log(`Signals skipped as duplicates: ${skippedCount}`);

    let issuesGenerated = 0;

    if (processedCount === 0) {
      console.log("No new signals detected. Newsletter rebuild skipped.");
    } else {
      const recentDraft = await getRecentDraftIssue(organizationId, 60);

      if (recentDraft) {
        console.log("Recent draft already exists. Skipping new draft creation.");
      } else {
        const rawIssue = (await buildNewsletterIssue(organizationId)) as any;
        const issue = applyExecutiveEditorialPass(rawIssue);

        console.log("Editorial pass applied.");

        const markdown = await renderNewsletter(issue);
        const html = await renderNewsletterHtml(issue);

        console.log("Rendered markdown + HTML.");

        const issueId = await createIssue({
          organizationId,
          title: issue.title,
          contentMd: markdown,
          contentHtml: html,
          status: "draft",
          audienceTier: "free",
          summary: issue.executiveSummary ?? "Generated newsletter issue",
          sectionsJson: issue.sections ?? {}
        });

        issuesGenerated = 1;

        const persistedIssue = {
          ...issue,
          id: issueId,
          organization_id: organizationId,
          content_html: html,
          content_md: markdown
        };

        console.log("Issue persisted:", issueId);

        const today = new Date().getUTCDay();

        if (today === 1) {
          console.log("Weekly send window detected. Sending newsletter.");
          await sendNewsletter(persistedIssue);
        } else {
          console.log("Newsletter generated but not sent (weekly schedule guard).");
        }
      }
    }

    await completeRun(runId, signals.length, processedCount, issuesGenerated);
    console.log("Worker cycle complete.");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await failRun(runId, message);
    console.error("Worker cycle failed:", err);
    throw err;
  }
}

void runWorker();
