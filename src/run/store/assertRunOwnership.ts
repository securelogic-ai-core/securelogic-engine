import fs from "fs";
import path from "path";

export function assertRunOwnership(runId: string, customerId: string) {
  const file = path.join("runs", `${runId}.json`);
  if (!fs.existsSync(file)) throw new Error("RUN_NOT_FOUND");

  const run = JSON.parse(fs.readFileSync(file, "utf-8"));
  if (run.customerId !== customerId) {
    throw new Error("ACCESS_DENIED");
  }
}
