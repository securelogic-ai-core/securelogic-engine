import crypto from "crypto";
import type { AuditSprintResultV1 } from "../contracts";
import { hashEvidence } from "./hashEvidence";

export function createChainHashWithEvidence(
  result: AuditSprintResultV1,
  parentHash: string
): string {
  const evidenceHash = result.evidence
    ? hashEvidence(result.evidence)
    : "";

  return crypto
    .createHash("sha256")
    .update(JSON.stringify(result) + parentHash + evidenceHash)
    .digest("hex");
}
