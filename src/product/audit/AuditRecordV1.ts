export interface AuditRecordV1 {
  version: "audit-record-v1";
  recordId: string;
  eventType: string;
  subjectId: string;
  checksum: string;
  occurredAt: string;
}
