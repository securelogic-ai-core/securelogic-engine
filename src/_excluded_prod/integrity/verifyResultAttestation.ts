import type { AttestationV1, ResultEnvelope } from "../contracts";
import { hashEnvelope } from "./hashEnvelope";

export function verifyResultAttestation(
  envelope: ResultEnvelope,
  attestation: AttestationV1
): boolean {
  const envelopeHash = hashEnvelope(envelope);

  return (
    attestation.envelopeId === envelope.envelopeId &&
    attestation.envelopeHash === envelopeHash &&
    typeof attestation.attester === "string" &&
    typeof attestation.issuedAt === "string"
  );
}
