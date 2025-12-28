import crypto from "crypto";
import type { AuditRecordV1 } from "./AuditRecordV1";

export function hashAuditRecord(
  record: Omit<AuditRecordV1, "hash">
): string {
  const payload = JSON.stringify(record);
  return crypto.createHash("sha256").update(payload).digest("hex");
}
