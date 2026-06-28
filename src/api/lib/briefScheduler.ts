/**
 * briefScheduler.ts — Daily Intelligence Brief pipeline runner.
 *
 * Processes every organization that has at least one active Intelligence Brief
 * subscriber, running the complete pipeline for each:
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
 *
 * Orgs are processed sequentially to avoid DB and external API contention.
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
import {
  runSynthesisSafely,
  fetchPriorBriefContext
} from "./briefSynthesizer.js";
import { sendBrief } from "./briefEmailSender.js";
import { isBriefSendDay } from "./briefSendWindow.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Look-back window for NVD and brief generation. */
const WINDOW_DAYS = 7;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SchedulerRunSummary = {
  orgs_processed: number;
  orgs_skipped: number;
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
  errors: string[];
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
             dedup_hash, ingestion_timestamp, processed
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), FALSE)
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
            normalized.dedup_hash
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

async function generateAndStoreBrief(orgId: string): Promise<string> {
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

      const signalsResult = await client.query<CyberSignalForBrief>(
        `SELECT id, signal_type, severity, normalized_summary,
                affected_cve, affected_vendor, source, ingestion_timestamp,
                cluster_key, raw_payload
         FROM cyber_signals
         WHERE (organization_id = $1 OR organization_id IS NULL)
           AND ingestion_timestamp >= $2
           AND ingestion_timestamp < $3
         ORDER BY ingestion_timestamp DESC`,
        [orgId, periodStart.toISOString(), periodEnd.toISOString()]
      );

      // generateBrief is pure — safe to run inside this transaction.
      // Returns the pre-enrichment shortlist (top ENRICHMENT_SHORTLIST items
      // by composite ranking key); enrichment runs on the shortlist, then
      // capByUrgencyBuckets reduces to BRIEF_MAX_ITEMS.
      const newBase = generateBrief(signalsResult.rows, {
        priorityOf,
        clusteringEnabled: signalClusteringEnabled()
      });

      // D2: per-signal source + cluster_key, so the persist phase can denormalise
      // them onto provenance edges (incl. corroborating signals not on the item).
      const newSignalMeta = new Map<string, { source: string; cluster_key: string | null }>(
        signalsResult.rows.map((s) => [s.id, { source: s.source, cluster_key: s.cluster_key ?? null }])
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

  // Brief-level synthesis — one Claude call producing a 12-word headline.
  // Non-fatal: failure resolves to null and the brief publishes without one.
  // Run on cappedItems so headline/teaser describe what's actually in the
  // brief, not what was dropped.
  //
  // Prior-brief context drives the exec summary's week-on-week calibration
  // sentence. Returns null on first-brief-ever cases; the prompt drops to
  // a 3-sentence summary in that case.
  // fetchPriorBriefContext reads intelligence_briefs; run it in a read-only
  // tenant scope so the SELECT is RLS-visible after the app_request flip.
  const priorContext = await withTenant(orgId, () =>
    fetchPriorBriefContext(orgId, briefId)
  );
  const synthesis = await runSynthesisSafely(cappedItems, priorContext, orgId);

  const finalized = finalizeBrief(
    cappedItems,
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

        if (finalized.items.length > 0) {
          const itemValues: unknown[] = [];
          const itemPlaceholders: string[] = [];

          finalized.items.forEach((item: BriefItem, idx: number) => {
            const b = idx * 17;
            itemPlaceholders.push(
              `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, ` +
              `$${b + 6}, $${b + 7}, $${b + 8}, $${b + 9}, $${b + 10}, ` +
              `$${b + 11}, $${b + 12}, $${b + 13}, $${b + 14}, $${b + 15}, ` +
              `$${b + 16}, $${b + 17})`
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
              item.urgency ?? null
            );
          });

          const insertedItems = await client.query<{ id: string; sort_order: number }>(
            `INSERT INTO intelligence_brief_items
               (organization_id, brief_id, cyber_signal_id, category, relevance,
                title, summary, affected_cve, affected_vendor, source_slug,
                signal_type, severity, sort_order,
                why_it_matters, recommended_actions, analyst_notes,
                urgency)
             VALUES ${itemPlaceholders.join(", ")}
             RETURNING id, sort_order`,
            itemValues
          );

          // D2 (flag-gated): write lineage edges (canonical + corroborating) for
          // each persisted item, in THIS tenant transaction so the RLS policy is
          // satisfied and the edges are atomic with the items.
          if (briefProvenanceEnabled()) {
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

    return briefId;
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
// runScheduler — exported entry point
// ---------------------------------------------------------------------------

/**
 * Run the full daily Intelligence Brief pipeline for every org with active
 * subscribers.
 *
 * Called by:
 *   - schedulerRunner.ts (node-cron, every day 7AM UTC)
 *   - POST /api/admin/briefs/run-scheduler (manual trigger for testing)
 *
 * @returns  Run summary with per-source signal counts, org counts, email counts.
 */
export async function runScheduler(): Promise<SchedulerRunSummary> {
  const summary: SchedulerRunSummary = {
    orgs_processed: 0,
    orgs_skipped: 0,
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
    errors: []
  };

  // Email delivery is restricted to the weekly send day (Tuesday UTC). The
  // cron only fires Tuesday, but this in-code gate also covers manual runs
  // (POST /api/admin/briefs/run-scheduler) and any future cron change.
  // Briefs are still generated on an off-day run; only the send is skipped.
  const isSendDay = isBriefSendDay(new Date());

  logger.info({ event: "scheduler_run_start", isSendDay }, "Brief scheduler run started");

  // ── Step 1: Find all orgs with active subscribers ───────────────────────

  let orgIds: string[];

  try {
    const orgsResult = await pgElevated.query<{ organization_id: string }>(
      `SELECT DISTINCT organization_id
       FROM intelligence_brief_subscribers
       WHERE active = TRUE`
    );
    orgIds = orgsResult.rows.map((r) => r.organization_id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    summary.errors.push(`orgs_query_failed: ${msg}`);
    logger.error({ event: "scheduler_orgs_query_failed", err }, "Failed to query active orgs");
    return summary;
  }

  if (orgIds.length === 0) {
    logger.info({ event: "scheduler_no_orgs" }, "No orgs with active subscribers — nothing to do");
    return summary;
  }

  logger.info({ event: "scheduler_orgs_found", count: orgIds.length }, "Orgs with active subscribers found");

  // ── Step 2: Fetch signal feeds once (global, shared across all orgs) ────

  let cisaKevSignals: CyberSignalIngestInput[] = [];
  let nvdSignals: CyberSignalIngestInput[] = [];
  let secEdgarSignals: CyberSignalIngestInput[] = [];
  let federalRegisterSignals: CyberSignalIngestInput[] = [];

  try {
    const { signals, total } = await fetchCisaKevSignals();
    cisaKevSignals = signals;
    summary.signals_fetched.cisa_kev = total;
    await recordFeedSuccess("cisa_kev", total);
    logger.info(
      { event: "scheduler_cisa_kev_fetched", total, mapped: signals.length },
      "CISA KEV feed fetched"
    );
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

  // ── Step 3: Process each org sequentially ───────────────────────────────

  for (const orgId of orgIds) {
    logger.info({ event: "scheduler_org_start", orgId }, "Processing org");

    let orgFailed = false;

    // Ingest CISA KEV signals for this org
    if (cisaKevSignals.length > 0) {
      try {
        const result = await ingestSignalsForOrg(cisaKevSignals, orgId);
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
          summary.errors.push(`org:${orgId} kev_ingest: ${e}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        summary.errors.push(`org:${orgId} kev_ingest_fatal: ${msg}`);
        logger.error({ event: "scheduler_kev_ingest_failed", orgId, err }, "CISA KEV ingest failed for org");
      }
    }

    // Ingest NVD signals for this org
    if (nvdSignals.length > 0) {
      try {
        const result = await ingestSignalsForOrg(nvdSignals, orgId);
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
          summary.errors.push(`org:${orgId} nvd_ingest: ${e}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        summary.errors.push(`org:${orgId} nvd_ingest_fatal: ${msg}`);
        logger.error({ event: "scheduler_nvd_ingest_failed", orgId, err }, "NVD ingest failed for org");
      }
    }

    // Ingest SEC EDGAR 8-K Item 1.05 signals for this org
    if (secEdgarSignals.length > 0) {
      try {
        const result = await ingestSignalsForOrg(secEdgarSignals, orgId);
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
          summary.errors.push(`org:${orgId} sec_edgar_ingest: ${e}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        summary.errors.push(`org:${orgId} sec_edgar_ingest_fatal: ${msg}`);
        logger.error({ event: "scheduler_sec_edgar_ingest_failed", orgId, err }, "SEC EDGAR ingest failed for org");
      }
    }

    // Ingest Federal Register regulatory signals for this org
    if (federalRegisterSignals.length > 0) {
      try {
        const result = await ingestSignalsForOrg(federalRegisterSignals, orgId);
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
          summary.errors.push(`org:${orgId} federal_register_ingest: ${e}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        summary.errors.push(`org:${orgId} federal_register_ingest_fatal: ${msg}`);
        logger.error({ event: "scheduler_federal_register_ingest_failed", orgId, err }, "Federal Register ingest failed for org");
      }
    }

    // Ingest CISA Alerts signals for this org
    if (cisaAlertSignals.length > 0) {
      try {
        const result = await ingestSignalsForOrg(cisaAlertSignals, orgId);
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
          summary.errors.push(`org:${orgId} cisa_alerts_ingest: ${e}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        summary.errors.push(`org:${orgId} cisa_alerts_ingest_fatal: ${msg}`);
        logger.error({ event: "scheduler_cisa_alerts_ingest_failed", orgId, err }, "CISA Alerts ingest failed for org");
      }
    }

    // Ingest MITRE ATT&CK signals for this org
    if (mitreAttackSignals.length > 0) {
      try {
        const result = await ingestSignalsForOrg(mitreAttackSignals, orgId);
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
          summary.errors.push(`org:${orgId} mitre_attack_ingest: ${e}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        summary.errors.push(`org:${orgId} mitre_attack_ingest_fatal: ${msg}`);
        logger.error({ event: "scheduler_mitre_attack_ingest_failed", orgId, err }, "MITRE ATT&CK ingest failed for org");
      }
    }

    // Ingest MITRE ATLAS signals for this org
    if (mitreAtlasSignals.length > 0) {
      try {
        const result = await ingestSignalsForOrg(mitreAtlasSignals, orgId);
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
          summary.errors.push(`org:${orgId} mitre_atlas_ingest: ${e}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        summary.errors.push(`org:${orgId} mitre_atlas_ingest_fatal: ${msg}`);
        logger.error({ event: "scheduler_mitre_atlas_ingest_failed", orgId, err }, "MITRE ATLAS ingest failed for org");
      }
    }

    // Ingest threat intel RSS signals for this org
    if (threatIntelSignals.length > 0) {
      try {
        const result = await ingestSignalsForOrg(threatIntelSignals, orgId);
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
          summary.errors.push(`org:${orgId} threat_intel_ingest: ${e}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        summary.errors.push(`org:${orgId} threat_intel_ingest_fatal: ${msg}`);
        logger.error({ event: "scheduler_threat_intel_ingest_failed", orgId, err }, "Threat intel RSS ingest failed for org");
      }
    }

    // Ingest regulatory signals for this org
    if (regulatorySignals.length > 0) {
      try {
        const result = await ingestSignalsForOrg(regulatorySignals, orgId);
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
          summary.errors.push(`org:${orgId} regulatory_ingest: ${e}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        summary.errors.push(`org:${orgId} regulatory_ingest_fatal: ${msg}`);
        logger.error({ event: "scheduler_regulatory_ingest_failed", orgId, err }, "Regulatory ingest failed for org");
      }
    }

    // Generate brief for this org
    let briefId: string;
    try {
      briefId = await generateAndStoreBrief(orgId);
      summary.briefs_generated++;
      logger.info(
        { event: "scheduler_brief_generated", orgId, briefId },
        "Brief generated and published"
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      summary.errors.push(`org:${orgId} generate_failed: ${msg}`);
      logger.error({ event: "scheduler_generate_failed", orgId, err }, "Brief generation failed for org");
      summary.orgs_skipped++;
      orgFailed = true;
      continue;
    }

    // Send brief to all active subscribers for this org — Tuesday only.
    // On an off-day run the brief is generated and stored (above) but NOT
    // emailed; this is the defense-in-depth guard for manual/off-schedule runs.
    if (!isSendDay) {
      summary.emails_skipped_off_day++;
      logger.info(
        { event: "scheduler_brief_send_skipped_off_day", orgId, briefId, weekday: new Date().getUTCDay() },
        "Brief generated but email send skipped — not the weekly send day (Tuesday UTC), no Intelligence Brief email"
      );
      if (!orgFailed) {
        summary.orgs_processed++;
      }
      continue;
    }

    try {
      const sendResult = await sendBrief(briefId, orgId);
      summary.emails_sent += sendResult.sent;
      summary.emails_failed += sendResult.failed;
      logger.info(
        {
          event: "scheduler_brief_sent",
          orgId,
          briefId,
          sent: sendResult.sent,
          failed: sendResult.failed,
          skipped: sendResult.skipped
        },
        "Brief send completed for org"
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      summary.errors.push(`org:${orgId} send_failed: ${msg}`);
      logger.error({ event: "scheduler_send_failed", orgId, briefId, err }, "Brief send failed for org");
    }

    if (!orgFailed) {
      summary.orgs_processed++;
    }
  }

  logger.info(
    {
      event: "scheduler_run_complete",
      orgs_processed: summary.orgs_processed,
      orgs_skipped: summary.orgs_skipped,
      briefs_generated: summary.briefs_generated,
      emails_sent: summary.emails_sent,
      emails_failed: summary.emails_failed,
      emails_skipped_off_day: summary.emails_skipped_off_day,
      error_count: summary.errors.length
    },
    "Brief scheduler run completed"
  );

  return summary;
}
