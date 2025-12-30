import fs from "fs";
import path from "path";
import type { RunRecord } from "../RunRecord";

const RUN_DIR = path.resolve("runs");

export function saveRun(record: RunRecord) {
  fs.writeFileSync(
    path.join(RUN_DIR, `${record.runId}.json`),
    JSON.stringify(record, null, 2)
  );
}

export function updateRun(runId: string, update: Partial<RunRecord>) {
  const file = path.join(RUN_DIR, `${runId}.json`);
  const existing = JSON.parse(fs.readFileSync(file, "utf-8"));
  fs.writeFileSync(
    file,
    JSON.stringify({ ...existing, ...update }, null, 2)
  );
}
