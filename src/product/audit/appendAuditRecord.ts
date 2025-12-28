import type { AuditRecordV1 } from "./AuditRecordV1";
import { hashAuditRecord } from "./hashAuditRecord";

let lastHash: string | undefined;

export function appendAuditRecord(
  input: Omit<AuditRecordV1, "hash" | "previousHash">
): AuditRecordV1 {
  const record = hashAuditRecord({
    ...input,
    previousHash: lastHash
  });
  lastHash = record.hash;
  return record;
}
