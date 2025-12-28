import crypto from "crypto";
import type { AuditRecordV1 } from "./AuditRecordV1";
import { hashAuditRecord } from "./hashAuditRecord";

let lastHash: string | undefined;

export function appendAuditRecord(
  category: AuditRecordV1["category"],
  action: string,
  subjectId?: string
): AuditRecordV1 {
  const base = {
    version: "audit-record-v1",
    recordId: crypto.randomUUID(),
    category,
    subjectId,
    action,
    timestamp: new Date().toISOString(),
    previousHash: lastHash
  };

  const hash = hashAuditRecord(base);
  lastHash = hash;

  return Object.freeze({
    ...base,
    hash
  });
}
