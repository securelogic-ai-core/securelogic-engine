import { normalizeSignal } from "./pipeline/normalizeSignal.js";
import { scoreSignal } from "./pipeline/scoreSignal.js";
import { generateInsight } from "./pipeline/generateInsight.js";

import { sendNewsletter } from "./delivery/sendNewsletter.js";

import { saveSignal } from "./storage/signalStore.js";
import { saveInsight } from "./storage/insightStore.js";

import { publishInsight } from "./publishers/publishInsight.js";

import { fetchRegulatorySignals } from "./sources/regulatoryFeed.js";
import { fetchSecuritySignals } from "./sources/securityNewsFeed.js";
import { fetchAIGovernanceSignals } from "./sources/aiGovernanceFeed.js";

import { isDuplicateSignal } from "./utils/dedupe.js";

import { buildNewsletterIssue } from "./newsletter/newsletterBuilder.js";
import { saveNewsletter } from "./newsletter/newsletterStore.js";
import { renderNewsletter } from "./render/renderNewsletter.js";
import { renderNewsletterHtml } from "./render/renderNewsletterHtml.js";

async function processSignal(event: any) {
  const signal = normalizeSignal(event);
  await saveSignal(signal);

  const scored = scoreSignal(signal);
  const insight = await generateInsight(scored);

  await saveInsight(insight);
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

  console.log(`Signals fetched: ${signals.length}`);

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

  console.log(`Signals processed: ${processedCount}`);
  console.log(`Signals skipped as duplicates: ${skippedCount}`);

  if (processedCount === 0) {
    console.log("No new signals detected. Newsletter rebuild skipped.");
    console.log("Worker cycle complete.");
    return;
  }

  const issue = await buildNewsletterIssue();
  await saveNewsletter(issue);
  await renderNewsletter(issue);
  await renderNewsletterHtml(issue);

/* Weekly send guard */
const today = new Date().getUTCDay(); // 0=Sunday, 1=Monday

if (today === 1) {
  console.log("Weekly send window detected. Sending newsletter.");
  await sendNewsletter();
} else {
  console.log("Newsletter generated but not sent (weekly schedule guard).");
}

  console.log("Newsletter issue built:", issue.title);
  console.log("Newsletter markdown rendered.");
  console.log("Newsletter HTML rendered.");
  console.log("Newsletter delivery step completed.");
  console.log("Worker cycle complete.");
}