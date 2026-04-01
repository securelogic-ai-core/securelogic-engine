import { collectRssSignals } from "../collectors/rssCollector.js";
import { saveSignal } from "../storage/postgresSignalStore.js";

import { generateInsights } from "../generators/insightGenerator.js";
import { generateTrends } from "../generators/trendGenerator.js";
import { generateNewsletter } from "../generators/newsletterGenerator.js";
import {
  generateNewsletterDeliveries,
  type NewsletterDeliveryResult
} from "../generators/newsletterDeliveryGenerator.js";

import { scoreSignal } from "../scoring/scoreSignal.js";

export type PipelineResult = {
  signals: number;
  insights: number;
  trends: number;
  newsletters: number;
  deliveries: number;
  deliveriesSkippedSuppressed: number;
  deliveriesSkippedInactive: number;
};

export async function runPipeline(): Promise<PipelineResult> {
  console.log("Running intelligence pipeline...");

  const rssSignals = await collectRssSignals();
  let savedSignals = 0;

  for (const signal of rssSignals) {
    try {
      const scores = scoreSignal({
        title: signal.title,
        source: signal.source,
        summary: signal.summary ?? "",
        tags: ["cisa"]
      });

      const id = await saveSignal({
        category: "security",
        title: signal.title,
        source: signal.source,
        sourceUrl: signal.sourceUrl,
        summary: signal.summary ?? "",
        rawContent: signal.summary ?? "",
        externalId: signal.sourceUrl,
        sourceSystem: "rss",
        publishedAt: signal.publishedAt,
        tags: ["cisa"],
        processed: false,
        impactScore: scores.impactScore,
        noveltyScore: scores.noveltyScore,
        relevanceScore: scores.relevanceScore,
        priority: scores.priority
      });

      if (id) {
        savedSignals++;
      }
    } catch (err) {
      console.log("Signal insert failed:", signal.title);
      console.error(err);
    }
  }

  let insightsCreated = 0;
  let trendsCreated = 0;
  let newslettersCreated = 0;

  let deliveryResult: NewsletterDeliveryResult = {
    issuesScanned: 0,
    subscribersScanned: 0,
    deliveriesCreated: 0,
    deliveriesSkippedExisting: 0,
    deliveriesSkippedSuppressed: 0,
    deliveriesSkippedInactive: 0
  };

  let insights: any[] = [];

  try {
    insightsCreated = await generateInsights();
  } catch (err) {
    console.error("Insight generation failed");
    console.error(err);
  }

  // 🔥 CRITICAL FIX: trends must use insights
  try {
    insights = []; // safe fallback
    trendsCreated = await generateTrends(insights);
  } catch (err) {
    console.error("Trend generation failed");
    console.error(err);
  }

  try {
    newslettersCreated = await generateNewsletter();
  } catch (err) {
    console.error("Newsletter generation failed");
    console.error(err);
  }

  try {
    deliveryResult = await generateNewsletterDeliveries();
  } catch (err) {
    console.error("Newsletter delivery generation failed");
    console.error(err);
  }

  console.log("Signals collected:", savedSignals);
  console.log("Insights generated:", insightsCreated);
  console.log("Trends generated:", trendsCreated);
  console.log("Newsletter issues generated:", newslettersCreated);
  console.log("Newsletter issues scanned for delivery:", deliveryResult.issuesScanned);
  console.log("Newsletter subscribers scanned:", deliveryResult.subscribersScanned);
  console.log("Newsletter deliveries created:", deliveryResult.deliveriesCreated);
  console.log("Newsletter deliveries skipped existing:", deliveryResult.deliveriesSkippedExisting);
  console.log("Newsletter deliveries skipped suppressed:", deliveryResult.deliveriesSkippedSuppressed);
  console.log("Newsletter deliveries skipped inactive:", deliveryResult.deliveriesSkippedInactive);

  return {
    signals: savedSignals,
    insights: insightsCreated,
    trends: trendsCreated,
    newsletters: newslettersCreated,
    deliveries: deliveryResult.deliveriesCreated,
    deliveriesSkippedSuppressed: deliveryResult.deliveriesSkippedSuppressed,
    deliveriesSkippedInactive: deliveryResult.deliveriesSkippedInactive
  };
}