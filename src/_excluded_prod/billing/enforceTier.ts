import type { ResultEnvelope } from "../contracts";
import { tierLimits } from "./tierLimits";

export interface TierLimits {
  maxAttestations: number;
}

export function enforceTier(
  envelope: ResultEnvelope,
  limits: TierLimits
): boolean {
  const attestations = envelope.attestations ?? [];
  return attestations.length <= limits.maxAttestations;
}
