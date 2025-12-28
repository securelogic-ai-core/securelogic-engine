import crypto from "crypto";
import type { AuditRecordV1 } from "./AuditRecordV1";

let lastHash: string | undefined;

export function appendAuditRecord(
  input: Omit<AuditRecordV1, "hash" | "prevHash">
): AuditRecordV1 {
  const payload = JSON.stringify({ ...input, prevHash: lastHash });
  const hash = crypto.createHash("sha256").update(payload).digest("hex");

  const record: AuditRecordV1 = {
    ...input,
    hash,
    prevHash: lastHash
  };

  lastHash = hash;
  return record;
}
