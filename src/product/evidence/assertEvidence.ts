import type { EvidenceArtifactV1 } from "./EvidenceArtifactV1";

export function assertEvidence(a: EvidenceArtifactV1): void {
  if (!a.artifactId || !a.hash) {
    throw new Error("INVALID_EVIDENCE_ARTIFACT");
  }
}
