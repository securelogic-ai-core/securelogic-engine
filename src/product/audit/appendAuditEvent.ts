import type { AuditEventV1 } from "./AuditEventV1";

export function appendAuditEvent(event: AuditEventV1): void {
  if (!event.timestamp) {
    throw new Error("AUDIT_EVENT_MISSING_TIMESTAMP");
  }
  // Implementation intentionally append-only (storage adapter injected elsewhere)
}
