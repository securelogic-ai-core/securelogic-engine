import type { AuditEventV1 } from "./AuditEventV1";

export function emitAuditEvent(event: AuditEventV1): void {
  if (process.env.NODE_ENV === "production") {
    if (!event.tenantId || !event.actorId || !event.eventId) {
      throw new Error("INVALID_AUDIT_EVENT");
    }
  }
  // append-only sink placeholder (stdout/file/stream)
  console.info(JSON.stringify(event));
}
