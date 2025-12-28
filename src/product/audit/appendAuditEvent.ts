import type { AuditEventV1 } from "./AuditEventV1";

export function appendAuditEvent(event: AuditEventV1): void {
  if (!event.eventId || !event.timestamp || !event.tenantId) {
    throw new Error("INVALID_AUDIT_EVENT");
  }
}
