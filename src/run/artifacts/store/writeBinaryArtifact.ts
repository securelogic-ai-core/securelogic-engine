import fs from "fs";
import path from "path";
import crypto from "crypto";
import type { RunArtifact } from "../RunArtifact";

const ARTIFACT_DIR = path.resolve("artifacts");
const RUN_DIR = path.resolve("runs");

fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
fs.mkdirSync(RUN_DIR, { recursive: true });

export function writeBinaryArtifact(
  runId: string,
  type: "PDF" | "DASHBOARD",
  buffer: Buffer
): RunArtifact {
  const artifactId = crypto.randomUUID();
  const filename = `${runId}.${artifactId}.pdf`;
  const filepath = path.join(ARTIFACT_DIR, filename);

  if (fs.existsSync(filepath)) {
    throw new Error(`ARTIFACT_ALREADY_EXISTS:${runId}:${type}`);
  }

  fs.writeFileSync(filepath, buffer);

  const checksum = crypto.createHash("sha256").update(buffer).digest("hex");

  const artifact: RunArtifact = {
    runId,
    artifactId,
    type,
    filename,
    path: filepath,
    size: buffer.length,
    checksum,
    createdAt: new Date().toISOString()
  };

  fs.writeFileSync(
    path.join(RUN_DIR, `${runId}.artifacts.json`),
    JSON.stringify([artifact], null, 2)
  );

  return artifact;
}
