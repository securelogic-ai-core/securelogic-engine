import type { AuditEventV1 } from "./AuditEventV1";

export function emitAuditEvent(event: AuditEventV1): void {
  if (!event.tenantId || !event.actor || !event.eventId) {
    throw new Error("Invalid audit event");
  }

  // noop for prod slice
}
