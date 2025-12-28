import type { VerificationMode } from "./VerificationMode";
import type { ResultEnvelope } from "../contracts";
import { verifyResultEnvelope } from "./verifyResultEnvelope";
import { verifyResultEnvelopeWithResult } from "./verifyResultEnvelopeWithResult";

export function verifyResult(
  mode: VerificationMode,
  envelope: ResultEnvelope
): boolean {
  const coreValid = verifyResultEnvelope(envelope);
  const fullValid = verifyResultEnvelopeWithResult(envelope);

  if (mode === "permissive") {
    return coreValid;
  }

  if (mode === "strict") {
    return coreValid && fullValid;
  }

  // forensic
  return true;
}
