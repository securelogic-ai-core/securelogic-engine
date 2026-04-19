import crypto from "crypto";

// rssCollector.ts retired — CISA coverage handled by regulatoryFeed.ts
// import { collectRssSignals } from "../collectors/rssCollector.js";

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
import { fetchRegulatoryEnforcementSignals } from "../sources/regulatoryEnforcementFeed.js";

import {
  getLatestDraftIssue,
  getActiveIssue,
  promoteIssueToQueued
} from "../storage/postgresIssueStore.js";
import { sendNewsletter } from "../delivery/sendNewsletter.js";
import { logger } from "../../../../src/api/infra/logger.js";
import { pg } from "../../../../src/api/infra/postgres.js";

export type PipelineResult = {
  signals: number;
  insights: number;
  trends: number;
  newsletters: number;
  deliveries: number;
  deliveriesSkippedSuppressed: number;
  deliveriesSkippedInactive: number;
};

// ---------------------------------------------------------------------------
// Category → signal_type bridge map
// ---------------------------------------------------------------------------

const CATEGORY_TO_SIGNAL_TYPE: Record<string, string> = {
  SECURITY_INCIDENT: "threat_actor",
  REGULATION: "regulatory",
  COMPLIANCE_UPDATE: "regulatory",
  VENDOR_RISK: "vendor_incident",
  AI_GOVERNANCE: "general",
  GENERAL: "general"
};

function mapCategoryToSignalType(category: string): string {
  return CATEGORY_TO_SIGNAL_TYPE[category.toUpperCase()] ?? "general";
}

// Maps 0-1 impact score → cyber_signals severity values.
function mapImpactToSeverity(impactScore: number): "Critical" | "High" | "Moderate" | "Low" {
  if (impactScore >= 0.8) return "Critical";
  if (impactScore >= 0.6) return "High";
  if (impactScore >= 0.4) return "Moderate";
  return "Low";
}

// ---------------------------------------------------------------------------
// bridgeSignalsToCyberSignals
// ---------------------------------------------------------------------------

type BridgeableSignal = {
  source: string;
  category: string;
  title: string;
  summary: string;
  affectedCve: string | null;
  affectedVendor: string | null;
  impactScore: number;
};

async function bridgeSignalsToCyberSignals(
  signals: BridgeableSignal[]
): Promise<{ bridged: number; skipped: number }> {
  let bridged = 0;
  let skipped = 0;

  for (const signal of signals) {
    const signalType = mapCategoryToSignalType(signal.category);
    const severity = mapImpactToSeverity(signal.impactScore);

    const dedupInput =
      `${signal.source}|${signalType}|${signal.affectedCve ?? ""}|${signal.affectedVendor ?? ""}`.toLowerCase();
    const dedupHash = crypto.createHash("sha256").update(dedupInput).digest("hex");

    const normalizedSummary = signal.summary.slice(0, 2000) || signal.title;

    try {
      const result = await pg.query(
        `INSERT INTO cyber_signals (
          organization_id,
          source,
          signal_type,
          severity,
          raw_payload,
          normalized_summary,
          affected_vendor,
          affected_cve,
          dedup_hash,
          processed
        ) VALUES (
          NULL, $1, $2, $3,
          $4::jsonb, $5,
          $6, $7,
          $8, FALSE
        )
        ON CONFLICT (dedup_hash) WHERE organization_id IS NULL DO NOTHING
        RETURNING id`,
        [
          signal.source,
          signalType,
          severity,
          JSON.stringify({ title: signal.title, summary: signal.summary }),
          normalizedSummary,
          signal.affectedVendor,
          signal.affectedCve,
          dedupHash
        ]
      );

      if (result.rows.length > 0) {
        bridged++;
      } else {
        skipped++;
      }
    } catch (err) {
      logger.error(
        { event: "cyber_signal_bridge_failed", source: signal.source, err },
        "Bridge to cyber_signals failed"
      );
    }
  }

  logger.info(
    { event: "cyber_signal_bridge_complete", bridged, skipped },
    `Bridge complete — ${bridged} bridged, ${skipped} skipped as duplicates`
  );

  return { bridged, skipped };
}

// ---------------------------------------------------------------------------
// runPipeline
// ---------------------------------------------------------------------------

export async function runPipeline(): Promise<PipelineResult> {
  logger.info({ event: "pipeline_start" }, "Running intelligence pipeline");

  // Collect all structured source feed signals concurrently.
  const [regulatoryRaw, securityRaw, aiRaw, vendorRaw, enforcementRaw] = await Promise.all([
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
    }),
    fetchRegulatoryEnforcementSignals().catch((err) => {
      logger.error({ event: "feed_fetch_failed", feed: "regulatory_enforcement", err }, "Regulatory enforcement feed fetch failed");
      return [];
    })
  ]);

  const sourceFeedSignals = [
    ...regulatoryRaw,
    ...securityRaw,
    ...aiRaw,
    ...vendorRaw,
    ...enforcementRaw
  ].map((raw: any) => normalizeSignal(raw));

  let savedSignals = 0;
  const bridgeableSignals: BridgeableSignal[] = [];

  for (const signal of sourceFeedSignals) {
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
        sourceUrl: signal.url ?? signal.url ?? "",
        summary: signal.summary ?? null,
        rawContent: signal.rawContent ?? signal.summary ?? null,
        externalId: signal.url ?? undefined,
        sourceSystem: signal.source ?? null,
        publishedAt: signal.timestamp ?? null,
        tags: signal.tags ?? [],
        processed: true,
        impactScore: scores.impactScore,
        noveltyScore: scores.noveltyScore,
        relevanceScore: scores.relevanceScore,
        priority: scores.priority
      });

      if (id) {
        savedSignals++;
        bridgeableSignals.push({
          source: signal.source ?? "unknown",
          category: signal.category ?? "GENERAL",
          title: signal.title ?? "",
          summary: signal.summary ?? "",
          affectedCve: signal.affectedCve ?? null,
          affectedVendor: signal.affectedVendor ?? null,
          impactScore: scores.impactScore
        });
      }
    } catch (err) {
      logger.error(
        { event: "signal_insert_failed", feed: "source", title: signal.title, err },
        "Source feed signal insert failed"
      );
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
    const trends = generateTrends(sourceFeedSignals as any);
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

  // Bridge ingested signals to cyber_signals for the Intelligence Brief pipeline.
  try {
    await bridgeSignalsToCyberSignals(bridgeableSignals);
  } catch (err) {
    logger.error({ event: "cyber_signal_bridge_error", err }, "cyber_signals bridge failed");
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
