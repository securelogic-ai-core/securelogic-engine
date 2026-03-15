import { startRun, completeRun, failRun } from "./storage/runStore";
import { runWorker } from "./worker";

async function main() {

  const runId = startRun();

  try {

    console.log("SecureLogic Intelligence Worker starting...");

    const result = await runWorker();

    completeRun(runId, result.signals, result.insights);

    console.log("Worker completed successfully");

  } catch (err: any) {

    console.error("Worker failure:", err);

    failRun(runId, err.message);

    process.exit(1);
  }
}

main();

import { runPipeline } from "./pipeline/runPipeline";

await runPipeline();

