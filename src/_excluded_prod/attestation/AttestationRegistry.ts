import type { AttestationV1 } from "../contracts/attestation/Attestation";

/**
 * Attestation Registry
 * --------------------
 * Append-only, auditor-safe
 */
export class AttestationRegistry {
  private readonly attestations: AttestationV1[] = [];

  add(attestation: AttestationV1): void {
    this.attestations.push(attestation);
  }

  list(): readonly AttestationV1[] {
    return [...this.attestations];
  }
}
