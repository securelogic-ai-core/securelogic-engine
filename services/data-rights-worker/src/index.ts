/**
 * Data-Rights Worker — async job runner for GDPR/CCPA data-subject-rights jobs
 * (O-10). EXPORT-ONLY: claims `data_export_self` / `data_export_org` jobs from
 * the `jobs` table, runs `runExport`, streams the bundle to R2. Deletion-reap
 * and export-purge jobs are out of scope and left unclaimed.
 *
 * Thin runner only — all claim/process/retry logic lives in
 * src/api/lib/dataRightsWorker.ts (so it is unit- and isolation-testable in the
 * main build). This file owns the poll loop and process lifecycle.
 *
 * RUNTIME MODEL (Decision D-6)
 *   • Poll every POLL_INTERVAL_MS; each tick drains all claimable jobs.
 *   • Single-flight: a tick that fires while the previous one is still running
 *     is skipped (no overlap), mirroring the engine's schedulerRunner.
 *   • Graceful shutdown on SIGTERM/SIGINT (Render sends SIGTERM on every deploy):
 *     stop claiming, let the in-flight tick finish its current job, exit. A job
 *     still running past the drain deadline is left to the 15-min visibility
 *     timeout to reclaim — never double-run.
 *
 * DEPLOYMENT
 *   New Render worker service (render.yaml). Workers do NOT auto-migrate — the
 *   engine's startCommand owns migrations; this worker only runs node.
 */

import { runOneTick } from "../../../src/api/workers/dataRightsWorker.js";
import { logger } from "../../../src/api/infra/logger.js";

const POLL_INTERVAL_MS = 15_000;
const SHUTDOWN_DRAIN_MS = 30_000;

let isRunning = false;
let shuttingDown = false;
let timer: NodeJS.Timeout | null = null;

async function tick(): Promise<void> {
  if (isRunning || shuttingDown) {
    if (isRunning) {
      logger.warn(
        { event: "data_rights_worker_tick_overlap_skipped" },
        "Data-rights worker: previous tick still running — skipping this trigger",
      );
    }
    return;
  }

  isRunning = true;
  const startedAt = Date.now();
  try {
    const processed = await runOneTick({ shouldContinue: () => !shuttingDown });
    if (processed > 0) {
      logger.info(
        { event: "data_rights_worker_tick_complete", processed, durationMs: Date.now() - startedAt },
        `Data-rights worker processed ${processed} job(s)`,
      );
    }
  } catch (err) {
    logger.error(
      { event: "data_rights_worker_tick_error", durationMs: Date.now() - startedAt, err },
      "Data-rights worker tick threw an unexpected error",
    );
  } finally {
    isRunning = false;
  }
}

function start(): void {
  logger.info(
    { event: "data_rights_worker_start", pollIntervalMs: POLL_INTERVAL_MS },
    "Data-rights worker started",
  );
  timer = setInterval(() => void tick(), POLL_INTERVAL_MS);
  void tick(); // run one immediately on boot
}

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  if (timer) clearInterval(timer);
  logger.info(
    { event: "data_rights_worker_shutdown", signal },
    "Data-rights worker shutting down — stop claiming, drain in-flight job",
  );

  const deadline = Date.now() + SHUTDOWN_DRAIN_MS;
  while (isRunning && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 200));
  }
  if (isRunning) {
    logger.warn(
      { event: "data_rights_worker_shutdown_forced" },
      "Data-rights worker drain deadline exceeded — exiting; in-flight job will be reclaimed by the visibility timeout",
    );
  }
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

start();
