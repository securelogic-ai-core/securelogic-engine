import crypto from "crypto";
import type { EvidenceArtifactV1 } from "./EvidenceArtifactV1";

export function buildEvidenceBundle(
  artifacts: EvidenceArtifactV1[]
) {
  const payload = JSON.stringify(artifacts);
  const checksum = crypto.createHash("sha256").update(payload).digest("hex");

  return {
    version: "evidence-bundle-v1",
    checksum,
    artifactCount: artifacts.length,
    generatedAt: new Date().toISOString(),
    artifacts
  };
}
