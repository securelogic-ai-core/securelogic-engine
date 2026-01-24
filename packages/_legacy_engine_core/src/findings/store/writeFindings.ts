import fs from "fs";
import path from "path";
import type { Finding } from "../Finding.js";

const DIR = "runs";
fs.mkdirSync(DIR, { recursive: true });

export function writeFindings(runId: string, findings: Finding[]) {
  fs.writeFileSync(
    path.join(DIR, `${runId}.findings.json`),
    JSON.stringify(findings, null, 2)
  );
}
