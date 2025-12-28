import type { AuditEventV1 } from "./AuditEventV1";
import { deepFreeze } from "../integrity/deepFreeze";

const auditLog: AuditEventV1[] = [];

export function appendAuditEvent(event: AuditEventV1): void {
  auditLog.push(deepFreeze(event));
}

export function getAuditLog(): readonly AuditEventV1[] {
  return auditLog;
}
