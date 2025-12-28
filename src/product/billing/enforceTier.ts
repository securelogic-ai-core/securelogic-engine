import type { ResultEnvelope } from "../contracts";

export function enforceTier(envelope: ResultEnvelope, limits: any): boolean {
  return (envelope.attestations?.length ?? 0) <= limits.maxAttestations;
}
