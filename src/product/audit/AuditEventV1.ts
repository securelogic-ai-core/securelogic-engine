export interface AuditEventV1 {
  eventId: string;
  tenantId: string;
  actor: string;
  action: string;
  resource: string;
  timestamp: string;
  immutable: true;
}
