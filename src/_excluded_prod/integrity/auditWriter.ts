import type { AuditEvent } from "./AuditEvent";
import crypto from "crypto";

const auditLog: AuditEvent[] = [];

export function appendAuditEvent(
  event: Omit<AuditEvent, "eventId" | "occurredAt">
) {
  auditLog.push({
    ...event,
    eventId: crypto.randomUUID(),
    occurredAt: new Date().toISOString()
  });
}

export function readAuditLog(): readonly AuditEvent[] {
  return auditLog;
}
