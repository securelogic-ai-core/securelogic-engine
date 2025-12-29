import type { EnvelopePolicy } from "./PolicyTypes";

export function verifyPolicy(
  policy: EnvelopePolicy | undefined,
  requestedCapabilities: string[]
): { allowed: boolean; valid: boolean } {
  if (!policy) {
    return { allowed: true, valid: true };
  }

  for (const cap of requestedCapabilities) {
    if (!policy.allowedCapabilities.includes(cap)) {
      return { allowed: false, valid: false };
    }
  }

  return { allowed: true, valid: true };
}
