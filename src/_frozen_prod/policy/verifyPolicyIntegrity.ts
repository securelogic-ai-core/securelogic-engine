import crypto from "crypto";
import type { EnvelopePolicy } from "./PolicyTypes";

export function verifyPolicyIntegrity(policy: EnvelopePolicy): { valid: boolean } {
  if (!policy || !policy.signature || !policy.payloadHash) {
    return { valid: false };
  }

  const reconstructed = crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        version: policy.version,
        licenseTier: policy.licenseTier,
        issuedForTenant: policy.issuedForTenant,
        allowedCapabilities: policy.allowedCapabilities,
      })
    )
    .digest("hex");

  return { valid: reconstructed === policy.payloadHash };
}
