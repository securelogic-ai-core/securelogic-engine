import crypto from "crypto";
import type { AuditRecordV1 } from "./AuditRecordV1";

export function hashAuditRecord(
  record: Omit<AuditRecordV1, "hash">
): AuditRecordV1 {
  const payload = JSON.stringify(record);
  const hash = crypto.createHash("sha256").update(payload).digest("hex");
  return { ...record, hash };
}
