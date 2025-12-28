export interface AuditEventV1 {
  eventId: string;
  tenantId: string;
  actor: string;
  action: string;
  target: string;
  timestamp: string;
  hash: string;
}
