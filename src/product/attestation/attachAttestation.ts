import type { AuditSprintResultV1 } from "../contracts/result";
import type { AttestationV1 } from "../contracts/attestation/Attestation";

/**
 * Attaches attestation without mutating integrity
 */
export function attachAttestation(
  result: AuditSprintResultV1,
  attestation: AttestationV1
): AuditSprintResultV1 {
  return {
    ...result,
    attestations: [...result.attestations, attestation]
  };
}
