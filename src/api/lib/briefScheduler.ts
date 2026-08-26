/**
 * briefScheduler.ts — Weekly Intelligence Brief pipeline runner.
 *
 * Runs weekly (Tuesday 07:00 UTC, cron "0 7 * * 2" in schedulerRunner) over a
 * trailing 7-day signal window. Email delivery is additionally gated by
 * isBriefSendDay() (Tuesday UTC) so manual/off-day runs generate but do not
 * email. Processes every ACTIVE organization — brief generation is an
 * organizational entitlement (ADR-0007); intelligence_brief_subscribers holds
 * email recipients only and never gates generation — running the complete
 * pipeline for each:
 *
 *   Step 1 — Fetch signals (once per run, shared across all orgs)
 *     - CISA KEV — full catalog, actively exploited CVEs
 *     - NVD      — last 7 days of published CVEs
 *
 *   Step 2 — Ingest signals per org
 *     - validate → normalize → INSERT ON CONFLICT DO NOTHING → processSignal
 *     - Identical pipeline to the manual fetch routes
 *
 *   Step 3 — Generate brief per org
 *     - Pulls org cyber_signals for the last 7 days
 *     - Runs generateBrief() (pure) + enrichBriefItems() (Claude)
 *     - Writes intelligence_briefs + intelligence_brief_items rows
 *     - Brief status transitions: generating → published (or failed)
 *
 *   Step 4 — Send brief per org
 *     - Calls sendBrief() — renders HTML, sends via Resend, records audit rows
 *     - Recipients resolve from intelligence_brief_subscribers; an org with
 *       zero active recipients keeps its generated in-platform brief and the
 *       skip is recorded as a delivery-health condition
 *
 * Orgs are processed through a fixed-size worker pool (ORG_CONCURRENCY = 2),
 * which bounds DB and external-API contention while removing the strict
 * serialization that made every org wait for the slowest org ahead of it.
 * Each org task owns a private result and NEVER writes to the run summary;
 * the scheduler merges those results, in org-enumeration order, once the pool
 * drains — so concurrency changes wall-clock and nothing else.
 * Signal feeds are fetched ONCE and ingested per-org to avoid repeated
 * external API calls.
 *
 * Entry point: runScheduler() — called by schedulerRunner (cron) and
 * POST /api/admin/briefs/run-scheduler (manual trigger).
 */

import { pg, pgElevated, withTenant, requireTenantContext } from "../infra/postgres.js";
import { createSavepointClient } from "../infra/tenantContext.js";
import { logger } from "../infra/logger.js";
import { fetchCisaKevSignals } from "./cisaKevAdapter.js";
import { fetchNvdSignals } from "./nvdAdapter.js";
import { fetchSecEdgarSignals } from "./secEdgarAdapter.js";
import { fetchFederalRegisterSignals } from "./federalRegisterAdapter.js";
import { recordFeedSuccess, recordFeedFailure } from "./feedHealth.js";
import { fetchCisaAlerts } from "./cisaAlertsAdapter.js";
import { fetchMitreAttackSignals } from "./mitreAttackAdapter.js";
import { fetchMitreAtlasSignals } from "./mitreAtlasAdapter.js";
import {
  fetchAllFeeds,
  THREAT_INTEL_FEED_IDS,
  REGULATORY_FEED_IDS
} from "./feedAdapter/index.js";
import {
  validateCyberSignalIngest,
  type CyberSignalIngestInput
} from "./cyberSignalValidation.js";
import { normalizeSignal } from "./cyberSignalNormalizer.js";
import {
  processSignal,
  canonicalizeVendorName,
  type CyberSignalRecord
} from "./cyberSignalProcessingService.js";
import {
  generateBrief,
  enrichBriefItems,
  capByUrgencyBuckets,
  finalizeBrief,
  sourcePriority,
  type CyberSignalForBrief,
  type BriefItem
} from "./intelligenceBriefGenerator.js";
import {
  sourceQualificationEnabled,
  loadSourceQualification,
  makeQualificationPriority
} from "./signals/sourceQualification.js";
import { recomputeSourceReliability } from "./signals/sourceReliability.js";
import { signalClusteringEnabled } from "./signals/signalClustering.js";
import { briefProvenanceEnabled, buildProvenanceRows } from "./signals/briefProvenance.js";
import { personalizeBriefItems } from "./briefPersonalizationService.js";
import { intelligenceEventsEnabled } from "./signals/intelligenceEventsFeatureFlag.js";
import { signalRecencyEnabled } from "./signalRecencyFeatureFlag.js";
import { briefRelevanceEnabled, filterSignalsByOrgRelevance } from "./briefRelevance.js";
import { fetchBriefEventRows } from "./signals/eventBriefSource.js";
import {
  runSynthesisSafely,
  fetchPriorBriefContext
} from "./briefSynthesizer.js";
import { sendBrief } from "./briefEmailSender.js";
import { emitBriefPublished } from "./briefWebhookEmitter.js";
import { isBriefSendDay, currentBriefWeekStart } from "./briefSendWindow.js";
import { maybeAlertBriefDelivery } from "./briefDeliveryHealth.js";
import { listBriefEligibleOrgIds } from "./briefEligibility.js";
import {
  beginLlmRunAccumulation,
  endLlmRunAccumulation,
  emptyLlmRunTotals,
  type LlmRunTotals
} from "./llm/llmTelemetry.js";
import {
  beginVerdictCacheAccumulation,
  endVerdictCacheAccumulation,
  type VerdictCacheTotals
} from "./llm/verdictCacheMetrics.js";
import {
  notMeasuredInThisProcess,
  type OutOfProcessMetric
} from "./llm/outOfProcessMetric.js";
import { mapWithConcurrency } from "./concurrency.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * The verdict cache's real numbers live in the matcher worker, not here.
 * Published in place of zeroed totals so a reader cannot mistake "this process
 * never saw it" for "it did nothing". See `outOfProcessMetric.ts` and #826.
 */
const VERDICT_CACHE_OUT_OF_PROCESS: OutOfProcessMetric = notMeasuredInThisProcess(
  "securelogic-intelligence-worker",
  "control_matcher_tick_complete",
  "Wave 4 moved control matching behind a durable queue drained by the intelligence worker; the verdict cache is reachable only from that worker's process, which this one does not start."
);

/** Look-back window for NVD and brief generation. */
const WINDOW_DAYS = 7;

/**
 * How many organizations the weekly run processes at once.
 *
 * Deliberately a hard-coded constant, not an env var: the safe value depends
 * on the Postgres pool (10 per pool, unchanged by this work), the Anthropic
 * rate limit, and the per-org connection profile — none of which an operator
 * can reason about from a dashboard field at 3am. It becomes configurable
 * when a measured run says a different number is right, not before.
 *
 * 2 is the conservative first step: it bounds peak connection demand at
 * roughly twice the sequential profile, which the existing pool absorbs with
 * large headroom, while still removing the strict serialization that turned
 * one slow org into every later org's delay.
 */
const ORG_CONCURRENCY = 2;


// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SchedulerRunSummary = {
  /** Active organizations enumerated for this run — the generation population. */
  active_orgs: number;
  orgs_processed: number;
  orgs_skipped: number;
  /**
   * Orgs skipped because they already hold a published brief for the current
   * weekly window (generated_at >= the most recent Tuesday 07:00 UTC). This is
   * what makes a rerun — cron re-fire, manual trigger, or catch-up after an
   * interrupted run — idempotent: completed orgs are never regenerated or
   * re-emailed; only the missing tail is reconciled.
   */
  orgs_skipped_already_current: number;
  signals_fetched: {
    cisa_kev: number;
    nvd: number;
    sec_edgar: number;
    federal_register: number;
    cisa_alerts: number;
    mitre_attack: number;
    mitre_atlas: number;
    threat_intel_rss: number;
    regulatory: number;
  };
  briefs_generated: number;
  emails_sent: number;
  emails_failed: number;
  /** Orgs whose brief was generated but NOT emailed because the run fell on a non-send day (any day except Tuesday UTC). */
  emails_skipped_off_day: number;
  /** Orgs whose brief was generated + published but NOT emailed because they have zero active recipients (send day only). */
  emails_skipped_no_recipients: number;
  /** Org ids with zero active email recipients on a send day — feeds the recurring delivery-health report; never a generation gate. */
  orgs_without_recipients: string[];
  errors: string[];
  /**
   * Token / cost / latency totals for every Anthropic call this run made
   * IN THIS PROCESS, overall and per purpose. `unpriced_calls` counts calls
   * whose model has no price entry — their spend is NOT in `cost_usd`, so a
   * non-zero value there means the cost figure is a floor, not a total.
   *
   * WHAT THIS IS NOT: it is not the run's total AI spend. Since Wave 4 the
   * control matcher executes in `securelogic-intelligence-worker`, so
   * `by_purpose` contains only the Brief-synthesis purposes
   * (`brief_item_enrichment`, `brief_headline`, `brief_exec_summary`) and NEVER
   * `llm_control_matcher`. Matcher spend is real and is reported by the worker
   * on `control_matcher_tick_complete`. An earlier version of this comment
   * claimed `by_purpose.llm_control_matcher` was "what was PAID"; that has been
   * false since Wave 4 and misled the #826 gate analysis.
   */
  llm: LlmRunTotals;
  /**
   * ALWAYS the out-of-process marker — never numbers.
   *
   * The verdict cache is reachable only from `verdictCache.ts` ← `llmControlMatcher.ts`
   * ← `controlMatcherWorker.ts`, and `server.ts` (this process) does not start
   * that worker. So the scheduler cannot observe a single lookup, and the zeroed
   * totals it used to publish were not a measurement — they were the absence of
   * one, formatted as evidence. See `outOfProcessMetric.ts`.
   */
  verdict_cache: OutOfProcessMetric;
  /**
   * Orgs whose task hit the outer safety net — an unforeseen throw, contained.
   *
   * Closes an accounting hole found while building the completion telemetry: a
   * task_fatal org incremented NEITHER orgs_processed NOR orgs_skipped, so it
   * vanished from the summary's org accounting while still appearing in
   * `errors`. With this counter the identity
   *   orgs_processed + orgs_skipped + orgs_task_fatal
   *     == active_orgs - orgs_skipped_already_current
   * holds on every path. Existing counters keep their exact prior meaning.
   */
  orgs_task_fatal: number;
  /**
   * DORMANT — always 0 / empty. No enforcement exists.
   *
   * Declared now so the summary shape, the alert path, and any dashboard built
   * on this run are already correct when a per-org deadline is eventually
   * approved, instead of needing a schema change at the moment enforcement
   * lands. Nothing in this file sets these: there is no timer, no clock
   * comparison, and no abort path anywhere in the org pipeline. A test asserts
   * they stay zero across every scenario, including the slowest.
   *
   * Enabling enforcement in PRODUCTION is blocked on production catch-up being
   * enabled and validated first — without it a timeout converts a slow org into
   * a silently missed weekly edition. See
   * docs/investigation/brief-scheduler-per-org-deadline-design.md §7.
   */
  orgs_deadline_exceeded: number;
  /** DORMANT — always empty. Org ids that hit a deadline, once one exists. */
  orgs_deadline_exceeded_ids: string[];
  /**
   * How the org fan-out actually behaved this run.
   *
   * `peak_in_flight` is MEASURED — an in-flight gauge sampled around each org
   * task — not derived from `limit`. It exists so "concurrency stayed bounded"
   * is a checkable claim in a staging run, not an inference from the constant.
   */
  org_concurrency: {
    limit: number;
    peak_in_flight: number;
  };
};

// ---------------------------------------------------------------------------
// ingestSignalsForOrg (local)
//
// Runs the standard ingest pipeline (validate → normalize → INSERT ON CONFLICT
// DO NOTHING → processSignal) for every signal in `signals`, scoped to `orgId`.
// Mirrors the loop in POST /api/cyber-signals/fetch/cisa-kev and /fetch/nvd.
// ---------------------------------------------------------------------------

type IngestResult = {
  inserted: number;
  skippedDuplicate: number;
  skippedInvalid: number;
  errors: string[];
};

async function ingestSignalsForOrg(
  signals: CyberSignalIngestInput[],
  orgId: string
): Promise<IngestResult> {
  let inserted = 0;
  let skippedDuplicate = 0;
  let skippedInvalid = 0;
  const errors: string[] = [];

  // Insert every signal inside ONE tenant transaction (savepoint per signal so
  // a single bad row rolls back without losing the rest — BEGIN/COMMIT/ROLLBACK
  // route through createSavepointClient as SAVEPOINT/RELEASE/ROLLBACK-TO).
  //
  // processSignal runs AFTER this scope's real COMMIT, not inside the loop: it
  // does all its work on pgElevated (a separate connection) and its contract is
  // "called after a signal row is committed". Running it inside the scope would
  // point it at a row the savepoint RELEASE has not really committed yet, so its
  // `UPDATE cyber_signals ... WHERE id` would match zero rows.
  const toProcess: CyberSignalRecord[] = [];

  await withTenant(orgId, async () => {
    const client = createSavepointClient(requireTenantContext());

    for (const rawSignal of signals) {
      const validated = validateCyberSignalIngest(rawSignal);
      if ("error" in validated) {
        skippedInvalid++;
        continue;
      }

      const normalized = normalizeSignal(validated.input);

      try {
        await client.query("BEGIN");

        const insertResult = await client.query(
          `INSERT INTO cyber_signals (
             organization_id, source, signal_type, severity, raw_payload,
             normalized_summary, affected_vendor, affected_cve, external_id,
             dedup_hash, published_at, ingestion_timestamp, processed
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), FALSE)
           ON CONFLICT (organization_id, dedup_hash) DO NOTHING
           RETURNING id, source, signal_type, severity, normalized_summary,
                     affected_vendor, affected_cve, organization_id`,
          [
            orgId,
            normalized.source,
            normalized.signal_type,
            normalized.severity,
            JSON.stringify(normalized.raw_payload),
            normalized.normalized_summary,
            normalized.affected_vendor,
            normalized.affected_cve,
            normalized.external_id,
            normalized.dedup_hash,
            normalized.published_at
          ]
        );

        const isDuplicate = (insertResult.rowCount ?? 0) === 0;

        if (isDuplicate) {
          await client.query("COMMIT");
          skippedDuplicate++;
          continue;
        }

        const signal = insertResult.rows[0];
        await client.query("COMMIT");

        toProcess.push({
          id: signal.id,
          organization_id: orgId,
          source: signal.source,
          signal_type: signal.signal_type,
          severity: signal.severity,
          normalized_summary: signal.normalized_summary,
          affected_vendor: signal.affected_vendor,
          affected_cve: signal.affected_cve
        });
      } catch (err) {
        try { await client.query("ROLLBACK"); } catch { /* ignore */ }
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(msg);
      }
    }
  });

  // Process committed signals OUTSIDE the tenant scope (processSignal uses
  // pgElevated and must see committed rows). It never throws — it returns a
  // partial result on failure — so a single failure does not abort the batch,
  // matching the previous per-signal behaviour.
  for (const signalRecord of toProcess) {
    await processSignal(signalRecord);
    inserted++;
  }

  return { inserted, skippedDuplicate, skippedInvalid, errors };
}

// ---------------------------------------------------------------------------
// generateAndStoreBrief (local)
//
// Generates and persists a complete Intelligence Brief for one org.
// Mirrors the logic in POST /api/intelligence-briefs/generate.
// Returns the briefId of the newly published brief.
// Throws on any unrecoverable error (rolls back and marks brief failed).
// ---------------------------------------------------------------------------

async function generateAndStoreBrief(orgId: string): Promise<GeneratedBrief> {
  const periodEnd = new Date();
  const periodStart = new Date(periodEnd.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000);

  // ── Phase 1: Insert brief + fetch signals (own tenant scope) ───────────────
  //
  // Runs in its OWN withTenant scope: the real COMMIT persists the brief row in
  // 'generating' state AND releases the tenant connection before Phase 2's
  // Claude calls. Holding a connection (and an open transaction) across multiple
  // Claude API calls would waste pool resources, risk connection timeouts, and
  // — post-flip — pin a tenant transaction open far too long. BEGIN/COMMIT/
  // ROLLBACK route through createSavepointClient as SAVEPOINT/RELEASE/ROLLBACK-TO.
  // briefId/base come back as the scope's return value so the rest of the
  // function (and the mark-failed handlers) can address the committed row.

  // B4: choose the source-credibility ordinal for brief ranking. Flag OFF (the
  // default) ⇒ legacy `sourcePriority`, so the pipeline below is byte-identical
  // to pre-B4. Flag ON ⇒ a qualification-derived priority (authority_tier ×
  // reliability) read from the GLOBAL `sources` table — loaded once here, before
  // the tenant transaction (sources has no org scope / RLS). `sourcePriority` is
  // the fallback for any source absent from the qualification map.
  let priorityOf = sourcePriority;
  if (sourceQualificationEnabled()) {
    // Per-brief-cycle, flag-gated, non-fatal: refresh B3 reliability from the
    // current feed_health snapshot so ranking reads fresh values. A recompute
    // failure must NOT block the brief — fall through to whatever values the
    // `sources` table already holds. No worker/cron involved (engine-only).
    try {
      await recomputeSourceReliability(pgElevated);
    } catch (err) {
      logger.error(
        { event: "source_reliability_recompute_failed", orgId, err },
        "Source reliability recompute failed (non-fatal) — using existing sources.reliability"
      );
    }
    priorityOf = makeQualificationPriority(await loadSourceQualification(pg), sourcePriority);
  }

  const { briefId, base, signalMeta } = await withTenant(orgId, async () => {
    const client = createSavepointClient(requireTenantContext());
    try {
      await client.query("BEGIN");

      const insertBriefResult = await client.query<{ id: string }>(
        `INSERT INTO intelligence_briefs
           (organization_id, period_start, period_end, status)
         VALUES ($1, $2, $3, 'generating')
         RETURNING id`,
        [orgId, periodStart.toISOString(), periodEnd.toISOString()]
      );
      const newBriefId = insertBriefResult.rows[0]!.id;

      // Intelligence Pipeline Hardening (item 1): when the canonical-event flag
      // is ON, the Brief reads from canonical Intelligence Events (normalized,
      // deduplicated, quality-gated) instead of raw cyber_signals. Flag OFF →
      // the exact legacy query, byte-identical behavior.
      // IQP Q2 (audit defect #4): with the recency flag ON, the window filters
      // on the EFFECTIVE event date COALESCE(published_at, ingestion_timestamp)
      // — a source-dated old item (ancient KEV entry, historical backfill)
      // falls OUTSIDE the window and is suppressed; unknown-date rows keep the
      // ingestion-time behavior. Flag OFF → the exact legacy query.
      const recencyOn = signalRecencyEnabled();
      const briefSourceRows: CyberSignalForBrief[] = intelligenceEventsEnabled()
        ? await fetchBriefEventRows(client, periodStart.toISOString(), periodEnd.toISOString())
        : (
            await client.query<CyberSignalForBrief>(
              recencyOn
                ? `SELECT id, signal_type, severity, normalized_summary,
                          affected_cve, affected_vendor, source, ingestion_timestamp,
                          cluster_key, raw_payload
                   FROM cyber_signals
                   WHERE (organization_id = $1 OR organization_id IS NULL)
                     AND COALESCE(published_at, ingestion_timestamp) >= $2
                     AND COALESCE(published_at, ingestion_timestamp) < $3
                   ORDER BY ingestion_timestamp DESC`
                : `SELECT id, signal_type, severity, normalized_summary,
                          affected_cve, affected_vendor, source, ingestion_timestamp,
                          cluster_key, raw_payload
                   FROM cyber_signals
                   WHERE (organization_id = $1 OR organization_id IS NULL)
                     AND ingestion_timestamp >= $2
                     AND ingestion_timestamp < $3
                   ORDER BY ingestion_timestamp DESC`,
              [orgId, periodStart.toISOString(), periodEnd.toISOString()]
            )
          ).rows;

      // IQP Q2 observability: count what recency enforcement suppressed —
      // rows inside the ingestion-time window whose source-authoritative date
      // is older than the window start (the stale-KEV signature).
      if (recencyOn && !intelligenceEventsEnabled()) {
        const suppressed = await client.query<{ n: number }>(
          `SELECT COUNT(*)::int AS n
           FROM cyber_signals
           WHERE (organization_id = $1 OR organization_id IS NULL)
             AND ingestion_timestamp >= $2 AND ingestion_timestamp < $3
             AND published_at IS NOT NULL AND published_at < $2`,
          [orgId, periodStart.toISOString(), periodEnd.toISOString()]
        );
        const n = suppressed.rows[0]?.n ?? 0;
        if (n > 0) {
          logger.info(
            { event: "stale_signal_suppressed", organizationId: orgId, count: n },
            "Recency enforcement suppressed stale signals from the brief window"
          );
        }
      }

      // IQP Q3 (#5a): INTERIM org-relevance gate. Vendor-keyed breach claims
      // (third_party_breach — the EDGAR shape) render ONLY when their vendor
      // canonically matches one of this org's ACTIVE vendors — the SAME
      // canonicalizeVendorName comparison + vendor query the matcher uses.
      // Everything else (CVE/KEV/advisory/threat intel) passes through.
      // Flag OFF ⇒ this whole block is skipped ⇒ byte-identical brief.
      let relevantRows = briefSourceRows;
      if (briefRelevanceEnabled()) {
        const vendorResult = await client.query<{ name: string }>(
          `SELECT name FROM vendors WHERE organization_id = $1 AND status = 'active'`,
          [orgId]
        );
        const canonicalVendorSet = new Set(
          vendorResult.rows.map((v) => canonicalizeVendorName(v.name))
        );
        const { kept, suppressed } = filterSignalsByOrgRelevance(
          briefSourceRows,
          canonicalVendorSet,
          canonicalizeVendorName
        );
        relevantRows = kept;
        if (suppressed.length > 0) {
          logger.info(
            { event: "irrelevant_signal_suppressed", organizationId: orgId, count: suppressed.length },
            "Org-relevance gate suppressed unmatched vendor-keyed signals from the brief"
          );
        }
      }

      // generateBrief is pure — safe to run inside this transaction.
      // Returns the pre-enrichment shortlist (top ENRICHMENT_SHORTLIST items
      // by composite ranking key); enrichment runs on the shortlist, then
      // capByUrgencyBuckets reduces to BRIEF_MAX_ITEMS.
      const newBase = generateBrief(relevantRows, {
        priorityOf,
        clusteringEnabled: signalClusteringEnabled()
      });

      // D2: per-signal source + cluster_key, so the persist phase can denormalise
      // them onto provenance edges (incl. corroborating signals not on the item).
      const newSignalMeta = new Map<string, { source: string; cluster_key: string | null }>(
        briefSourceRows.map((s) => [s.id, { source: s.source, cluster_key: s.cluster_key ?? null }])
      );

      await client.query("COMMIT");
      return { briefId: newBriefId, base: newBase, signalMeta: newSignalMeta };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    }
  });

  // ── Phase 2: Enrich (Claude calls, no DB connection held) ───────────────────
  //
  // enrichBriefItems is designed as non-fatal (always resolves). Even if all
  // Claude calls fail it returns the unenriched base items rather than throwing.
  // We still wrap this in try/catch: if it unexpectedly throws we mark the brief
  // as failed before re-throwing so it never stays stuck in 'generating'.

  let enrichedItems: BriefItem[];
  try {
    enrichedItems = await enrichBriefItems(base.shortlist, orgId);
  } catch (enrichErr) {
    // Mark-failed in its OWN tenant scope. Phase 1 committed the 'generating'
    // row in a separate scope, so this UPDATE finds it; its own scope keeps the
    // write RLS-scoped after the app_request flip. Best-effort — never mask the
    // original enrichment error.
    await withTenant(orgId, async () => {
      await pg.query(
        `UPDATE intelligence_briefs
         SET status = 'failed', updated_at = NOW()
         WHERE id = $1`,
        [briefId]
      );
    }).catch(() => {});
    throw enrichErr;
  }

  // Provider-degradation counters, read off the items enrichment just returned.
  //
  // enrichBriefItems never throws: a failed Claude call degrades that item to a
  // template fallback and carries `enrichment_status: "fallback"`. Counting
  // them here is what lets scheduler_org_complete answer "was this org slow, or
  // was the provider failing?" without a second telemetry channel. Taken BEFORE
  // the urgency cap, so the denominator is everything enrichment attempted
  // rather than what survived ranking.
  const enrichment: EnrichmentCounters = {
    total: enrichedItems.length,
    enriched: enrichedItems.filter((i) => i.enrichment_status !== "fallback").length,
    fallback: enrichedItems.filter((i) => i.enrichment_status === "fallback").length
  };

  // Apply the urgency-bucket cap. After this, cappedItems.length is bounded
  // by BRIEF_MAX_ITEMS — this is what gets persisted and synthesized.
  const { items: cappedItems, counts: urgencyCounts } =
    capByUrgencyBuckets(enrichedItems, priorityOf);

  logger.info(
    {
      event: "brief_capped",
      brief_id: briefId,
      org_id: orgId,
      shortlisted: base.shortlist.length,
      enriched: enrichedItems.length,
      kept: cappedItems.length,
      dropped: enrichedItems.length - cappedItems.length,
      immediate: urgencyCounts.immediate,
      near_term: urgencyCounts.near_term,
      far_term: urgencyCounts.far_term
    },
    "Brief capped"
  );

  // Personalize items — the SAME step, in the SAME position, as the manual
  // generate route (POST /api/intelligence-briefs/generate): match capped
  // items against the org's vendors, risks, AI systems and obligations BEFORE
  // synthesis and persistence. Until IQ-1 this call existed only on the manual
  // route, so every scheduler-produced brief shipped is_personalized=FALSE /
  // platform_context=NULL and the customer-facing "affects your environment"
  // surfaces had nothing to render. Non-fatal, exactly like the route: a
  // personalization failure publishes the brief without personalization.
  // (fetchOrgPlatformContext opens its own withTenant scope internally.)
  let personalizedItems: Awaited<ReturnType<typeof personalizeBriefItems>>;
  try {
    personalizedItems = await personalizeBriefItems(cappedItems, orgId);
  } catch (personalizationErr) {
    logger.warn(
      { event: "brief_personalization_failed", orgId, briefId, err: personalizationErr },
      "Brief personalization failed — publishing without personalization data"
    );
    personalizedItems = cappedItems.map((item) => ({
      ...item,
      is_personalized: false,
      platform_context: null
    }));
  }

  // Brief-level synthesis — one Claude call producing a 12-word headline.
  // Non-fatal: failure resolves to null and the brief publishes without one.
  // Run on personalizedItems (same objects as cappedItems, post-cap) so
  // headline/teaser describe what's actually in the brief, not what was
  // dropped — and so synthesis sees personalization, matching the route.
  //
  // Prior-brief context drives the exec summary's week-on-week calibration
  // sentence. Returns null on first-brief-ever cases; the prompt drops to
  // a 3-sentence summary in that case.
  // fetchPriorBriefContext reads intelligence_briefs; run it in a read-only
  // tenant scope so the SELECT is RLS-visible after the app_request flip.
  const priorContext = await withTenant(orgId, () =>
    fetchPriorBriefContext(orgId, briefId)
  );
  const synthesis = await runSynthesisSafely(personalizedItems, priorContext, orgId);

  const finalized = finalizeBrief(
    personalizedItems,
    periodStart.toISOString(),
    periodEnd.toISOString(),
    base.signal_count
  );
  const contentJsonWithSynthesis = { ...finalized.content_json, synthesis };

  // ── Phase 3: Insert items + publish (own tenant scope, explicit fail-safe) ──
  //
  // Runs in its OWN withTenant scope; BEGIN/COMMIT/ROLLBACK route through
  // createSavepointClient. The publish UPDATE is the last step. If the scope
  // throws, withTenant rolls the whole transaction back — so the mark-failed
  // CANNOT live inside this scope (the rollback would discard it). Instead the
  // outer catch marks the brief 'failed' in a SEPARATE withTenant scope. The
  // 'generating' row was committed by Phase 1's own scope, so that UPDATE finds
  // it, and runScheduler() skips sendBrief() for this org.

  try {
    await withTenant(orgId, async () => {
      const client = createSavepointClient(requireTenantContext());
      try {
        await client.query("BEGIN");

        if (personalizedItems.length > 0) {
          const itemValues: unknown[] = [];
          const itemPlaceholders: string[] = [];

          // 19 columns per item — the manual route's exact insert (incl.
          // is_personalized + platform_context), so scheduler-produced briefs
          // persist personalization identically to manually generated ones.
          personalizedItems.forEach((item, idx: number) => {
            const b = idx * 19;
            itemPlaceholders.push(
              `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, ` +
              `$${b + 6}, $${b + 7}, $${b + 8}, $${b + 9}, $${b + 10}, ` +
              `$${b + 11}, $${b + 12}, $${b + 13}, $${b + 14}, $${b + 15}, ` +
              `$${b + 16}, $${b + 17}, $${b + 18}, $${b + 19})`
            );
            itemValues.push(
              orgId,
              briefId,
              item.cyber_signal_id,
              item.category,
              item.relevance,
              item.title,
              item.summary,
              item.affected_cve,
              item.affected_vendor,
              item.source_slug,
              item.signal_type,
              item.severity,
              item.sort_order,
              item.why_it_matters ?? null,
              item.recommended_actions ?? null,
              item.analyst_notes ?? null,
              item.is_personalized,
              item.platform_context ? JSON.stringify(item.platform_context) : null,
              item.urgency ?? null
            );
          });

          const insertedItems = await client.query<{ id: string; sort_order: number }>(
            `INSERT INTO intelligence_brief_items
               (organization_id, brief_id, cyber_signal_id, category, relevance,
                title, summary, affected_cve, affected_vendor, source_slug,
                signal_type, severity, sort_order,
                why_it_matters, recommended_actions, analyst_notes,
                is_personalized, platform_context,
                urgency)
             VALUES ${itemPlaceholders.join(", ")}
             RETURNING id, sort_order`,
            itemValues
          );

          // D2 (flag-gated): write lineage edges (canonical + corroborating) for
          // each persisted item, in THIS tenant transaction so the RLS policy is
          // satisfied and the edges are atomic with the items.
          // Signal-provenance edges reference cyber_signals(id); in event-backed
          // mode the item ids are event ids, and the event IS the provenance, so
          // the edge write is skipped (guarded by the canonical-event flag).
          if (briefProvenanceEnabled() && !intelligenceEventsEnabled()) {
            const idBySortOrder = new Map<number, string>(
              insertedItems.rows.map((r) => [r.sort_order, r.id])
            );
            const sourceById = new Map<string, string | null>(
              [...signalMeta].map(([sid, m]) => [sid, m.source])
            );
            for (const item of finalized.items as BriefItem[]) {
              const briefItemId = idBySortOrder.get(item.sort_order);
              if (!briefItemId) continue;
              const clusterKey = signalMeta.get(item.cyber_signal_id)?.cluster_key ?? null;
              const rows = buildProvenanceRows(item, briefItemId, orgId, clusterKey, sourceById);
              for (const row of rows) {
                await client.query(
                  `INSERT INTO intelligence_brief_item_provenance
                     (organization_id, brief_item_id, cyber_signal_id, source_slug, cluster_key, relation)
                   VALUES ($1, $2, $3, $4, $5, $6)
                   ON CONFLICT (brief_item_id, cyber_signal_id) DO NOTHING`,
                  [row.organization_id, row.brief_item_id, row.cyber_signal_id, row.source_slug, row.cluster_key, row.relation]
                );
              }
            }
          }
        }

        // Explicitly set status to 'published' before this function returns so
        // sendBrief() in runScheduler() sees a fully committed 'published' row.
        await client.query(
          `UPDATE intelligence_briefs
           SET status           = 'published',
               signal_count     = $2,
               item_count       = $3,
               content_json     = $4::jsonb,
               content_markdown = $5,
               generated_at     = NOW(),
               published_at     = NOW(),
               updated_at       = NOW()
           WHERE id = $1`,
          [
            briefId,
            finalized.signal_count,
            finalized.item_count,
            JSON.stringify(contentJsonWithSynthesis),
            finalized.content_markdown
          ]
        );

        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      }
    });

    // Wave-1 (DS-15): emit AFTER the commit — a rollback can never produce a
    // phantom brief.published. No-op while wave 1 is dark.
    emitBriefPublished(orgId, {
      brief_id: briefId,
      signal_count: finalized.signal_count,
      item_count: finalized.item_count,
      trigger: "scheduler",
    });

    return { briefId, enrichment };
  } catch (err) {
    // Mark the brief 'failed' in a SEPARATE tenant scope so the Phase 3
    // rollback above cannot discard it. Best-effort — never mask the original
    // error. runScheduler() catches the rethrow and skips sendBrief().
    await withTenant(orgId, async () => {
      await pg.query(
        `UPDATE intelligence_briefs
         SET status = 'failed', updated_at = NOW()
         WHERE id = $1`,
        [briefId]
      );
    }).catch(() => {});
    throw err;
  }
}

// ---------------------------------------------------------------------------
// listOrgsWithCurrentBrief — the idempotency skip set
// ---------------------------------------------------------------------------

/**
 * Orgs that already hold a published brief for the weekly window starting at
 * `weekStart`. Cross-org read by design → pgElevated (same enumeration class
 * as listBriefEligibleOrgIds and the staleness sweep). Exported for testing
 * and for briefCatchup's completeness check.
 */
export async function listOrgsWithCurrentBrief(weekStart: Date): Promise<Set<string>> {
  const result = await pgElevated.query<{ organization_id: string }>(
    `SELECT DISTINCT organization_id
     FROM intelligence_briefs
     WHERE status = 'published'
       AND generated_at >= $1`,
    [weekStart.toISOString()]
  );
  return new Set(result.rows.map((r) => r.organization_id));
}

// ---------------------------------------------------------------------------
// Per-org run result — the unit the concurrent fan-out produces
//
// Each org task owns a private draft, mutates ONLY that draft, and returns it
// sealed. Nothing concurrent ever writes to the shared SchedulerRunSummary:
// that is what makes the counters exact under concurrency rather than
// "probably fine because JavaScript is single-threaded". (It IS single-
// threaded, so `summary.x++` could not tear — but read-modify-write across an
// `await` interleaves freely, and the send/generate paths are full of awaits.
// Local drafts remove the question entirely instead of reasoning about it.)
// ---------------------------------------------------------------------------

/**
 * Provider-degradation counters for one org's enrichment pass.
 *
 * `fallback > 0` means Claude calls failed and those items shipped as
 * templates. This is the discriminator that separates "the org was slow" from
 * "the provider was failing" when reading a slow run — see
 * docs/investigation/brief-scheduler-per-org-deadline-design.md §6.
 */
export type EnrichmentCounters = {
  total: number;
  enriched: number;
  fallback: number;
};

/** What generateAndStoreBrief hands back: the published id plus what it cost. */
type GeneratedBrief = {
  briefId: string;
  enrichment: EnrichmentCounters;
};

/**
 * How one org's task ended.
 *
 * `deadline_exceeded` is DORMANT — declared so the metric shape, the log
 * vocabulary, and the summary counter all exist before any enforcement does,
 * and so a dashboard built on this event does not need a schema change later.
 * NOTHING in this file produces it: there is no timer, no clock comparison, and
 * no abort path. A per-org deadline is a separate, unapproved package
 * (docs/investigation/brief-scheduler-per-org-deadline-design.md), and it is
 * explicitly blocked on production catch-up being enabled first.
 */
export type OrgCompletionStatus =
  | "succeeded"
  | "generate_failed"
  | "task_fatal"
  | "deadline_exceeded";

/** Mutable working copy, private to one org task. */
type OrgRunDraft = {
  orgs_processed: number;
  orgs_skipped: number;
  briefs_generated: number;
  emails_sent: number;
  emails_failed: number;
  emails_skipped_off_day: number;
  emails_skipped_no_recipients: number;
  orgs_task_fatal: number;
  orgs_without_recipients: string[];
  errors: string[];
  /** Null until enrichment runs — a generation failure before it leaves this unset. */
  enrichment: EnrichmentCounters | null;
};

/** Sealed result handed back to the scheduler for merging. */
export type OrgRunResult = Readonly<{
  org_id: string;
  orgs_processed: number;
  orgs_skipped: number;
  briefs_generated: number;
  emails_sent: number;
  emails_failed: number;
  emails_skipped_off_day: number;
  emails_skipped_no_recipients: number;
  orgs_task_fatal: number;
  orgs_without_recipients: ReadonlyArray<string>;
  errors: ReadonlyArray<string>;
  enrichment: EnrichmentCounters | null;
}>;

function emptyOrgRunDraft(): OrgRunDraft {
  return {
    orgs_processed: 0,
    orgs_skipped: 0,
    briefs_generated: 0,
    emails_sent: 0,
    emails_failed: 0,
    emails_skipped_off_day: 0,
    emails_skipped_no_recipients: 0,
    orgs_task_fatal: 0,
    orgs_without_recipients: [],
    errors: [],
    enrichment: null
  };
}

/** Freeze a draft (arrays included) so the merge cannot be aliased into it. */
function sealOrgResult(orgId: string, draft: OrgRunDraft): OrgRunResult {
  return Object.freeze({
    org_id: orgId,
    orgs_processed: draft.orgs_processed,
    orgs_skipped: draft.orgs_skipped,
    briefs_generated: draft.briefs_generated,
    emails_sent: draft.emails_sent,
    emails_failed: draft.emails_failed,
    emails_skipped_off_day: draft.emails_skipped_off_day,
    emails_skipped_no_recipients: draft.emails_skipped_no_recipients,
    orgs_task_fatal: draft.orgs_task_fatal,
    orgs_without_recipients: Object.freeze([...draft.orgs_without_recipients]),
    errors: Object.freeze([...draft.errors]),
    enrichment: draft.enrichment === null ? null : Object.freeze({ ...draft.enrichment })
  });
}

/**
 * Fold per-org results into the run summary. THE ONLY writer of these fields.
 *
 * Walks `results` in input (org enumeration) order, so `errors` and
 * `orgs_without_recipients` keep the exact ordering the sequential loop
 * produced — completion order never leaks into the summary.
 */
function mergeOrgResults(
  summary: SchedulerRunSummary,
  results: ReadonlyArray<OrgRunResult>
): void {
  for (const r of results) {
    summary.orgs_processed += r.orgs_processed;
    summary.orgs_skipped += r.orgs_skipped;
    summary.briefs_generated += r.briefs_generated;
    summary.emails_sent += r.emails_sent;
    summary.emails_failed += r.emails_failed;
    summary.emails_skipped_off_day += r.emails_skipped_off_day;
    summary.emails_skipped_no_recipients += r.emails_skipped_no_recipients;
    summary.orgs_task_fatal += r.orgs_task_fatal;
    summary.orgs_without_recipients.push(...r.orgs_without_recipients);
    summary.errors.push(...r.errors);
  }
}

/**
 * The signal feeds fetched once per run and shared, read-only, by every org.
 */
type FetchedFeeds = Readonly<{
  cisaKevSignals: CyberSignalIngestInput[];
  nvdSignals: CyberSignalIngestInput[];
  secEdgarSignals: CyberSignalIngestInput[];
  federalRegisterSignals: CyberSignalIngestInput[];
  cisaAlertSignals: CyberSignalIngestInput[];
  mitreAttackSignals: CyberSignalIngestInput[];
  mitreAtlasSignals: CyberSignalIngestInput[];
  threatIntelSignals: CyberSignalIngestInput[];
  regulatorySignals: CyberSignalIngestInput[];
}>;

// ---------------------------------------------------------------------------
// processOrg — the complete per-org pipeline, as one isolated task
//
// Identical step order, identical error handling, identical logging to the
// sequential loop this replaces. The ONLY differences are that it writes to a
// private draft instead of the shared summary, and that it cannot throw.
// ---------------------------------------------------------------------------

/**
 * Emit exactly one `scheduler_org_complete` for an org task.
 *
 * WHY IT CANNOT FAIL THE RUN
 * --------------------------
 * Telemetry is never load-bearing. The whole body is wrapped: a logger that
 * throws, a serializer that chokes on a field, anything at all — the org's
 * actual outcome is already computed and sealed by the time this runs, so
 * swallowing is correct rather than lossy. The alternative, an emit that can
 * abort an org, would make the observability package a new source of the exact
 * failure it exists to observe.
 *
 * There is deliberately no fallback logging inside the catch: if `logger.info`
 * just threw, `logger.error` is not a safe recovery.
 */
function emitOrgCompletion(
  orgId: string,
  durationMs: number,
  status: OrgCompletionStatus,
  draft: OrgRunDraft
): void {
  try {
    logger.info(
      {
        event: "scheduler_org_complete",
        organization_id: orgId,
        duration_ms: durationMs,
        status,
        brief_generated: draft.briefs_generated > 0,
        emails_sent: draft.emails_sent,
        emails_failed: draft.emails_failed,
        email_skipped_off_day: draft.emails_skipped_off_day > 0,
        email_skipped_no_recipients: draft.emails_skipped_no_recipients > 0,
        error_count: draft.errors.length,
        // Provider-degradation counters. Null when generation failed before
        // enrichment ran — distinguishable from a genuine zero.
        enrichment_total: draft.enrichment?.total ?? null,
        enrichment_enriched: draft.enrichment?.enriched ?? null,
        enrichment_fallback: draft.enrichment?.fallback ?? null
      },
      "Org processing completed"
    );
  } catch {
    // Never load-bearing.
  }
}

async function processOrg(
  orgId: string,
  feeds: FetchedFeeds,
  isSendDay: boolean
): Promise<OrgRunResult> {
  const orgResult = emptyOrgRunDraft();

  // Measured from slot admission, NOT from run start: queue time is the
  // scheduler's to answer for, never charged to the org. Date.now() (not a
  // monotonic clock) is deliberate — it matches the semantics of the existing
  // scheduler_cron_complete.durationMs an operator will compare this against.
  const startedAt = Date.now();
  let status: OrgCompletionStatus = "succeeded";

  try {
    await runOrgPipeline(orgId, feeds, isSendDay, orgResult);
    // A generation failure returns normally after recording orgs_skipped; that
    // is a failed org, not a succeeded one.
    if (orgResult.orgs_skipped > 0) status = "generate_failed";
  } catch (err) {
    // Defense in depth. Every step inside runOrgPipeline is already
    // individually try/caught, so arriving here means an unforeseen throw.
    //
    // This is a DELIBERATE behaviour change from the sequential loop, and the
    // only one: there, an unhandled throw escaped runSchedulerPass and killed
    // the whole run, abandoning every org after it. Under a fan-out that is
    // worse still — a rejection would surface as a rejected Promise.all and
    // could abort sibling work. So an unexpected failure is contained to its
    // own org, recorded in that org's errors, and the run continues.
    //
    // Whatever the draft accumulated before the throw is KEPT: partial truth
    // beats a zeroed result that hides work already done (and money spent).
    const msg = err instanceof Error ? err.message : String(err);
    orgResult.errors.push(`org:${orgId} org_task_fatal: ${msg}`);
    logger.error(
      { event: "scheduler_org_task_fatal", orgId, err },
      "Org task threw unexpectedly — isolated to this org, run continues"
    );
    status = "task_fatal";
    orgResult.orgs_task_fatal++;
  }

  // Exactly one emission per org task, on EVERY exit path — success, recorded
  // generation failure, and the outer net alike. Placed after the try/catch
  // rather than in a `finally` so the status assigned in the catch is the one
  // reported; a `finally` would race the catch's own assignment.
  emitOrgCompletion(orgId, Date.now() - startedAt, status, orgResult);

  return sealOrgResult(orgId, orgResult);
}

async function runOrgPipeline(
  orgId: string,
  feeds: FetchedFeeds,
  isSendDay: boolean,
  orgResult: OrgRunDraft
): Promise<OrgRunDraft> {
  logger.info({ event: "scheduler_org_start", orgId }, "Processing org");

  let orgFailed = false;

  // Ingest CISA KEV signals for this org
  if (feeds.cisaKevSignals.length > 0) {
    try {
      const result = await ingestSignalsForOrg(feeds.cisaKevSignals, orgId);
      logger.info(
        {
          event: "scheduler_kev_ingested",
          orgId,
          inserted: result.inserted,
          skippedDuplicate: result.skippedDuplicate,
          skippedInvalid: result.skippedInvalid,
          errors: result.errors.length
        },
        "CISA KEV ingested for org"
      );
      for (const e of result.errors) {
        orgResult.errors.push(`org:${orgId} kev_ingest: ${e}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      orgResult.errors.push(`org:${orgId} kev_ingest_fatal: ${msg}`);
      logger.error({ event: "scheduler_kev_ingest_failed", orgId, err }, "CISA KEV ingest failed for org");
    }
  }

  // Ingest NVD signals for this org
  if (feeds.nvdSignals.length > 0) {
    try {
      const result = await ingestSignalsForOrg(feeds.nvdSignals, orgId);
      logger.info(
        {
          event: "scheduler_nvd_ingested",
          orgId,
          inserted: result.inserted,
          skippedDuplicate: result.skippedDuplicate,
          skippedInvalid: result.skippedInvalid,
          errors: result.errors.length
        },
        "NVD ingested for org"
      );
      for (const e of result.errors) {
        orgResult.errors.push(`org:${orgId} nvd_ingest: ${e}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      orgResult.errors.push(`org:${orgId} nvd_ingest_fatal: ${msg}`);
      logger.error({ event: "scheduler_nvd_ingest_failed", orgId, err }, "NVD ingest failed for org");
    }
  }

  // Ingest SEC EDGAR 8-K Item 1.05 signals for this org
  if (feeds.secEdgarSignals.length > 0) {
    try {
      const result = await ingestSignalsForOrg(feeds.secEdgarSignals, orgId);
      logger.info(
        {
          event: "scheduler_sec_edgar_ingested",
          orgId,
          inserted: result.inserted,
          skippedDuplicate: result.skippedDuplicate,
          skippedInvalid: result.skippedInvalid,
          errors: result.errors.length
        },
        "SEC EDGAR ingested for org"
      );
      for (const e of result.errors) {
        orgResult.errors.push(`org:${orgId} sec_edgar_ingest: ${e}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      orgResult.errors.push(`org:${orgId} sec_edgar_ingest_fatal: ${msg}`);
      logger.error({ event: "scheduler_sec_edgar_ingest_failed", orgId, err }, "SEC EDGAR ingest failed for org");
    }
  }

  // Ingest Federal Register regulatory signals for this org
  if (feeds.federalRegisterSignals.length > 0) {
    try {
      const result = await ingestSignalsForOrg(feeds.federalRegisterSignals, orgId);
      logger.info(
        {
          event: "scheduler_federal_register_ingested",
          orgId,
          inserted: result.inserted,
          skippedDuplicate: result.skippedDuplicate,
          skippedInvalid: result.skippedInvalid,
          errors: result.errors.length
        },
        "Federal Register ingested for org"
      );
      for (const e of result.errors) {
        orgResult.errors.push(`org:${orgId} federal_register_ingest: ${e}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      orgResult.errors.push(`org:${orgId} federal_register_ingest_fatal: ${msg}`);
      logger.error({ event: "scheduler_federal_register_ingest_failed", orgId, err }, "Federal Register ingest failed for org");
    }
  }

  // Ingest CISA Alerts signals for this org
  if (feeds.cisaAlertSignals.length > 0) {
    try {
      const result = await ingestSignalsForOrg(feeds.cisaAlertSignals, orgId);
      logger.info(
        {
          event: "scheduler_cisa_alerts_ingested",
          orgId,
          inserted: result.inserted,
          skippedDuplicate: result.skippedDuplicate,
          skippedInvalid: result.skippedInvalid,
          errors: result.errors.length
        },
        "CISA Alerts ingested for org"
      );
      for (const e of result.errors) {
        orgResult.errors.push(`org:${orgId} cisa_alerts_ingest: ${e}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      orgResult.errors.push(`org:${orgId} cisa_alerts_ingest_fatal: ${msg}`);
      logger.error({ event: "scheduler_cisa_alerts_ingest_failed", orgId, err }, "CISA Alerts ingest failed for org");
    }
  }

  // Ingest MITRE ATT&CK signals for this org
  if (feeds.mitreAttackSignals.length > 0) {
    try {
      const result = await ingestSignalsForOrg(feeds.mitreAttackSignals, orgId);
      logger.info(
        {
          event: "scheduler_mitre_attack_ingested",
          orgId,
          inserted: result.inserted,
          skippedDuplicate: result.skippedDuplicate,
          skippedInvalid: result.skippedInvalid,
          errors: result.errors.length
        },
        "MITRE ATT&CK ingested for org"
      );
      for (const e of result.errors) {
        orgResult.errors.push(`org:${orgId} mitre_attack_ingest: ${e}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      orgResult.errors.push(`org:${orgId} mitre_attack_ingest_fatal: ${msg}`);
      logger.error({ event: "scheduler_mitre_attack_ingest_failed", orgId, err }, "MITRE ATT&CK ingest failed for org");
    }
  }

  // Ingest MITRE ATLAS signals for this org
  if (feeds.mitreAtlasSignals.length > 0) {
    try {
      const result = await ingestSignalsForOrg(feeds.mitreAtlasSignals, orgId);
      logger.info(
        {
          event: "scheduler_mitre_atlas_ingested",
          orgId,
          inserted: result.inserted,
          skippedDuplicate: result.skippedDuplicate,
          skippedInvalid: result.skippedInvalid,
          errors: result.errors.length
        },
        "MITRE ATLAS ingested for org"
      );
      for (const e of result.errors) {
        orgResult.errors.push(`org:${orgId} mitre_atlas_ingest: ${e}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      orgResult.errors.push(`org:${orgId} mitre_atlas_ingest_fatal: ${msg}`);
      logger.error({ event: "scheduler_mitre_atlas_ingest_failed", orgId, err }, "MITRE ATLAS ingest failed for org");
    }
  }

  // Ingest threat intel RSS signals for this org
  if (feeds.threatIntelSignals.length > 0) {
    try {
      const result = await ingestSignalsForOrg(feeds.threatIntelSignals, orgId);
      logger.info(
        {
          event: "scheduler_threat_intel_ingested",
          orgId,
          inserted: result.inserted,
          skippedDuplicate: result.skippedDuplicate,
          skippedInvalid: result.skippedInvalid,
          errors: result.errors.length
        },
        "Threat intel RSS ingested for org"
      );
      for (const e of result.errors) {
        orgResult.errors.push(`org:${orgId} threat_intel_ingest: ${e}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      orgResult.errors.push(`org:${orgId} threat_intel_ingest_fatal: ${msg}`);
      logger.error({ event: "scheduler_threat_intel_ingest_failed", orgId, err }, "Threat intel RSS ingest failed for org");
    }
  }

  // Ingest regulatory signals for this org
  if (feeds.regulatorySignals.length > 0) {
    try {
      const result = await ingestSignalsForOrg(feeds.regulatorySignals, orgId);
      logger.info(
        {
          event: "scheduler_regulatory_ingested",
          orgId,
          inserted: result.inserted,
          skippedDuplicate: result.skippedDuplicate,
          skippedInvalid: result.skippedInvalid,
          errors: result.errors.length
        },
        "Regulatory signals ingested for org"
      );
      for (const e of result.errors) {
        orgResult.errors.push(`org:${orgId} regulatory_ingest: ${e}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      orgResult.errors.push(`org:${orgId} regulatory_ingest_fatal: ${msg}`);
      logger.error({ event: "scheduler_regulatory_ingest_failed", orgId, err }, "Regulatory ingest failed for org");
    }
  }

  // Generate brief for this org
  let briefId: string;
  try {
    const generated = await generateAndStoreBrief(orgId);
    briefId = generated.briefId;
    orgResult.enrichment = generated.enrichment;
    orgResult.briefs_generated++;
    logger.info(
      { event: "scheduler_brief_generated", orgId, briefId },
      "Brief generated and published"
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    orgResult.errors.push(`org:${orgId} generate_failed: ${msg}`);
    logger.error({ event: "scheduler_generate_failed", orgId, err }, "Brief generation failed for org");
    orgResult.orgs_skipped++;
    orgFailed = true;
    return orgResult;
  }

  // Send brief to all active subscribers for this org — Tuesday only.
  // On an off-day run the brief is generated and stored (above) but NOT
  // emailed; this is the defense-in-depth guard for manual/off-schedule runs.
  if (!isSendDay) {
    orgResult.emails_skipped_off_day++;
    logger.info(
      { event: "scheduler_brief_send_skipped_off_day", orgId, briefId, weekday: new Date().getUTCDay() },
      "Brief generated but email send skipped — not the weekly send day (Tuesday UTC), no Intelligence Brief email"
    );
    if (!orgFailed) {
      orgResult.orgs_processed++;
    }
    return orgResult;
  }

  try {
    const sendResult = await sendBrief(briefId, orgId);
    orgResult.emails_sent += sendResult.sent;
    orgResult.emails_failed += sendResult.failed;
    if (sendResult.skipped) {
      // Zero active recipients: the brief above is generated + published and
      // stays current in-platform — only the email leg is skipped. Recorded
      // so the delivery-health report can surface uncovered orgs weekly.
      orgResult.emails_skipped_no_recipients++;
      orgResult.orgs_without_recipients.push(orgId);
      logger.info(
        {
          event: "scheduler_brief_send_skipped_no_recipients",
          orgId,
          briefId,
          reason: sendResult.message ?? "no_active_subscribers"
        },
        "Brief generated and published; email skipped — org has no active recipients (delivery-health condition, not a generation gate)"
      );
    }
    logger.info(
      {
        event: "scheduler_brief_sent",
        orgId,
        briefId,
        sent: sendResult.sent,
        failed: sendResult.failed,
        skipped: sendResult.skipped,
        already_sent: sendResult.already_sent
      },
      "Brief send completed for org"
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    orgResult.errors.push(`org:${orgId} send_failed: ${msg}`);
    logger.error({ event: "scheduler_send_failed", orgId, briefId, err }, "Brief send failed for org");
  }

  if (!orgFailed) {
    orgResult.orgs_processed++;
  }

  return orgResult;
}


// ---------------------------------------------------------------------------
// runScheduler — exported entry point
// ---------------------------------------------------------------------------

/**
 * Run the full weekly Intelligence Brief pipeline for every active
 * organization.
 *
 * Called by:
 *   - schedulerRunner.ts (node-cron, Tuesday 07:00 UTC — "0 7 * * 2")
 *   - briefCatchup.ts (boot-time recovery of a missed Tuesday send, DARK)
 *   - POST /api/admin/briefs/run-scheduler (manual trigger for testing)
 *
 * @returns  Run summary with per-source signal counts, org counts, email counts.
 */
export async function runScheduler(): Promise<SchedulerRunSummary> {
  // Measure the whole pass, including the early-return paths. The accumulator
  // is closed in every exit — a failed run's partial spend is still real money
  // and must be reported, not dropped.
  beginLlmRunAccumulation();
  // Still opened, though this process has no verdict-cache producer — see
  // assertNoInProcessVerdictCache(). An accumulation that stays empty is the
  // evidence for the marker; one that does not is a topology change that must
  // surface loudly rather than silently start filling a field documented as
  // never measured here.
  beginVerdictCacheAccumulation();
  try {
    const summary = await runSchedulerPass();
    summary.llm = endLlmRunAccumulation();
    assertNoInProcessVerdictCache(endVerdictCacheAccumulation());
    summary.verdict_cache = VERDICT_CACHE_OUT_OF_PROCESS;
    return summary;
  } catch (err) {
    endLlmRunAccumulation();
    endVerdictCacheAccumulation();
    throw err;
  }
}

/**
 * The marker on `verdict_cache` is a claim about process topology, not a
 * preference. If a verdict-cache producer is ever added to this process the
 * claim silently becomes false — so check it instead of trusting it. Warn-only:
 * telemetry must never be able to fail a Brief run.
 */
function assertNoInProcessVerdictCache(observed: VerdictCacheTotals): void {
  if (observed.lookups === 0 && observed.retry_exhausted === 0) return;
  logger.warn(
    {
      event: "scheduler_unexpected_in_process_verdict_cache",
      lookups: observed.lookups,
      retry_exhausted: observed.retry_exhausted
    },
    "Verdict-cache activity observed in the scheduler process — SchedulerRunSummary.verdict_cache is documented as out-of-process and is now understating this run"
  );
}

async function runSchedulerPass(): Promise<SchedulerRunSummary> {
  const summary: SchedulerRunSummary = {
    llm: emptyLlmRunTotals(),
    verdict_cache: VERDICT_CACHE_OUT_OF_PROCESS,
    org_concurrency: { limit: ORG_CONCURRENCY, peak_in_flight: 0 },
    orgs_task_fatal: 0,
    // Dormant: no code path increments these. See the type declaration.
    orgs_deadline_exceeded: 0,
    orgs_deadline_exceeded_ids: [],
    active_orgs: 0,
    orgs_processed: 0,
    orgs_skipped: 0,
    orgs_skipped_already_current: 0,
    signals_fetched: {
      cisa_kev: 0,
      nvd: 0,
      sec_edgar: 0,
      federal_register: 0,
      cisa_alerts: 0,
      mitre_attack: 0,
      mitre_atlas: 0,
      threat_intel_rss: 0,
      regulatory: 0
    },
    briefs_generated: 0,
    emails_sent: 0,
    emails_failed: 0,
    emails_skipped_off_day: 0,
    emails_skipped_no_recipients: 0,
    orgs_without_recipients: [],
    errors: []
  };

  // Email delivery is restricted to the weekly send day (Tuesday UTC). The
  // cron only fires Tuesday, but this in-code gate also covers manual runs
  // (POST /api/admin/briefs/run-scheduler) and any future cron change.
  // Briefs are still generated on an off-day run; only the send is skipped.
  const isSendDay = isBriefSendDay(new Date());

  logger.info({ event: "scheduler_run_start", isSendDay }, "Brief scheduler run started");

  // ── Step 1: Enumerate active organizations (the generation population) ──
  // Generation eligibility comes from the organization's active status alone
  // (ADR-0007). Recipient resolution happens later, inside sendBrief().

  let orgIds: string[];

  try {
    orgIds = await listBriefEligibleOrgIds();
    summary.active_orgs = orgIds.length;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    summary.errors.push(`orgs_query_failed: ${msg}`);
    logger.error({ event: "scheduler_orgs_query_failed", err }, "Failed to query active orgs");
    await maybeAlertBriefDelivery(summary, isSendDay);
    return summary;
  }

  if (orgIds.length === 0) {
    logger.info({ event: "scheduler_no_active_orgs" }, "No active organizations — nothing to do");
    await maybeAlertBriefDelivery(summary, isSendDay);
    return summary;
  }

  logger.info({ event: "scheduler_orgs_found", count: orgIds.length }, "Active organizations found");

  // ── Step 1b: Idempotency skip set for the current weekly window ─────────
  // Orgs that already published this week's edition are skipped entirely
  // (ingest + generate + send), so a rerun after an interrupted run — the
  // Tuesday-deploy failure mode — reconciles only the missing tail instead of
  // regenerating (and re-emailing) completed orgs. FAILS OPEN: if this query
  // errors, the skip set is empty and the run behaves exactly as before the
  // idempotency change — a detection failure must never block the weekly
  // edition. (briefEmailSender's idempotency still prevents double delivery
  // in that degraded case.)
  const weekStart = currentBriefWeekStart(new Date());
  let orgsWithCurrentBrief: Set<string>;
  try {
    orgsWithCurrentBrief = await listOrgsWithCurrentBrief(weekStart);
  } catch (err) {
    orgsWithCurrentBrief = new Set();
    logger.warn(
      { event: "scheduler_current_brief_query_failed", weekStart: weekStart.toISOString(), err },
      "Failed to load the current-week brief skip set — proceeding without idempotency skips (fail-open)"
    );
  }

  // ── Step 2: Fetch signal feeds once (global, shared across all orgs) ────

  let cisaKevSignals: CyberSignalIngestInput[] = [];
  let nvdSignals: CyberSignalIngestInput[] = [];
  let secEdgarSignals: CyberSignalIngestInput[] = [];
  let federalRegisterSignals: CyberSignalIngestInput[] = [];

  try {
    const { signals, total, fromCache } = await fetchCisaKevSignals();
    cisaKevSignals = signals;
    summary.signals_fetched.cisa_kev = total;
    await recordFeedSuccess("cisa_kev", total);
    if (fromCache) {
      // The 15-min kevPoller shares CISA_KEV_ETAG_KEY, so the weekly run
      // normally lands on a 304: zero rows here is the HEALTHY case, not a
      // dead feed — the brief window reads the poller's global rows instead.
      logger.info(
        { event: "scheduler_cisa_kev_not_modified" },
        "CISA KEV catalog unchanged (ETag 304) — weekly ingest skipped; brief window reads the 15-min poller's global rows"
      );
    } else {
      logger.info(
        { event: "scheduler_cisa_kev_fetched", total, mapped: signals.length },
        "CISA KEV feed fetched"
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    summary.errors.push(`cisa_kev_fetch_failed: ${msg}`);
    await recordFeedFailure("cisa_kev", msg);
    logger.error({ event: "scheduler_cisa_kev_failed", err }, "CISA KEV fetch failed — continuing with NVD only");
  }

  try {
    const { signals, total, pages } = await fetchNvdSignals(WINDOW_DAYS);
    nvdSignals = signals;
    summary.signals_fetched.nvd = total;
    await recordFeedSuccess("nvd", total);
    logger.info(
      { event: "scheduler_nvd_fetched", total, mapped: signals.length, pages },
      "NVD feed fetched"
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    summary.errors.push(`nvd_fetch_failed: ${msg}`);
    await recordFeedFailure("nvd", msg);
    logger.error({ event: "scheduler_nvd_failed", err }, "NVD fetch failed — continuing without NVD signals");
  }

  try {
    const { signals, total, pages } = await fetchSecEdgarSignals(WINDOW_DAYS);
    secEdgarSignals = signals;
    summary.signals_fetched.sec_edgar = total;
    await recordFeedSuccess("sec_edgar", total);
    logger.info(
      { event: "scheduler_sec_edgar_fetched", total, mapped: signals.length, pages },
      "SEC EDGAR 8-K Item 1.05 feed fetched"
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    summary.errors.push(`sec_edgar_fetch_failed: ${msg}`);
    await recordFeedFailure("sec_edgar", msg);
    logger.error({ event: "scheduler_sec_edgar_failed", err }, "SEC EDGAR fetch failed — continuing without EDGAR signals");
  }

  try {
    const { signals, total, pages } = await fetchFederalRegisterSignals(WINDOW_DAYS);
    federalRegisterSignals = signals;
    summary.signals_fetched.federal_register = total;
    await recordFeedSuccess("federal_register", total);
    logger.info(
      { event: "scheduler_federal_register_fetched", total, mapped: signals.length, pages },
      "Federal Register feed fetched"
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    summary.errors.push(`federal_register_fetch_failed: ${msg}`);
    await recordFeedFailure("federal_register", msg);
    logger.error({ event: "scheduler_federal_register_failed", err }, "Federal Register fetch failed — continuing without FR signals");
  }

  let cisaAlertSignals: CyberSignalIngestInput[] = [];

  try {
    const { signals, total } = await fetchCisaAlerts();
    cisaAlertSignals = signals;
    summary.signals_fetched.cisa_alerts = total;
    await recordFeedSuccess("cisa_alerts", total);
    logger.info(
      { event: "scheduler_cisa_alerts_fetched", total, mapped: signals.length },
      "CISA Alerts feed fetched"
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    summary.errors.push(`cisa_alerts_fetch_failed: ${msg}`);
    await recordFeedFailure("cisa_alerts", msg);
    logger.error({ event: "scheduler_cisa_alerts_failed", err }, "CISA Alerts fetch failed — continuing");
  }

  // MITRE ATT&CK — Tier-1 STIX bundle of techniques + threat groups.
  // Adapter sends If-None-Match against a Redis-cached ETag; on 304 the
  // signals array is empty and fromCache is true. Daily cron is fine
  // because most days hit the cache (PR #35).
  let mitreAttackSignals: CyberSignalIngestInput[] = [];

  try {
    const { signals, total, fromCache } = await fetchMitreAttackSignals();
    mitreAttackSignals = signals;
    summary.signals_fetched.mitre_attack = signals.length;
    await recordFeedSuccess("mitre_attack", signals.length);
    logger.info(
      { event: "scheduler_mitre_attack_fetched", total, mapped: signals.length, fromCache },
      fromCache
        ? "MITRE ATT&CK feed cache hit (304) — skipping parse"
        : "MITRE ATT&CK feed fetched"
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    summary.errors.push(`mitre_attack_fetch_failed: ${msg}`);
    await recordFeedFailure("mitre_attack", msg);
    logger.error({ event: "scheduler_mitre_attack_failed", err }, "MITRE ATT&CK fetch failed — continuing");
  }

  // MITRE ATLAS — Tier-1 STIX bundle of AI-system attack techniques.
  // Same conditional-GET semantics as ATT&CK.
  let mitreAtlasSignals: CyberSignalIngestInput[] = [];

  try {
    const { signals, total, fromCache } = await fetchMitreAtlasSignals();
    mitreAtlasSignals = signals;
    summary.signals_fetched.mitre_atlas = signals.length;
    await recordFeedSuccess("mitre_atlas", signals.length);
    logger.info(
      { event: "scheduler_mitre_atlas_fetched", total, mapped: signals.length, fromCache },
      fromCache
        ? "MITRE ATLAS feed cache hit (304) — skipping parse"
        : "MITRE ATLAS feed fetched"
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    summary.errors.push(`mitre_atlas_fetch_failed: ${msg}`);
    await recordFeedFailure("mitre_atlas", msg);
    logger.error({ event: "scheduler_mitre_atlas_failed", err }, "MITRE ATLAS fetch failed — continuing");
  }

  let threatIntelSignals: CyberSignalIngestInput[] = [];

  try {
    const { signals, results } = await fetchAllFeeds({
      ids: [...THREAT_INTEL_FEED_IDS]
    });
    threatIntelSignals = signals;
    summary.signals_fetched.threat_intel_rss = signals.length;
    await recordFeedSuccess("threat_intel_rss", signals.length);
    // Record per-feed health (in ADDITION to the aggregate "threat_intel_rss"
    // row above): fetchAllFeeds isolates per-source failures and still returns
    // the surviving feeds' signals, so a single dead feed never throws here and
    // the aggregate row records success. Without per-feed recording, that
    // individual feed would rot silently — the exact failure mode feed_health
    // exists to catch. Each registry feed id is its own feed_health source key.
    for (const [src, r] of Object.entries(results)) {
      if (r.error) {
        summary.errors.push(`threat_intel_rss[${src}]: ${r.error}`);
        await recordFeedFailure(src, r.error);
        logger.warn({ event: "scheduler_threat_rss_source_failed", src, error: r.error }, "Threat intel RSS source failed");
      } else {
        await recordFeedSuccess(src, r.mapped);
        logger.info({ event: "scheduler_threat_rss_source_fetched", src, total: r.total, mapped: r.mapped }, "Threat intel RSS source fetched");
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    summary.errors.push(`threat_intel_rss_fetch_failed: ${msg}`);
    await recordFeedFailure("threat_intel_rss", msg);
    logger.error({ event: "scheduler_threat_rss_failed", err }, "Threat intel RSS fetch failed — continuing");
  }

  let regulatorySignals: CyberSignalIngestInput[] = [];

  try {
    const { signals, results } = await fetchAllFeeds({
      ids: [...REGULATORY_FEED_IDS]
    });
    regulatorySignals = signals;
    summary.signals_fetched.regulatory = signals.length;
    await recordFeedSuccess("regulatory", signals.length);
    // Record per-feed health (in ADDITION to the aggregate "regulatory" row):
    // see the threat_intel_rss loop above — a single dead registry feed (e.g.
    // ftc_news) must accrue its own consecutive_failures so feed_source_down
    // fires for it, instead of being masked by the aggregate's success.
    for (const [src, r] of Object.entries(results)) {
      if (r.error) {
        summary.errors.push(`regulatory[${src}]: ${r.error}`);
        await recordFeedFailure(src, r.error);
        logger.warn({ event: "scheduler_regulatory_source_failed", src, error: r.error }, "Regulatory feed source failed");
      } else {
        await recordFeedSuccess(src, r.mapped);
        logger.info({ event: "scheduler_regulatory_source_fetched", src, total: r.total, mapped: r.mapped }, "Regulatory feed source fetched");
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    summary.errors.push(`regulatory_fetch_failed: ${msg}`);
    await recordFeedFailure("regulatory", msg);
    logger.error({ event: "scheduler_regulatory_failed", err }, "Regulatory feed fetch failed — continuing");
  }

  // ── Step 3: Process orgs with BOUNDED CONCURRENCY ───────────────────────
  //
  // Orgs run through a fixed-size worker pool (ORG_CONCURRENCY). Each worker
  // pulls the next org the moment it finishes one, so a slow org occupies its
  // own slot and NOTHING else: the other slot keeps draining the queue. That
  // pull model — not a chunked `Promise.all` over batches — is what removes
  // head-of-line blocking within the fan-out.
  //
  // Every task returns its OWN sealed result. No task touches `summary`; the
  // merge below is the single writer, and it walks results in INPUT order, so
  // counters, `errors`, and `orgs_without_recipients` come out byte-identical
  // to what the sequential loop produced for the same inputs. Concurrency
  // therefore changes wall-clock, not the summary.

  const orgsToProcess: string[] = [];
  for (const orgId of orgIds) {
    if (orgsWithCurrentBrief.has(orgId)) {
      summary.orgs_skipped_already_current++;
      logger.info(
        { event: "scheduler_org_skipped_already_current", orgId, weekStart: weekStart.toISOString() },
        "Org already has this week's published brief — skipping (idempotent rerun)"
      );
      continue;
    }
    orgsToProcess.push(orgId);
  }

  // The feeds were fetched ONCE above and are read-only from here on: every
  // org ingests the same arrays. Passing them as one frozen bundle keeps the
  // per-org task a pure function of (orgId, feeds, isSendDay).
  const feeds: FetchedFeeds = Object.freeze({
    cisaKevSignals,
    nvdSignals,
    secEdgarSignals,
    federalRegisterSignals,
    cisaAlertSignals,
    mitreAttackSignals,
    mitreAtlasSignals,
    threatIntelSignals,
    regulatorySignals
  });

  // In-flight gauge. Incremented/decremented around the awaited task body, so
  // `peak` is the true simultaneous-task high-water mark rather than a claim
  // derived from the limit constant. Reported in the summary so a staging run
  // can be checked against the intended bound instead of trusted.
  let inFlight = 0;
  let peakInFlight = 0;

  summary.org_concurrency.limit = ORG_CONCURRENCY;

  logger.info(
    {
      event: "scheduler_org_fanout_start",
      pending_orgs: orgsToProcess.length,
      concurrency_limit: ORG_CONCURRENCY
    },
    "Processing orgs with bounded concurrency"
  );

  const orgResults = await mapWithConcurrency(
    orgsToProcess,
    ORG_CONCURRENCY,
    async (orgId): Promise<OrgRunResult> => {
      inFlight++;
      if (inFlight > peakInFlight) peakInFlight = inFlight;
      try {
        return await processOrg(orgId, feeds, isSendDay);
      } finally {
        inFlight--;
      }
    }
  );

  summary.org_concurrency.peak_in_flight = peakInFlight;

  // ── Step 3b: Merge the per-org results (single writer, input order) ──────
  mergeOrgResults(summary, orgResults);


  logger.info(
    {
      event: "scheduler_run_complete",
      active_orgs: summary.active_orgs,
      orgs_processed: summary.orgs_processed,
      orgs_skipped: summary.orgs_skipped,
      orgs_skipped_already_current: summary.orgs_skipped_already_current,
      briefs_generated: summary.briefs_generated,
      emails_sent: summary.emails_sent,
      emails_failed: summary.emails_failed,
      emails_skipped_off_day: summary.emails_skipped_off_day,
      emails_skipped_no_recipients: summary.emails_skipped_no_recipients,
      orgs_without_recipients: summary.orgs_without_recipients,
      orgs_task_fatal: summary.orgs_task_fatal,
      orgs_deadline_exceeded: summary.orgs_deadline_exceeded,
      error_count: summary.errors.length,
      // Measured, and available here — its absence from this line is what sent
      // the #826 analysis off to reconstruct the bound from scheduler_org_start
      // / _complete interval pairs when it was already in the log.
      org_concurrency: summary.org_concurrency,
      // Named rather than omitted: silence on this line reads as "nothing to
      // report". The LLM totals are deliberately NOT here — they are not closed
      // until runScheduler() returns, so this line could only ever print zeros
      // for them. scheduler_cron_complete carries the real figures.
      verdict_cache: VERDICT_CACHE_OUT_OF_PROCESS,
      llm: notMeasuredInThisProcess(
        "securelogic-engine",
        "scheduler_cron_complete",
        "LLM run accumulation closes in runScheduler(), one frame above this emit."
      )
    },
    "Brief scheduler run completed"
  );

  // Turn a silent zero-delivery run into an operator alert (best-effort, no-op
  // off-day and when no webhook is configured).
  await maybeAlertBriefDelivery(summary, isSendDay);

  return summary;
}
