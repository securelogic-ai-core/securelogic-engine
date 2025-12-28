import crypto from "crypto";
import type { AuditRecordV1 } from "./AuditRecordV1";

export function appendAuditRecord(
  eventType: string,
  subjectId: string,
  payload: object
): AuditRecordV1 {
  const serialized = JSON.stringify(payload);
  const checksum = crypto.createHash("sha256").update(serialized).digest("hex");

  return Object.freeze({
    version: "audit-record-v1",
    recordId: crypto.randomUUID(),
    eventType,
    subjectId,
    checksum,
    occurredAt: new Date().toISOString()
  });
}
