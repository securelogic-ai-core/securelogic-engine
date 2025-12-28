export interface EvidenceArtifactV1 {
  version: "evidence-artifact-v1";
  artifactId: string;
  type: "POLICY" | "CONTROL" | "LOG" | "ATTESTATION" | "CONFIG";
  source: string;
  checksum: string;
  generatedAt: string;
}
