/**
 * Vendor-Extraction Worker — async job runner for vendor-assurance SOC
 * extraction (Pillar 1). Claims `vendor_assurance_extract` jobs from the generic
 * `jobs` table and runs the durable extraction pipeline out-of-process, so an
 * engine redeploy can no longer strand a document mid-extraction (the failure
 * the in-process `setImmediate` runner has — see
 * docs/roadmap/pillar1-vendor-assurance-worker-spec.md §A/§B).
 *
 * Thin runner only — ALL claim/process/retry/idempotency logic lives in
 * src/api/workers/vendorExtractionWorker.ts (merged in build step 2, where it is
 * unit- and isolation-tested in the main build). This file owns nothing but the
 * poll loop and the process lifecycle; it mirrors
 * services/data-rights-worker/src/index.ts almost exactly.
 *
 * RUNTIME MODEL (spec §B.4, §F.3)
 *   • Poll every POLL_INTERVAL_MS; each tick drains all claimable jobs.
 *   • Single serial instance (§F.3) → a natural per-platform Claude-spend cap.
 *   • Single-flight: a tick that fires while the previous one is still running
 *     is skipped (no overlap), mirroring the engine's schedulerRunner.
 *   • Graceful shutdown on SIGTERM/SIGINT (Render sends SIGTERM on every deploy):
 *     stop claiming, let the in-flight tick finish its current job, exit. A job
 *     still running past the drain deadline is left to the 15-min visibility
 *     timeout to reclaim — never double-run. This is the whole point: a redeploy
 *     can no longer strand work.
 *
 * DEPLOYMENT
 *   New Render worker service (render.yaml — added in build step 6, not here).
 *   Workers do NOT auto-migrate — the engine's startCommand owns migrations;
 *   this worker only runs node. The Claude key lives on THIS service only
 *   (spec §C.2), set in the dashboard.
 */

import { runOneTick } from "../../../src/api/workers/vendorExtractionWorker.js";
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
        { event: "vendor_extraction_worker_tick_overlap_skipped" },
        "Vendor-extraction worker: previous tick still running — skipping this trigger",
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
        { event: "vendor_extraction_worker_tick_complete", processed, durationMs: Date.now() - startedAt },
        `Vendor-extraction worker processed ${processed} job(s)`,
      );
    }
  } catch (err) {
    logger.error(
      { event: "vendor_extraction_worker_tick_error", durationMs: Date.now() - startedAt, err },
      "Vendor-extraction worker tick threw an unexpected error",
    );
  } finally {
    isRunning = false;
  }
}

function start(): void {
  logger.info(
    { event: "vendor_extraction_worker_start", pollIntervalMs: POLL_INTERVAL_MS },
    "Vendor-extraction worker started",
  );
  timer = setInterval(() => void tick(), POLL_INTERVAL_MS);
  void tick(); // run one immediately on boot
}

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  if (timer) clearInterval(timer);
  logger.info(
    { event: "vendor_extraction_worker_shutdown", signal },
    "Vendor-extraction worker shutting down — stop claiming, drain in-flight job",
  );

  const deadline = Date.now() + SHUTDOWN_DRAIN_MS;
  while (isRunning && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 200));
  }
  if (isRunning) {
    logger.warn(
      { event: "vendor_extraction_worker_shutdown_forced" },
      "Vendor-extraction worker drain deadline exceeded — exiting; in-flight job will be reclaimed by the visibility timeout",
    );
  }
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

start();
