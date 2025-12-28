import type { ResultEnvelope } from "../contracts";

const seen = new Set<string>();

export function hasSeenEnvelope(envelope: ResultEnvelope): boolean {
  return seen.has(envelope.envelopeId);
}

export function markEnvelopeSeen(envelope: ResultEnvelope): void {
  seen.add(envelope.envelopeId);
}
