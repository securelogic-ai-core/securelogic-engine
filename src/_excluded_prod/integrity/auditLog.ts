import type { AuditLogEntry } from "./AuditLogEntry";

const auditLog: AuditLogEntry[] = [];

export function appendAuditLog(entry: AuditLogEntry): void {
  auditLog.push(Object.freeze(entry));
}

export function getAuditLog(): readonly AuditLogEntry[] {
  return auditLog;
}
