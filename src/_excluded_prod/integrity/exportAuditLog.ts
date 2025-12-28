import { readAuditLog } from "./auditWriter";

export function exportAuditLog(): string {
  return JSON.stringify(readAuditLog(), null, 2);
}
