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
import { fetchVendorRiskSignals } from "../sources/vendorRiskFeed.js";

import {
  getLatestDraftIssue,
  getActiveIssue,
  promoteIssueToQueued
} from "../storage/postgresIssueStore.js";
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
  const [regulatoryRaw, securityRaw, aiRaw, vendorRaw] = await Promise.all([
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
    }),
    fetchVendorRiskSignals().catch((err) => {
      logger.error({ event: "feed_fetch_failed", feed: "vendor_risk", err }, "Vendor risk feed fetch failed");
      return [];
    })
  ]);

  const sourceFeedSignals = [
    ...regulatoryRaw,
    ...securityRaw,
    ...aiRaw,
    ...vendorRaw
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

  // Weekly send window: Monday UTC.
  // Promote the draft issue to 'queued' BEFORE delivery generation so the
  // delivery generator finds it and creates queued rows for the sender to drain.
  const isWeeklySendDay = new Date().getUTCDay() === 1;
  let sendIssueId: string | null = null;

  if (isWeeklySendDay) {
    try {
      const draftIssue = await getLatestDraftIssue(null);

      if (draftIssue) {
        const promoted = await promoteIssueToQueued(draftIssue.id);

        if (promoted) {
          sendIssueId = draftIssue.id;
          logger.info({ event: "issue_promoted", issueId: draftIssue.id }, "Draft issue promoted to queued for weekly send");
        } else {
          logger.warn({ event: "issue_promote_skipped", issueId: draftIssue.id }, "Issue promotion skipped — already queued or not in draft state");
        }
      } else {
        logger.info({ event: "newsletter_send_skip", reason: "no_draft" }, "Weekly send window: no draft issue to promote");
      }
    } catch (err) {
      logger.error({ event: "issue_promote_failed", err }, "Issue promotion failed");
    }
  }

  try {
    deliveryResult = await generateNewsletterDeliveries();
  } catch (err) {
    logger.error({ event: "delivery_generation_failed", err }, "Newsletter delivery generation failed");
  }

  // Send after delivery generation so queued rows exist for the sender to drain.
  // On weekly send day: send the freshly promoted issue.
  // Every run: also drain any previously queued issue (handles retries and no-subscriber cases).
  const queuedIssueForDrain = sendIssueId
    ? null
    : await getActiveIssue(null, ["queued"]).catch(() => null);

  const issueToSend = sendIssueId ?? queuedIssueForDrain?.id ?? null;

  if (issueToSend) {
    try {
      logger.info({ event: "newsletter_send_start", issueId: issueToSend }, "Dispatching newsletter for queued issue");
      await sendNewsletter(issueToSend);
    } catch (err) {
      logger.error({ event: "newsletter_send_failed", err }, "Newsletter send failed");
    }
  } else if (!isWeeklySendDay) {
    logger.info({ event: "newsletter_send_skip", reason: "no_queued_issue" }, "No queued issue to send");
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
