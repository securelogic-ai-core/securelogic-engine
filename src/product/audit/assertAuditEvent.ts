import type { AuditEventV1 } from "./AuditEventV1";

export function assertAuditEvent(e: AuditEventV1): void {
  if (!e.eventId || !e.tenantId || !e.timestamp) {
    throw new Error("INVALID_AUDIT_EVENT");
  }
}
