import fs from "fs";
import path from "path";
import type { RunRecord } from "../RunRecord";

const DIR = "runs";
fs.mkdirSync(DIR, { recursive: true });

export function writeRunRecord(run: RunRecord) {
  fs.writeFileSync(
    path.join(DIR, `${run.runId}.json`),
    JSON.stringify(run, null, 2)
  );
}
