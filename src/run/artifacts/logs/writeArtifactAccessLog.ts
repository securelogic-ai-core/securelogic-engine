import fs from "fs";
import path from "path";

const DIR = "artifact-access-logs";
fs.mkdirSync(DIR, { recursive: true });

export function writeArtifactAccessLog(entry: any) {
  fs.writeFileSync(
    path.join(DIR, `${Date.now()}-${Math.random()}.json`),
    JSON.stringify(entry, null, 2)
  );
}
