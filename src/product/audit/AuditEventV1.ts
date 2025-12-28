export interface AuditEventV1 {
  version: "audit-event-v1";
  eventType: string;
  actor: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}
