const revoked = new Set<string>();

export function revokeEnvelope(envelopeId: string): void {
  revoked.add(envelopeId);
}

export function isEnvelopeRevoked(envelopeId: string): boolean {
  return revoked.has(envelopeId);
}
