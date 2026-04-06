import { collectRssSignals } from "../collectors/rssCollector.js";
import { saveSignal } from "../storage/postgresSignalStore.js";
import { saveTrend } from "../storage/postgresTrendStore.js";

import { generateInsights } from "../generators/insightGenerator.js";
import { generateTrends } from "../generators/trendGenerator.js";
import { generateNewsletter } from "../generators/newsletterGenerator.js";
import {
  generateNewsletterDeliveries,
  type NewsletterDeliveryResult
} from "../generators/newsletterDeliveryGenerator.js";

import { scoreSignal } from "../scoring/scoreSignal.js";
import { normalizeSignal } from "./normalizeSignal.js";

import { fetchRegulatorySignals } from "../sources/regulatoryFeed.js";
import { fetchSecuritySignals } from "../sources/securityNewsFeed.js";
import { fetchAIGovernanceSignals } from "../sources/aiGovernanceFeed.js";

import { getLatestDraftIssue } from "../storage/postgresIssueStore.js";
import { sendNewsletter } from "../delivery/sendNewsletter.js";
import { logger } from "../../../../src/api/infra/logger.js";

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
  logger.info({ event: "pipeline_start" }, "Running intelligence pipeline");

  const rssSignals = await collectRssSignals();

  // Collect structured source feed signals (regulatory, security, AI governance)
  const [regulatoryRaw, securityRaw, aiRaw] = await Promise.all([
    fetchRegulatorySignals().catch((err) => {
      logger.error({ event: "feed_fetch_failed", feed: "regulatory", err }, "Regulatory feed fetch failed");
      return [];
    }),
    fetchSecuritySignals().catch((err) => {
      logger.error({ event: "feed_fetch_failed", feed: "security", err }, "Security news feed fetch failed");
      return [];
    }),
    fetchAIGovernanceSignals().catch((err) => {
      logger.error({ event: "feed_fetch_failed", feed: "ai_governance", err }, "AI governance feed fetch failed");
      return [];
    })
  ]);

  const sourceFeedSignals = [
    ...regulatoryRaw,
    ...securityRaw,
    ...aiRaw
  ].map((raw: any) => normalizeSignal(raw));

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
        organizationId: null,
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
      logger.error({ event: "signal_insert_failed", feed: "rss", title: signal.title, err }, "RSS signal insert failed");
    }
  }

  for (const signal of sourceFeedSignals as any[]) {
    try {
      const scores = scoreSignal({
        title: signal.title ?? "",
        source: signal.source ?? "unknown",
        summary: signal.summary ?? "",
        tags: signal.tags ?? []
      });

      const id = await saveSignal({
        organizationId: null,
        category: signal.category ?? "GENERAL",
        title: signal.title ?? "",
        source: signal.source ?? "unknown",
        sourceUrl: signal.url ?? signal.sourceUrl ?? "",
        summary: signal.summary ?? null,
        rawContent: signal.rawContent ?? signal.summary ?? null,
        externalId: signal.url ?? signal.sourceUrl ?? undefined,
        sourceSystem: signal.source ?? null,
        publishedAt: signal.published_at ?? signal.publishedAt ?? null,
        tags: signal.tags ?? [],
        processed: true,
        impactScore: scores.impactScore,
        noveltyScore: scores.noveltyScore,
        relevanceScore: scores.relevanceScore,
        priority: scores.priority
      });

      if (id) {
        savedSignals++;
      }
    } catch (err) {
      logger.error({ event: "signal_insert_failed", feed: "source", title: (signal as any).title, err }, "Source feed signal insert failed");
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

  try {
    insightsCreated = await generateInsights();
  } catch (err) {
    logger.error({ event: "insight_generation_failed", err }, "Insight generation failed");
  }

  try {
    const trends = generateTrends(rssSignals);
    for (const trend of trends) {
      try {
        await saveTrend({
          organizationId: null,
          name: trend.title,
          category: trend.category,
          description: trend.whyItMatters,
          score: trend.score,
          metadata: {
            riskLevel: trend.riskLevel,
            recommendedAction: trend.recommendedAction
          }
        });
        trendsCreated++;
      } catch (err) {
        logger.error({ event: "trend_insert_failed", title: trend.title, err }, "Trend insert failed");
      }
    }
  } catch (err) {
    logger.error({ event: "trend_generation_failed", err }, "Trend generation failed");
  }

  try {
    newslettersCreated = await generateNewsletter();
  } catch (err) {
    logger.error({ event: "newsletter_generation_failed", err }, "Newsletter generation failed");
  }

  try {
    deliveryResult = await generateNewsletterDeliveries();
  } catch (err) {
    logger.error({ event: "delivery_generation_failed", err }, "Newsletter delivery generation failed");
  }

  // Weekly send: only dispatch on Monday (UTC day 1)
  if (new Date().getUTCDay() === 1) {
    try {
      const draftIssue = await getLatestDraftIssue(null);
      if (draftIssue) {
        logger.info({ event: "newsletter_send_start", issueId: draftIssue.id }, "Weekly send window detected. Sending newsletter");
        await sendNewsletter(draftIssue);
      } else {
        logger.info({ event: "newsletter_send_skip", reason: "no_draft" }, "Weekly send window: no draft issue available to send");
      }
    } catch (err) {
      logger.error({ event: "newsletter_send_failed", err }, "Newsletter send failed");
    }
  } else {
    logger.info({ event: "newsletter_send_skip", reason: "schedule_guard" }, "Newsletter generated but not sent (weekly schedule guard)");
  }

  logger.info({
    event: "pipeline_complete",
    signals: savedSignals,
    insights: insightsCreated,
    trends: trendsCreated,
    newsletters: newslettersCreated,
    deliveries: deliveryResult.deliveriesCreated,
    deliveriesSkippedExisting: deliveryResult.deliveriesSkippedExisting,
    deliveriesSkippedSuppressed: deliveryResult.deliveriesSkippedSuppressed,
    deliveriesSkippedInactive: deliveryResult.deliveriesSkippedInactive
  }, "Pipeline complete");

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
