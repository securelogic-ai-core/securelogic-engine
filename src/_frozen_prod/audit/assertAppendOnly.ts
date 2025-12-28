import type { AuditLogEntryV1 } from "./AuditLogEntryV1";

export function assertAppendOnly(entry: AuditLogEntryV1): void {
  if (process.env.NODE_ENV === "production" && !entry.immutable) {
    throw new Error("AUDIT_LOG_MUTATION_DETECTED");
  }
}
