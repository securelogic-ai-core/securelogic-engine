import crypto from "crypto";
import type { AuditEventV1 } from "./AuditEventV1";

export function hashAuditEvent(
  event: Omit<AuditEventV1, "hash">,
  previousHash: string
): string {
  const payload = JSON.stringify({ ...event, previousHash });
  return crypto.createHash("sha256").update(payload).digest("hex");
}
