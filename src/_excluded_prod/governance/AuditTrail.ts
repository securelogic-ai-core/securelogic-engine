import type { AuditEvent } from "./AuditEvent";
import crypto from "crypto";

const auditTrail: AuditEvent[] = [];

export function recordAuditEvent(
  event: Omit<AuditEvent, "id" | "occurredAt">
): AuditEvent {
  const full: AuditEvent = {
    id: crypto.randomUUID(),
    occurredAt: new Date().toISOString(),
    ...event
  };
  auditTrail.push(Object.freeze(full));
  return full;
}

export function getAuditTrail(): readonly AuditEvent[] {
  return auditTrail;
}
