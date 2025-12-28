import { EnvelopePolicy } from "./PolicyTypes";

export function verifyPolicy(
  policy: EnvelopePolicy | undefined,
  requestedCapabilities: string[]
): { valid: boolean; reason?: string } {
  if (!policy) return { valid: true };

  for (const cap of requestedCapabilities) {
    if (!policy.allowedCapabilities.includes(cap)) {
      return { valid: false, reason: "CAPABILITY_NOT_ALLOWED" };
    }
  }

  return { valid: true };
}
