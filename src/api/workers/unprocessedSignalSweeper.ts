/**
 * unprocessedSignalSweeper.ts — recovers signals that were COMMITTED but never
 * PROCESSED.
 *
 * THE DEFECT THIS CLOSES
 * ----------------------
 * `ingestSignalsForOrg` (briefScheduler) commits inserted rows FIRST, then runs
 * `processSignal` over an in-memory list afterward — deliberately, because
 * processSignal works on a separate elevated connection and its contract is
 * "called after the row is committed". The gap: if the process dies between the
 * commit and the processing loop (a deploy SIGTERM during the multi-hour weekly
 * run — the observed 2026-08-11 failure mode), those rows stay
 * `processed = FALSE` forever. The next run's INSERT hits
 * `ON CONFLICT (organization_id, dedup_hash) DO NOTHING`, returns zero rows, and
 * therefore never re-adds them to the processing list. They are silently lost:
 * no finding, no risk flag, no posture contribution — and no error anywhere.
 * The only prior remedy was a manual, one-signal-at-a-time reprocess route.
 *
 * DESIGN (mirrors exportFilePurgeWorker's sweep shape)
 * ----------------------------------------------------
 * - Candidates: `processed = FALSE`, org-scoped, older than a grace window.
 * - **`organization_id IS NOT NULL` is mandatory, not cosmetic.** Global
 *   (NULL-org) signals are processed by the worker fan-out, and `processSignal`
 *   returns early for them WITHOUT setting `processed = TRUE` — so a sweep that
 *   included them would re-select the same rows on every tick forever.
 * - The grace window keeps the sweeper off rows the live run is about to
 *   process itself, so the two never race over the same signal.
 * - `processSignal` is idempotent with respect to findings (it skips creation
 *   when one already exists for the signal), so re-processing a row that did
 *   partially complete is safe.
 * - One signal's failure never stops the batch; the row stays unprocessed and
 *   the next sweep retries it. A permanently-failing signal will therefore be
 *   retried each tick — bounded by BATCH_SIZE and logged loudly every time,
 *   which is the intended "loud, not silent" posture.
 *
 * Ops brake: SECURELOGIC_SIGNAL_SWEEPER_DISABLED=true skips every tick.
 */

import { pgElevated } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { processSignal, type CyberSignalRecord } from "../lib/cyberSignalProcessingService.js";

const INTERVAL_MS = 60 * 60 * 1000; // hourly
const BATCH_SIZE = 50;
/**
 * How long a signal must sit unprocessed before the sweeper claims it. Long
 * enough that the ingesting run's own processing loop — which follows the
 * commit immediately — is never competing with the sweeper for the same row.
 */
const GRACE_MINUTES = 30;

export function signalSweeperDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env["SECURELOGIC_SIGNAL_SWEEPER_DISABLED"] === "true";
}

export type SignalSweepResult = {
  candidates: number;
  processed: number;
  failed: number;
};

export async function runUnprocessedSignalSweep(): Promise<SignalSweepResult> {
  if (signalSweeperDisabled()) {
    return { candidates: 0, processed: 0, failed: 0 };
  }

  const candidateResult = await pgElevated.query<CyberSignalRecord>(
    `SELECT id, organization_id, source, signal_type, severity,
            normalized_summary, affected_vendor, affected_cve
       FROM cyber_signals
      WHERE processed = FALSE
        AND organization_id IS NOT NULL
        AND ingestion_timestamp < NOW() - make_interval(mins => $1)
      ORDER BY ingestion_timestamp ASC
      LIMIT $2`,
    [GRACE_MINUTES, BATCH_SIZE]
  );

  let processed = 0;
  let failed = 0;

  for (const signal of candidateResult.rows) {
    try {
      await processSignal(signal);
      processed += 1;
    } catch (err) {
      failed += 1;
      logger.error(
        {
          event: "unprocessed_signal_sweep_failed_signal",
          signal_id: signal.id,
          organization_id: signal.organization_id,
          err
        },
        "Unprocessed-signal sweep: processing failed; row stays unprocessed and will retry next sweep"
      );
    }
  }

  const candidates = candidateResult.rowCount ?? 0;
  if (candidates > 0) {
    logger.warn(
      { event: "unprocessed_signal_sweep_complete", candidates, processed, failed },
      "Unprocessed-signal sweep recovered committed-but-unprocessed signals — a prior run was interrupted between commit and processing"
    );
  }

  return { candidates, processed, failed };
}

export function startUnprocessedSignalSweeper(): void {
  if (signalSweeperDisabled()) {
    logger.info(
      { event: "unprocessed_signal_sweeper_disabled" },
      "Unprocessed-signal sweeper: SECURELOGIC_SIGNAL_SWEEPER_DISABLED — not starting"
    );
    return;
  }

  const tick = (): void => {
    runUnprocessedSignalSweep().catch((err) =>
      logger.error(
        { event: "unprocessed_signal_sweep_error", err },
        "Unprocessed-signal sweep failed"
      )
    );
  };

  tick(); // run once at boot — a crashed run's orphans should recover promptly
  const timer = setInterval(tick, INTERVAL_MS);
  timer.unref();

  logger.info(
    { event: "unprocessed_signal_sweeper_started", interval_ms: INTERVAL_MS },
    "Unprocessed-signal sweeper started"
  );
}
