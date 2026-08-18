import { setInterval } from "node:timers";
import { runWorker, validateWorkerEnv } from "./runner.js";
import { runKevPoll } from "./kevPoller.js";
import { checkVendorQueueDepth } from "../../../src/api/lib/vendorQueueDepthAlert.js";
import { runOneTick as runControlMatcherTick } from "../../../src/api/workers/controlMatcherWorker.js";
import { logger } from "../../../src/api/infra/logger.js";

const ONE_HOUR_MS = 60 * 60 * 1000;
const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;
const ONE_MINUTE_MS = 60 * 1000;

/**
 * Drain the control-suggestion queue. This service OWNS asynchronous matcher
 * execution: producers (processSignal, the KEV poll, the hourly fan-out) only
 * enqueue, and nothing on the Brief publication path waits for the result.
 *
 * Every minute, and never overlapping itself — the tick claims one job at a
 * time and this guard stops a slow drain from stacking. Deliberately NOT
 * widened: the point of the package is to take provider latency off the
 * critical path, not to hide it behind more concurrency.
 */
let controlMatcherTickRunning = false;
async function drainControlMatcherQueue(): Promise<void> {
  if (controlMatcherTickRunning) return;
  controlMatcherTickRunning = true;
  try {
    await runControlMatcherTick();
  } catch (error) {
    logger.error(
      { event: "control_matcher_tick_failed", err: error },
      "Control-suggestion worker tick failed"
    );
  } finally {
    controlMatcherTickRunning = false;
  }
}

async function start() {
  validateWorkerEnv();
  logger.info({ event: "scheduler_start" }, "SecureLogic AI Scheduler starting");

  await runWorker();

  // KEV fast-cadence poll — independent of the hourly pipeline. Fires once
  // immediately after the first runWorker() so the catalog is current at
  // boot, then every 15 minutes. The poll itself is cache-aware: 304 hits
  // cost <1s, full fetches only when CISA publishes a new catalog.
  await runKevPoll();

  // Vendor-extraction queue-depth alerting (§E step 7 / §F.4). Cheap COUNT on
  // the `jobs` backlog; fires one operator alert on the rising edge. Best-effort
  // (never throws). Once at boot, then every 15 minutes alongside the KEV poll.
  await checkVendorQueueDepth();

  setInterval(async () => {
    try {
      logger.info({ event: "cycle_start" }, "Starting scheduled intelligence cycle");
      await runWorker();
      logger.info({ event: "cycle_complete" }, "Scheduled intelligence cycle complete");
    } catch (error) {
      logger.error({ event: "cycle_failed", err: error }, "Scheduled intelligence cycle failed");
    }
  }, ONE_HOUR_MS);

  await drainControlMatcherQueue();

  setInterval(drainControlMatcherQueue, ONE_MINUTE_MS);
  setInterval(runKevPoll, FIFTEEN_MINUTES_MS);
  setInterval(checkVendorQueueDepth, FIFTEEN_MINUTES_MS);
}

start().catch((error) => {
  logger.error({ event: "scheduler_startup_failed", err: error }, "Scheduler startup failed");
  process.exit(1);
});
