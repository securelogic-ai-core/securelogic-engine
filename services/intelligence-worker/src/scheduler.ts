import { setInterval } from "node:timers";
import { runWorker } from "./worker.js";

const ONE_HOUR_MS = 60 * 60 * 1000;

async function start() {
  console.log("SecureLogic Intelligence Scheduler starting...");

  await runWorker();

  setInterval(async () => {
    try {
      console.log("Starting scheduled intelligence cycle...");
      await runWorker();
      console.log("Scheduled intelligence cycle complete.");
    } catch (error) {
      console.error("Scheduled intelligence cycle failed:", error);
    }
  }, ONE_HOUR_MS);
}

start().catch((error) => {
  console.error("Scheduler startup failed:", error);
  process.exit(1);
});