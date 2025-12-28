export interface AuditEventV1 {
  eventId: string;
  type: string;
  actor: string;
  tenantId: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}
