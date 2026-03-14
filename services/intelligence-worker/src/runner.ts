import { runWorker } from "./worker.js";

runWorker().catch((error) => {
  console.error("Worker failure:", error);
  process.exit(1);
});