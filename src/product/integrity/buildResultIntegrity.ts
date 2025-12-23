import crypto from "crypto";
import type { AuditSprintResultV1 } from "../contracts/result/AuditSprintResultV1";
import type { ResultIntegrityV1 } from "../contracts/integrity/ResultIntegrity";

/**
 * Builds a cryptographic integrity seal.
 * MUST be called after entitlement enforcement.
 */
export function buildResultIntegrity(
  result: Omit<AuditSprintResultV1, "integrity">
): ResultIntegrityV1 {
  const hash = crypto
    .createHash("sha256")
    .update(JSON.stringify(result))
    .digest("hex");

  return {
    canonicalVersion: "v1",
    algorithm: "sha256",
    hash,
    generatedAt: new Date().toISOString()
  };
}
