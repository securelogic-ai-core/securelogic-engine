import type { AuditSprintResultV1 } from "../contracts/result";
import type { VerificationResultV1 } from "../contracts/integrity/VerificationResult";
import { canonicalize } from "./canonicalize";
import { createHash } from "crypto";

/**
 * Verifies integrity of an AuditSprintResult
 */
export function verifyResult(
  result: AuditSprintResultV1
): VerificationResultV1 {
  const { integrity, ...payload } = result;

  const canonical = canonicalize(payload);
  const actualHash = createHash("sha256")
    .update(canonical)
    .digest("hex");

  return {
    valid: actualHash === integrity.hash,
    expectedHash: integrity.hash,
    actualHash,
    algorithm: integrity.algorithm,
    verifiedAt: new Date().toISOString()
  };
}
