import fs from "fs";
import path from "path";

const RUN_DIR = path.resolve("runs");
fs.mkdirSync(RUN_DIR, { recursive: true });

export function writeRun(run: any) {
  fs.writeFileSync(
    path.join(RUN_DIR, `${run.runId}.json`),
    JSON.stringify(run, null, 2)
  );
}

export function updateRun(runId: string, patch: any) {
  const file = path.join(RUN_DIR, `${runId}.json`);
  const current = JSON.parse(fs.readFileSync(file, "utf-8"));
  fs.writeFileSync(
    file,
    JSON.stringify({ ...current, ...patch, updatedAt: new Date().toISOString() }, null, 2)
  );
}
