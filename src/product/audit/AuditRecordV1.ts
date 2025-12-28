export interface AuditRecordV1 {
  version: "audit-record-v1";
  recordId: string;
  eventType: string;
  subjectId?: string;
  tenantId?: string;
  occurredAt: string;
  hash: string;
  prevHash?: string;
  metadata?: Record<string, string>;
}
