import { hashAuditRecord } from "./hashAuditRecord";
import type { AuditRecordV1 } from "./AuditRecordV1";

export function appendAuditRecord(
  base: Omit<AuditRecordV1, "hash">
): AuditRecordV1 {
  const record: Omit<AuditRecordV1, "hash"> = {
    ...base,
    version: "audit-record-v1"
  };

  const hash = hashAuditRecord(record);

  return Object.freeze({
    ...record,
    hash
  });
}
