import crypto from "crypto";
import type { AuditEvent, AuditEventType } from "./AuditEvent";

const buffer: AuditEvent[] = [];

export function emitAudit(
  type: AuditEventType,
  envelopeId?: string,
  metadata?: Record<string, unknown>
) {
  buffer.push({
    id: crypto.randomUUID(),
    envelopeId,
    type,
    timestamp: new Date().toISOString(),
    metadata
  });
}

export function drainAuditEvents(): readonly AuditEvent[] {
  return buffer.splice(0);
}
