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
import { pgElevated } from "../../../../src/api/infra/postgres.js";
import {
  runMatcherForSignal,
  type CyberSignalRecord
} from "../../../../src/api/lib/cyberSignalProcessingService.js";

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
  VULNERABILITY: "patch_advisory",
  SECURITY_INCIDENT: "threat_actor",
  REGULATION: "regulatory_change",
  COMPLIANCE_UPDATE: "regulatory_change",
  VENDOR_RISK: "third_party_breach",
  AI_GOVERNANCE: "advisory",
  GENERAL: "advisory"
};

function mapCategoryToSignalType(category: string): string {
  return CATEGORY_TO_SIGNAL_TYPE[category.toUpperCase()] ?? "advisory";
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
): Promise<{ bridged: number; skipped: number; insertedSignals: CyberSignalRecord[] }> {
  let bridged = 0;
  let skipped = 0;
  const insertedSignals: CyberSignalRecord[] = [];

  for (const signal of signals) {
    const signalType = mapCategoryToSignalType(signal.category);
    const severity = mapImpactToSeverity(signal.impactScore);

    const dedupInput =
      `${signal.source}|${signalType}|${signal.affectedCve ?? ""}|${signal.affectedVendor ?? ""}`.toLowerCase();
    const dedupHash = crypto.createHash("sha256").update(dedupInput).digest("hex");

    const normalizedSummary = signal.summary.slice(0, 2000) || signal.title;

    try {
      const result = await pgElevated.query<{ id: string }>(
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
        // Build the CyberSignalRecord shape from the data we have
        // in scope. organization_id is "" sentinel because the row
        // is global (NULL) — runMatcherForSignal takes orgId
        // separately during fan-out, so the record's org_id field
        // is unused on that path. We use empty string rather than
        // null to keep the type non-nullable.
        insertedSignals.push({
          id: result.rows[0]!.id,
          organization_id: "",
          source: signal.source,
          signal_type: signalType,
          severity,
          normalized_summary: normalizedSummary,
          affected_vendor: signal.affectedVendor,
          affected_cve: signal.affectedCve
        });
      } else {
        skipped++;
      }
    } catch (err) {
      logger.error(
        {
          event: "cyber_signal_bridge_failed",
          source: signal.source,
          attempted_signal_type: signalType,
          category: signal.category,
          err
        },
        "Bridge to cyber_signals failed"
      );
    }
  }

  logger.info(
    { event: "cyber_signal_bridge_complete", bridged, skipped },
    `Bridge complete — ${bridged} bridged, ${skipped} skipped as duplicates`
  );

  return { bridged, skipped, insertedSignals };
}

// ---------------------------------------------------------------------------
// fanOutMatcherToActiveOrgs
//
// For each newly-inserted global signal, run the matcher against every
// active org. Per-(signal, org) try/catch isolates failures — one broken
// pair must not block the rest of the batch. The active-orgs query runs
// once per cycle and is reused across all signals.
//
// Closes the worker→matcher gap identified in docs/auto-matcher-audit.md
// §6: prior to this, global signals were stored but never matched against
// any org's inventory.
// ---------------------------------------------------------------------------

async function fanOutMatcherToActiveOrgs(
  signals: CyberSignalRecord[]
): Promise<{
  pairsAttempted: number;
  pairsSucceeded: number;
  pairsFailed: number;
  matchesProduced: number;
  elapsedMs: number;
}> {
  const start = Date.now();
  let pairsAttempted = 0;
  let pairsSucceeded = 0;
  let pairsFailed = 0;
  let matchesProduced = 0;

  if (signals.length === 0) {
    return {
      pairsAttempted: 0,
      pairsSucceeded: 0,
      pairsFailed: 0,
      matchesProduced: 0,
      elapsedMs: 0
    };
  }

  let activeOrgs: Array<{ id: string }> = [];
  try {
    const orgsResult = await pgElevated.query<{ id: string }>(
      `SELECT id FROM organizations WHERE status = 'active' ORDER BY id`
    );
    activeOrgs = orgsResult.rows;
  } catch (err) {
    logger.error(
      { event: "matcher_fanout_orgs_query_failed", err },
      "Active-orgs query failed; matcher fan-out skipped this cycle"
    );
    return {
      pairsAttempted: 0,
      pairsSucceeded: 0,
      pairsFailed: 0,
      matchesProduced: 0,
      elapsedMs: Date.now() - start
    };
  }

  if (activeOrgs.length === 0) {
    logger.info(
      { event: "matcher_fanout_no_active_orgs", signalCount: signals.length },
      "No active orgs; matcher fan-out is a no-op"
    );
    return {
      pairsAttempted: 0,
      pairsSucceeded: 0,
      pairsFailed: 0,
      matchesProduced: 0,
      elapsedMs: Date.now() - start
    };
  }

  for (const signal of signals) {
    for (const org of activeOrgs) {
      pairsAttempted++;
      try {
        const result = await runMatcherForSignal(signal, org.id);
        pairsSucceeded++;
        if (result.matched_branch !== "no_match") {
          matchesProduced++;
        }
      } catch (err) {
        pairsFailed++;
        logger.warn(
          {
            event: "matcher_fanout_pair_failed",
            orgId: org.id,
            signalId: signal.id,
            err
          },
          "Matcher fan-out pair failed; continuing with remaining pairs"
        );
      }
    }
  }

  const elapsedMs = Date.now() - start;
  logger.info(
    {
      event: "matcher_fanout_complete",
      signalCount: signals.length,
      activeOrgCount: activeOrgs.length,
      pairsAttempted,
      pairsSucceeded,
      pairsFailed,
      matchesProduced,
      elapsedMs
    },
    `Matcher fan-out complete — ${pairsSucceeded}/${pairsAttempted} pairs succeeded, ${matchesProduced} matches produced in ${elapsedMs}ms`
  );

  return {
    pairsAttempted,
    pairsSucceeded,
    pairsFailed,
    matchesProduced,
    elapsedMs
  };
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

  // Brief generation and delivery run once daily at 8AM UTC.
  // Signal ingestion (above) continues every hour regardless.
  const BRIEF_SEND_HOUR = 8;
  const currentHour = new Date().getUTCHours();

  if (currentHour === BRIEF_SEND_HOUR) {
    try {
      newslettersCreated = await generateNewsletter();
    } catch (err) {
      logger.error({ event: "newsletter_generation_failed", err }, "Newsletter generation failed");
    }

    let sendIssueId: string | null = null;

    try {
      const draftIssue = await getLatestDraftIssue(null);

      if (draftIssue) {
        const promoted = await promoteIssueToQueued(draftIssue.id);

        if (promoted) {
          sendIssueId = draftIssue.id;
          logger.info({ event: "issue_promoted", issueId: draftIssue.id }, "Draft issue promoted to queued for daily send");
        } else {
          logger.warn({ event: "issue_promote_skipped", issueId: draftIssue.id }, "Issue promotion skipped — already queued or not in draft state");
        }
      } else {
        logger.info({ event: "newsletter_send_skip", reason: "no_draft" }, "Daily send window: no draft issue to promote");
      }
    } catch (err) {
      logger.error({ event: "issue_promote_failed", err }, "Issue promotion failed");
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
    } else {
      logger.info({ event: "newsletter_send_skip", reason: "no_queued_issue" }, "No queued issue to send");
    }
  } else {
    logger.info(
      { event: "brief_generation_skip", currentHour, sendHour: BRIEF_SEND_HOUR },
      "Brief generation skipped — not send hour"
    );
  }

  // Bridge ingested signals to cyber_signals for the Intelligence Brief pipeline,
  // then fan out the matcher to every active org for each newly-inserted signal.
  // Closes the worker→matcher gap (audit doc §6 / §7).
  try {
    const bridgeResult = await bridgeSignalsToCyberSignals(bridgeableSignals);
    try {
      await fanOutMatcherToActiveOrgs(bridgeResult.insertedSignals);
    } catch (err) {
      logger.error(
        { event: "matcher_fanout_unexpected_error", err },
        "Matcher fan-out raised unexpectedly; continuing pipeline"
      );
    }
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
