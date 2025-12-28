import type { ResultEnvelope, ResultSignatureV1 } from "../contracts";
import { verifyResultSignature } from "../signing/verifyResultSignature";
import { DEFAULT_QUORUM } from "../signing/defaultQuorum";

export function verifyResultEnvelopeCore(envelope: ResultEnvelope): boolean {
  const signatures = (envelope.signatures ?? []) as ResultSignatureV1[];

  // Unsigned envelopes are valid
  if (signatures.length === 0) return true;

  let valid = 0;
  for (const sig of signatures) {
    if (!verifyResultSignature(envelope, sig)) {
      return false;
    }
    valid++;
  }

  return valid >= DEFAULT_QUORUM.minimumSignatures;
}
