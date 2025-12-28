export interface EvidenceRecordV1 {
  evidenceId: string;
  tenantId: string;
  controlId: string;
  hash: string;
  collectedAt: string;
  retentionUntil: string;
  immutable: true;
}
