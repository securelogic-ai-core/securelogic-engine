import { setInterval } from "node:timers";
import { runWorker, validateWorkerEnv } from "./runner.js";
import { logger } from "../../../src/api/infra/logger.js";

const ONE_HOUR_MS = 60 * 60 * 1000;

async function start() {
  validateWorkerEnv();
  logger.info({ event: "scheduler_start" }, "SecureLogic AI Scheduler starting");

  await runWorker();

  setInterval(async () => {
    try {
      logger.info({ event: "cycle_start" }, "Starting scheduled intelligence cycle");
      await runWorker();
      logger.info({ event: "cycle_complete" }, "Scheduled intelligence cycle complete");
    } catch (error) {
      logger.error({ event: "cycle_failed", err: error }, "Scheduled intelligence cycle failed");
    }
  }, ONE_HOUR_MS);
}

start().catch((error) => {
  logger.error({ event: "scheduler_startup_failed", err: error }, "Scheduler startup failed");
  process.exit(1);
});