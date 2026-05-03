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

import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { fetchCisaKevSignals } from "./cisaKevAdapter.js";
import { fetchNvdSignals } from "./nvdAdapter.js";
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
  type CyberSignalForBrief,
  type BriefItem
} from "./intelligenceBriefGenerator.js";
import { runSynthesisSafely } from "./briefSynthesizer.js";
import { sendBrief } from "./briefEmailSender.js";

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
    cisa_alerts: number;
    mitre_attack: number;
    mitre_atlas: number;
    threat_intel_rss: number;
    regulatory: number;
  };
  briefs_generated: number;
  emails_sent: number;
  emails_failed: number;
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

  for (const rawSignal of signals) {
    const validated = validateCyberSignalIngest(rawSignal);
    if ("error" in validated) {
      skippedInvalid++;
      continue;
    }

    const normalized = normalizeSignal(validated.input);

    const client = await pg.connect();
    try {
      await client.query("BEGIN");

      const insertResult = await client.query(
        `INSERT INTO cyber_signals (
           organization_id, source, signal_type, severity, raw_payload,
           normalized_summary, affected_vendor, affected_cve,
           dedup_hash, ingestion_timestamp, processed
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), FALSE)
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

      const signalRecord: CyberSignalRecord = {
        id: signal.id,
        organization_id: orgId,
        source: signal.source,
        signal_type: signal.signal_type,
        severity: signal.severity,
        normalized_summary: signal.normalized_summary,
        affected_vendor: signal.affected_vendor,
        affected_cve: signal.affected_cve
      };

      await processSignal(signalRecord);
      inserted++;
    } catch (err) {
      try { await client.query("ROLLBACK"); } catch { /* ignore */ }
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(msg);
    } finally {
      client.release();
    }
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

  // ── Phase 1: Insert brief + fetch signals (short transaction, no external I/O) ──
  //
  // We commit the brief row in 'generating' state and release the DB connection
  // before calling enrichBriefItems(). Holding a connection open across multiple
  // Claude API calls wastes pool resources and risks connection timeouts.

  let briefId: string;
  let base: ReturnType<typeof generateBrief>;

  const phase1Client = await pg.connect();
  try {
    await phase1Client.query("BEGIN");

    const insertBriefResult = await phase1Client.query<{ id: string }>(
      `INSERT INTO intelligence_briefs
         (organization_id, period_start, period_end, status)
       VALUES ($1, $2, $3, 'generating')
       RETURNING id`,
      [orgId, periodStart.toISOString(), periodEnd.toISOString()]
    );
    briefId = insertBriefResult.rows[0]!.id;

    const signalsResult = await phase1Client.query<CyberSignalForBrief>(
      `SELECT id, signal_type, severity, normalized_summary,
              affected_cve, affected_vendor, source, ingestion_timestamp,
              raw_payload
       FROM cyber_signals
       WHERE (organization_id = $1 OR organization_id IS NULL)
         AND ingestion_timestamp >= $2
         AND ingestion_timestamp < $3
       ORDER BY ingestion_timestamp DESC`,
      [orgId, periodStart.toISOString(), periodEnd.toISOString()]
    );

    const signals = signalsResult.rows;

    // generateBrief is pure — safe to run inside this transaction.
    // Returns the pre-enrichment shortlist (top ENRICHMENT_SHORTLIST items
    // by composite ranking key); enrichment runs on the shortlist, then
    // capByUrgencyBuckets reduces to BRIEF_MAX_ITEMS.
    base = generateBrief(signals);

    await phase1Client.query("COMMIT");
  } catch (err) {
    await phase1Client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    phase1Client.release();
  }

  // ── Phase 2: Enrich (Claude calls, no DB connection held) ───────────────────
  //
  // enrichBriefItems is designed as non-fatal (always resolves). Even if all
  // Claude calls fail it returns the unenriched base items rather than throwing.
  // We still wrap this in try/catch: if it unexpectedly throws we mark the brief
  // as failed before re-throwing so it never stays stuck in 'generating'.

  let enrichedItems: BriefItem[];
  try {
    enrichedItems = await enrichBriefItems(base.shortlist);
  } catch (enrichErr) {
    await pg
      .query(
        `UPDATE intelligence_briefs
         SET status = 'failed', updated_at = NOW()
         WHERE id = $1`,
        [briefId]
      )
      .catch(() => {});
    throw enrichErr;
  }

  // Apply the urgency-bucket cap. After this, cappedItems.length is bounded
  // by BRIEF_MAX_ITEMS — this is what gets persisted and synthesized.
  const { items: cappedItems, counts: urgencyCounts } =
    capByUrgencyBuckets(enrichedItems);

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
  const synthesis = await runSynthesisSafely(cappedItems);

  const finalized = finalizeBrief(
    cappedItems,
    periodStart.toISOString(),
    periodEnd.toISOString(),
    base.signal_count
  );
  const contentJsonWithSynthesis = { ...finalized.content_json, synthesis };

  // ── Phase 3: Insert items + publish (own transaction, explicit fail-safe) ───
  //
  // The publish UPDATE is the last step. If it fails the brief must not remain
  // stuck in 'generating' — the catch block marks it 'failed' directly by ID
  // so the scheduler can skip sendBrief() for this org.

  const phase3Client = await pg.connect();
  try {
    await phase3Client.query("BEGIN");

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

      await phase3Client.query(
        `INSERT INTO intelligence_brief_items
           (organization_id, brief_id, cyber_signal_id, category, relevance,
            title, summary, affected_cve, affected_vendor, source_slug,
            signal_type, severity, sort_order,
            why_it_matters, recommended_actions, analyst_notes,
            urgency)
         VALUES ${itemPlaceholders.join(", ")}`,
        itemValues
      );
    }

    // Explicitly set status to 'published' before this function returns so
    // sendBrief() in runScheduler() sees a fully committed 'published' row.
    await phase3Client.query(
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

    await phase3Client.query("COMMIT");

    return briefId;
  } catch (err) {
    await phase3Client.query("ROLLBACK").catch(() => {});
    // Mark the brief as failed by ID — prevents it staying stuck in 'generating'.
    // runScheduler() will catch this throw and skip sendBrief() for this org.
    await pg
      .query(
        `UPDATE intelligence_briefs
         SET status = 'failed', updated_at = NOW()
         WHERE id = $1`,
        [briefId]
      )
      .catch(() => {});
    throw err;
  } finally {
    phase3Client.release();
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
      cisa_alerts: 0,
      mitre_attack: 0,
      mitre_atlas: 0,
      threat_intel_rss: 0,
      regulatory: 0
    },
    briefs_generated: 0,
    emails_sent: 0,
    emails_failed: 0,
    errors: []
  };

  logger.info({ event: "scheduler_run_start" }, "Brief scheduler run started");

  // ── Step 1: Find all orgs with active subscribers ───────────────────────

  let orgIds: string[];

  try {
    const orgsResult = await pg.query<{ organization_id: string }>(
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

  try {
    const { signals, total } = await fetchCisaKevSignals();
    cisaKevSignals = signals;
    summary.signals_fetched.cisa_kev = total;
    logger.info(
      { event: "scheduler_cisa_kev_fetched", total, mapped: signals.length },
      "CISA KEV feed fetched"
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    summary.errors.push(`cisa_kev_fetch_failed: ${msg}`);
    logger.error({ event: "scheduler_cisa_kev_failed", err }, "CISA KEV fetch failed — continuing with NVD only");
  }

  try {
    const { signals, total, pages } = await fetchNvdSignals(WINDOW_DAYS);
    nvdSignals = signals;
    summary.signals_fetched.nvd = total;
    logger.info(
      { event: "scheduler_nvd_fetched", total, mapped: signals.length, pages },
      "NVD feed fetched"
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    summary.errors.push(`nvd_fetch_failed: ${msg}`);
    logger.error({ event: "scheduler_nvd_failed", err }, "NVD fetch failed — continuing without NVD signals");
  }

  let cisaAlertSignals: CyberSignalIngestInput[] = [];

  try {
    const { signals, total } = await fetchCisaAlerts();
    cisaAlertSignals = signals;
    summary.signals_fetched.cisa_alerts = total;
    logger.info(
      { event: "scheduler_cisa_alerts_fetched", total, mapped: signals.length },
      "CISA Alerts feed fetched"
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    summary.errors.push(`cisa_alerts_fetch_failed: ${msg}`);
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
    logger.info(
      { event: "scheduler_mitre_attack_fetched", total, mapped: signals.length, fromCache },
      fromCache
        ? "MITRE ATT&CK feed cache hit (304) — skipping parse"
        : "MITRE ATT&CK feed fetched"
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    summary.errors.push(`mitre_attack_fetch_failed: ${msg}`);
    logger.error({ event: "scheduler_mitre_attack_failed", err }, "MITRE ATT&CK fetch failed — continuing");
  }

  // MITRE ATLAS — Tier-1 STIX bundle of AI-system attack techniques.
  // Same conditional-GET semantics as ATT&CK.
  let mitreAtlasSignals: CyberSignalIngestInput[] = [];

  try {
    const { signals, total, fromCache } = await fetchMitreAtlasSignals();
    mitreAtlasSignals = signals;
    summary.signals_fetched.mitre_atlas = signals.length;
    logger.info(
      { event: "scheduler_mitre_atlas_fetched", total, mapped: signals.length, fromCache },
      fromCache
        ? "MITRE ATLAS feed cache hit (304) — skipping parse"
        : "MITRE ATLAS feed fetched"
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    summary.errors.push(`mitre_atlas_fetch_failed: ${msg}`);
    logger.error({ event: "scheduler_mitre_atlas_failed", err }, "MITRE ATLAS fetch failed — continuing");
  }

  let threatIntelSignals: CyberSignalIngestInput[] = [];

  try {
    const { signals, results } = await fetchAllFeeds({
      ids: [...THREAT_INTEL_FEED_IDS]
    });
    threatIntelSignals = signals;
    summary.signals_fetched.threat_intel_rss = signals.length;
    // Log per-source results
    for (const [src, r] of Object.entries(results)) {
      if (r.error) {
        summary.errors.push(`threat_intel_rss[${src}]: ${r.error}`);
        logger.warn({ event: "scheduler_threat_rss_source_failed", src, error: r.error }, "Threat intel RSS source failed");
      } else {
        logger.info({ event: "scheduler_threat_rss_source_fetched", src, total: r.total, mapped: r.mapped }, "Threat intel RSS source fetched");
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    summary.errors.push(`threat_intel_rss_fetch_failed: ${msg}`);
    logger.error({ event: "scheduler_threat_rss_failed", err }, "Threat intel RSS fetch failed — continuing");
  }

  let regulatorySignals: CyberSignalIngestInput[] = [];

  try {
    const { signals, results } = await fetchAllFeeds({
      ids: [...REGULATORY_FEED_IDS]
    });
    regulatorySignals = signals;
    summary.signals_fetched.regulatory = signals.length;
    for (const [src, r] of Object.entries(results)) {
      if (r.error) {
        summary.errors.push(`regulatory[${src}]: ${r.error}`);
        logger.warn({ event: "scheduler_regulatory_source_failed", src, error: r.error }, "Regulatory feed source failed");
      } else {
        logger.info({ event: "scheduler_regulatory_source_fetched", src, total: r.total, mapped: r.mapped }, "Regulatory feed source fetched");
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    summary.errors.push(`regulatory_fetch_failed: ${msg}`);
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

    // Send brief to all active subscribers for this org
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
      error_count: summary.errors.length
    },
    "Brief scheduler run completed"
  );

  return summary;
}
