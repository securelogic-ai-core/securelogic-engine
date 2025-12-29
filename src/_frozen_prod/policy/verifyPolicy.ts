import type { EnvelopePolicy } from "./PolicyTypes";

export function verifyPolicy(
  policy: EnvelopePolicy | undefined,
  requestedCapabilities: string[]
): { allowed: boolean } {
  if (!policy) return { allowed: true };

  for (const cap of requestedCapabilities) {
    if (!policy.allowedCapabilities.includes(cap)) {
      return { allowed: false };
    }
  }

  return { allowed: true };
}
