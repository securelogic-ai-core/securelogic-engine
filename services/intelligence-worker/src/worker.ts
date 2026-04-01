import { normalizeSignal } from "./pipeline/normalizeSignal.js";
import { scoreSignal } from "./pipeline/scoreSignal.js";
import { generateInsight } from "./pipeline/generateInsight.js";

import { sendNewsletter } from "./delivery/sendNewsletter.js";

import { saveSignal } from "./storage/postgresSignalStore.js";
import { saveInsight } from "./storage/postgresInsightStore.js";

import { publishInsight } from "./publishers/publishInsight.js";

import { fetchRegulatorySignals } from "./sources/regulatoryFeed.js";
import { fetchSecuritySignals } from "./sources/securityNewsFeed.js";
import { fetchAIGovernanceSignals } from "./sources/aiGovernanceFeed.js";

import { isDuplicateSignal } from "./utils/dedupe.js";

import { buildNewsletterIssue } from "./newsletter/newsletterBuilder.js";
import { createIssue } from "./storage/postgresIssueStore.js";
import { renderNewsletter } from "./render/renderNewsletter.js";
import { renderNewsletterHtml } from "./render/renderNewsletterHtml.js";

async function processSignal(event: any) {
  const signal = normalizeSignal(event);

  const signalId = await saveSignal({
    category: signal.category ?? "general",
    title: signal.title,
    source: signal.source ?? "unknown",
    sourceUrl: signal.url ?? signal.sourceUrl ?? "",
    summary: signal.summary ?? null,
    rawContent: signal.rawContent ?? null,
    tags: signal.tags ?? [],
    externalId: signal.externalId ?? signal.url ?? undefined,
    sourceSystem: signal.sourceSystem ?? signal.source ?? null,
    publishedAt: signal.publishedAt ?? null,
    processed: true,
    impactScore: signal.impactScore ?? null,
    noveltyScore: signal.noveltyScore ?? null,
    relevanceScore: signal.relevanceScore ?? null,
    priority: signal.priority ?? null
  });

  const scored = scoreSignal(signal);
  const insight = await generateInsight(scored);

  if (!signalId) {
    throw new Error("Failed to persist signal before saving insight");
  }

  await saveInsight({
    signalId: String(signalId),
    title: insight.title ?? signal.title,
    analysis: insight.analysis ?? insight.summary ?? "",
    riskImplication: insight.riskImplication ?? null,
    recommendation: insight.recommendation ?? null,
    riskLevel: insight.riskLevel ?? null,
    audience: insight.audience ?? null,
    published: false,
    linkedSources: insight.linkedSources ?? []
  });

  await publishInsight(insight);
}

export async function runWorker() {
  console.log("SecureLogic Intelligence Worker starting...");

  const regulatorySignals = await fetchRegulatorySignals();
  const securitySignals = await fetchSecuritySignals();
  const aiSignals = await fetchAIGovernanceSignals();

  const signals = [
    ...regulatorySignals,
    ...securitySignals,
    ...aiSignals
  ];

  console.log(\`Signals fetched: \${signals.length}\`);

  let processedCount = 0;
  let skippedCount = 0;

  for (const event of signals) {
    if (await isDuplicateSignal(event)) {
      skippedCount += 1;
      continue;
    }

    await processSignal(event);
    processedCount += 1;
  }

  console.log(\`Signals processed: \${processedCount}\`);
  console.log(\`Signals skipped as duplicates: \${skippedCount}\`);

  if (processedCount === 0) {
    console.log("No new signals detected. Newsletter rebuild skipped.");
    console.log("Worker cycle complete.");
    return;
  }

  const issue = await buildNewsletterIssue();
  await renderNewsletter(issue);
  await renderNewsletterHtml(issue);

  const issueId = await createIssue({
    title: issue.title,
    contentMd: issue.content_md ?? issue.contentMd ?? "",
    contentHtml: issue.content_html ?? issue.contentHtml ?? "",
    status: "draft",
    audienceTier: issue.audienceTier ?? "free",
    summary: issue.summary ?? "Generated newsletter issue",
    sectionsJson: issue.sections ?? []
  });

  const persistedIssue = {
    ...issue,
    id: issueId
  };

  const today = new Date().getUTCDay();

  if (today === 1) {
    console.log("Weekly send window detected. Sending newsletter.");
    await sendNewsletter(persistedIssue);
  } else {
    console.log("Newsletter generated but not sent (weekly schedule guard).");
  }

  console.log("Newsletter issue built:", persistedIssue.title);
  console.log("Newsletter markdown rendered.");
  console.log("Newsletter HTML rendered.");
  console.log("Newsletter delivery step completed.");
  console.log("Worker cycle complete.");
}