export interface EvidenceArtifactV1 {
  artifactId: string;
  tenantId: string;
  type: string;
  hash: string;
  createdAt: string;
  immutable: true;
}
