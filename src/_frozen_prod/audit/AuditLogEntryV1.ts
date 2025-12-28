export interface AuditLogEntryV1 {
  eventId: string;
  tenantId: string;
  actor: string;
  action: string;
  target: string;
  hash: string;
  occurredAt: string;
  immutable: true;
}
