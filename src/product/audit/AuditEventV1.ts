export interface AuditEventV1 {
  eventId: string;
  tenantId: string;
  actorId: string;
  action: string;
  outcome: "allow" | "deny";
  timestamp: string;
  metadata?: Record<string, unknown>;
}
