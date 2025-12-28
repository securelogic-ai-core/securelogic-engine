export interface AuditRecordV1 {
  version: "audit-record-v1";
  recordId: string;
  category: "SECURITY" | "POLICY" | "ACCESS" | "SYSTEM";
  subjectId?: string;
  action: string;
  timestamp: string;
  previousHash?: string;
  hash: string;
}
