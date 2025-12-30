import fs from "fs";
import path from "path";
import type { RunArtifact } from "../RunArtifact";

const RUN_DIR = path.resolve("runs");

export function writeRunArtifactManifest(
  runId: string,
  artifact: RunArtifact
) {
  fs.mkdirSync(RUN_DIR, { recursive: true });

  const file = path.join(RUN_DIR, `${runId}.artifacts.json`);

  const artifacts: RunArtifact[] = fs.existsSync(file)
    ? JSON.parse(fs.readFileSync(file, "utf-8"))
    : [];

  if (artifacts.some(a => a.type === artifact.type)) {
    throw new Error(`ARTIFACT_TYPE_ALREADY_EXISTS:${runId}:${artifact.type}`);
  }

  artifacts.push(artifact);

  fs.writeFileSync(file, JSON.stringify(artifacts, null, 2));
}
