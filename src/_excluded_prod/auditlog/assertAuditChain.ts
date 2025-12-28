import type { AuditEventV1 } from "./AuditEventV1";

export function assertAuditChain(
  current: AuditEventV1,
  previous: AuditEventV1
): void {
  if (!current.hash || !previous.hash) {
    throw new Error("AUDIT_CHAIN_MISSING_HASH");
  }
}
