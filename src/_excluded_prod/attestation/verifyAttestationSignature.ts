import type { AttestationV1 } from "../contracts";
import { verifyDetachedSignature } from "../crypto/verifyDetachedSignature";

export function verifyAttestationSignature(
  attestation: AttestationV1
): boolean {
  return verifyDetachedSignature({
    payload: attestation.payload,
    signature: attestation.signature,
    publicKey: attestation.attesterPublicKey
  });
}
