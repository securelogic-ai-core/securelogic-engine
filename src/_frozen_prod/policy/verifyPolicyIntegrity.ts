import crypto from "crypto";
import type { EnvelopePolicy } from "./EnvelopePolicy";

export function verifyPolicyIntegrity(policy?: EnvelopePolicy) {
  if (!policy || !policy.signature || !policy.payloadHash) {
    return { valid: false };
  }

  const reconstructed = crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        licenseTier: policy.licenseTier,
        issuedForTenant: policy.issuedForTenant,
        requestedCapabilities: policy.requestedCapabilities,
        allowedCapabilities: policy.allowedCapabilities,
      })
    )
    .digest("hex");

  return { valid: reconstructed === policy.payloadHash };
}
