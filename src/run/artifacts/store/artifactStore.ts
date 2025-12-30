import fs from "fs";
import path from "path";
import type { RunArtifact } from "../RunArtifact";

const ARTIFACT_DIR = path.resolve("artifacts");
fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

export function writeArtifact(artifact: RunArtifact) {
  const file = path.join(
    ARTIFACT_DIR,
    `${artifact.runId}.${artifact.artifactId}.json`
  );
  fs.writeFileSync(file, JSON.stringify(artifact, null, 2));
}
