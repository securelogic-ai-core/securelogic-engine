export interface AuditRecordV1 {
  version: "audit-record-v1";
  recordId: string;
  timestamp: string;
  actor: string;
  action: string;
  resourceId: string;
  previousHash?: string;
  hash: string;
}
