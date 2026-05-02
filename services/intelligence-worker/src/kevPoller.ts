/**
 * kevPoller.ts — Fast-cadence CISA KEV polling loop.
 *
 * KEV is the canary feed for active exploitation. The daily Intelligence
 * Brief scheduler already ingests KEV per-org at 7AM UTC, but a daily
 * cadence is too slow for the time-to-exploit reality CISA documents.
 *
 * This worker poll runs every 15 minutes alongside the existing hourly
 * pipeline. It is independent: a KEV fetch failure must not affect the
 * hourly worker, and vice versa.
 *
 * CACHE-AWARE
 * -----------
 * fetchCisaKevSignals() (PR #38) sends If-None-Match against a Redis-cached
 * ETag. On 304 it returns `{ signals: [], fromCache: true }` without parsing
 * a body — sub-second steady-state cost. On 200 the new ETag is captured
 * and the catalog is mapped.
 *
 * GLOBAL INGEST
 * -------------
 * Inserts are global rows (organization_id = NULL) using the partial unique
 * index `(dedup_hash) WHERE organization_id IS NULL`. Mirrors the pattern
 * in runPipeline.ts → bridgeSignalsToCyberSignals(). Per-org briefs read
 * the global rows via `organization_id = $orgId OR organization_id IS NULL`.
 *
 * normalizeSignal() (canonical normalizer) is reused so dedup_hash and
 * normalized_summary derivation match every other ingest path that handles
 * KEV (the daily scheduler, the manual fetch route, the per-org pipeline).
 *
 * ERROR ISOLATION
 * ---------------
 * The whole poll is wrapped in try/catch. Any failure is logged at warn
 * level under `kev_poll_failed` and swallowed — the setInterval loop in
 * scheduler.ts keeps ticking, and the hourly runWorker loop is unaffected.
 */

import { fetchCisaKevSignals } from "../../../src/api/lib/cisaKevAdapter.js";
import { normalizeSignal } from "../../../src/api/lib/cyberSignalNormalizer.js";
import { pg } from "../../../src/api/infra/postgres.js";
import { logger } from "../../../src/api/infra/logger.js";

/**
 * Run a single KEV poll cycle.
 *
 * - Fetches via the cache-aware adapter.
 * - On fromCache=true, logs at debug level and returns without touching the DB.
 * - On fromCache=false, normalizes each signal and INSERTs as a global row
 *   (organization_id = NULL) with ON CONFLICT DO NOTHING on the partial
 *   unique index.
 *
 * Never throws. All failures land in the kev_poll_failed log line.
 */
export async function runKevPoll(): Promise<void> {
  const start = Date.now();

  try {
    const { signals, total, fromCache } = await fetchCisaKevSignals();

    if (fromCache) {
      logger.debug(
        {
          event: "kev_poll_completed",
          inserted: 0,
          total: 0,
          fromCache: true,
          durationMs: Date.now() - start
        },
        "KEV poll cache hit (304) — skipping ingest"
      );
      return;
    }

    let inserted = 0;
    let skipped = 0;

    for (const signal of signals) {
      const normalized = normalizeSignal(signal);

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
             ingestion_timestamp,
             processed
           ) VALUES (
             NULL, $1, $2, $3,
             $4::jsonb, $5,
             $6, $7,
             $8, NOW(), FALSE
           )
           ON CONFLICT (dedup_hash) WHERE organization_id IS NULL DO NOTHING
           RETURNING id`,
          [
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

        if (result.rows.length > 0) {
          inserted++;
        } else {
          skipped++;
        }
      } catch (err) {
        logger.warn(
          {
            event: "kev_poll_insert_failed",
            affected_cve: normalized.affected_cve,
            err
          },
          "KEV poll: single-row insert failed — continuing with batch"
        );
      }
    }

    logger.info(
      {
        event: "kev_poll_completed",
        inserted,
        skipped,
        total,
        fromCache: false,
        durationMs: Date.now() - start
      },
      "KEV poll completed"
    );
  } catch (err) {
    logger.warn(
      {
        event: "kev_poll_failed",
        err,
        durationMs: Date.now() - start
      },
      "KEV poll failed — error swallowed, next tick will retry"
    );
  }
}
